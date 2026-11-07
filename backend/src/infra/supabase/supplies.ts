import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../core/errors.ts";
import type {
  PriceInput,
  PricePoint,
  SupplyInput,
  SupplyRecord,
  SuppliesRepository,
  SupplyInvoice,
} from "../../core/supplies/types.ts";

const fields = "id,nome,unidade_medida,estoque_minimo,ativo,versao_cadastro";
function fail(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (
    ["PGRST202", "PGRST204", "42P01", "42703", "42704"].includes(
      error.code ?? "",
    )
  )
    throw new AppError(
      503,
      "Aplique a migração 20261018170000_supplies_management.sql no Supabase para habilitar os insumos.",
    );
  if (error.code === "42501")
    throw new AppError(403, "Você não tem acesso a esse registro.");
  if (error.code === "23505")
    throw new AppError(
      409,
      "Este insumo ou item já foi registrado. Atualize a lista para conferir.",
    );
  // Only messages authored by this migration may reach the browser.
  const known = [
    "O insumo mudou. Atualize a lista.",
    "A unidade não pode ser alterada. Cadastre outro insumo para manter o histórico consistente.",
    "Reative o insumo antes de registrar preços.",
    "Use uma nota de custo profissional revisada e lançada no financeiro.",
    "Selecione um item da nota.",
    "A soma dos itens ultrapassa o total da nota.",
    "Data ou fornecedor inválido.",
    "Mês encerrado: registro de preço bloqueado.",
    "Quantidade ou preço inválido.",
  ];
  if (error.code === "P0001")
    throw new AppError(
      409,
      known.includes(error.message ?? "")
        ? error.message!
        : "Confira os dados, a versão do insumo e se o mês está aberto.",
    );
  throw new AppError(
    502,
    "Não foi possível acessar os insumos. Tente novamente.",
  );
}
type PageQuery = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>;
};
async function all<T>(query: PageQuery): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const result = await query.range(offset, offset + 499);
    fail(result.error);
    rows.push(...((result.data ?? []) as T[]));
    if ((result.data?.length ?? 0) < 500) return rows;
  }
  throw new AppError(422, "Há muitos registros. Selecione um período menor.");
}
export class SupabaseSuppliesRepository implements SuppliesRepository {
  private client: SupabaseClient;
  private companyId: string;
  private authId: string;
  constructor(client: SupabaseClient, companyId: string, authId: string) {
    this.client = client;
    this.companyId = companyId;
    this.authId = authId;
  }
  async list(query: string, offset: number) {
    const literal = query.trim().replace(/[\\%_]/g, "\\$&");
    const r = await this.client
      .from("insumos")
      .select(fields)
      .eq("empresa_id", this.companyId)
      .ilike("nome", `%${literal}%`)
      .order("nome")
      .order("id")
      .range(offset, offset + 49);
    fail(r.error);
    return (r.data ?? []) as SupplyRecord[];
  }
  async get(id: string) {
    const r = await this.client
      .from("insumos")
      .select(fields)
      .eq("empresa_id", this.companyId)
      .eq("id", id)
      .maybeSingle();
    fail(r.error);
    if (!r.data) throw new AppError(404, "Insumo não encontrado.");
    return r.data as SupplyRecord;
  }
  async save(id: string | null, input: SupplyInput) {
    const r = await this.client.rpc("salvar_insumo", {
      p_empresa: this.companyId,
      p_id: id,
      p_versao: input.version ?? null,
      p_nome: input.name,
      p_unidade: input.unit,
      p_minimo: input.minimum,
      p_ativo: input.active,
    });
    fail(r.error);
    return r.data as SupplyRecord;
  }
  async prices(id: string, start: string, end: string): Promise<PricePoint[]> {
    const [legacy, added, suppliers] = await Promise.all([
      all<{
        id: string;
        data_compra: string;
        valor_unitario: number;
        unidade_medida: string;
        fornecedor_id: string | null;
      }>(
        this.client
          .from("historico_precos")
          .select("id,data_compra,valor_unitario,unidade_medida,fornecedor_id")
          .eq("empresa_id", this.companyId)
          .eq("insumo_id", id)
          .gte("data_compra", start)
          .lte("data_compra", end)
          .order("data_compra")
          .order("id"),
      ),
      all<{
        id: string;
        data_compra: string;
        valor_unitario: number;
        unidade_medida: string;
        fornecedor: string;
        origem: "manual" | "invoice";
      }>(
        this.client
          .from("insumos_precos_registrados")
          .select(
            "id,data_compra,valor_unitario,unidade_medida,fornecedor,origem",
          )
          .eq("empresa_id", this.companyId)
          .eq("insumo_id", id)
          .gte("data_compra", start)
          .lte("data_compra", end)
          .order("data_compra")
          .order("id"),
      ),
      all<{ id: string; nome: string }>(
        this.client
          .from("fornecedores")
          .select("id,nome")
          .eq("empresa_id", this.companyId)
          .order("id"),
      ),
    ]);
    const names = new Map(suppliers.map((s) => [s.id, s.nome]));
    return [
      ...legacy.map((p) => ({
        id: p.id,
        date: p.data_compra,
        value: Number(p.valor_unitario),
        unit: p.unidade_medida,
        supplier:
          names.get(p.fornecedor_id ?? "") ?? "Fornecedor não informado",
        source: "invoice" as const,
      })),
      ...added.map((p) => ({
        id: p.id,
        date: p.data_compra,
        value: Number(p.valor_unitario),
        unit: p.unidade_medida,
        supplier: p.fornecedor,
        source: p.origem,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  async register(id: string, input: PriceInput) {
    const r = await this.client.rpc("registrar_preco_insumo", {
      p_empresa: this.companyId,
      p_insumo: id,
      p_id: input.requestId,
      p_origem: input.source,
      p_nota: input.invoiceId ?? null,
      p_item: input.itemIndex ?? null,
      p_data: input.date ?? null,
      p_quantidade: input.quantity,
      p_preco: input.price,
      p_fornecedor: input.supplier ?? null,
    });
    fail(r.error);
  }
  async invoices() {
    const r = await this.client
      .from("notas_fiscais")
      .select("id,nome_arquivo,data_emissao,valor_total,dados_extracao")
      .eq("empresa_id", this.companyId)
      .eq("enviado_por", this.authId)
      .eq("natureza", "cost")
      .eq("tipo", "professional")
      .not("lancado_financeiro_em", "is", null)
      .not("revisado_em", "is", null)
      .is("exclusao_solicitada_em", null)
      .order("data_emissao", { ascending: false })
      .order("id")
      .limit(100);
    fail(r.error);
    return (r.data ?? []) as SupplyInvoice[];
  }
}
