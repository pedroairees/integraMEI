import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../core/errors.ts";
import type {
  Alert,
  Category,
  Company,
  DashboardRepository,
  Expense,
  Item,
  Sale,
  Supply,
  Tenant,
} from "../../core/dashboard/types.ts";

type PageQuery = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};
async function all<T>(query: PageQuery): Promise<T[]> {
  const rows: T[] = [];
  // No silent 1,000-row truncation in financial totals.
  for (let offset = 0; ; offset += 500) {
    const result = await query.range(offset, offset + 499);
    if (result.error || !result.data)
      throw new AppError(
        502,
        "Não foi possível consultar os dados financeiros.",
      );
    rows.push(...(result.data as T[]));
    if (result.data.length < 500) return rows;
    if (rows.length >= 100000)
      throw new AppError(
        422,
        "Intervalo muito grande. Reduza o período consultado.",
      );
  }
}
export class SupabaseDashboardRepository implements DashboardRepository {
  client: SupabaseClient;
  constructor(client: SupabaseClient) {
    this.client = client;
  }
  async source(tenant: Tenant, start: string, end: string) {
    const id = tenant.companyId,
      db = this.client;
    const company = await db
      .from("empresas")
      .select(
        "id,razao_social,meta_faturamento_mensal,meta_margem_lucro_percentual",
      )
      .eq("id", id)
      .single();
    if (company.error)
      throw new AppError(
        502,
        "Não foi possível carregar a empresa. Verifique se a migração do dashboard foi aplicada.",
      );
    const [sales, expenses, categories, items, supplies, alerts] =
      await Promise.all([
        all<Sale>(
          db
            .from("vendas")
            .select("id,data,valor_total")
            .eq("empresa_id", id)
            .gte("data", start)
            .lt("data", end)
            .order("id"),
        ),
        all<Expense>(
          db
            .from("notas_fiscais")
            .select("id,data_emissao,valor_total,tipo,categoria_id")
            .eq("empresa_id", id)
            .eq("status", "confirmed")
            .gte("data_emissao", start)
            .lt("data_emissao", end)
            .order("id"),
        ),
        all<Category>(
          db
            .from("categorias")
            .select("id,nome")
            .eq("empresa_id", id)
            .order("id"),
        ),
        all<Item>(
          db
            .from("itens_nota_fiscal")
            .select(
              "nota_fiscal_id,insumo_id,valor_total_item,notas_fiscais!inner(empresa_id,data_emissao,status)",
            )
            .eq("notas_fiscais.empresa_id", id)
            .eq("notas_fiscais.status", "confirmed")
            .gte("notas_fiscais.data_emissao", start)
            .lt("notas_fiscais.data_emissao", end)
            .order("id"),
        ),
        all<Supply>(
          db.from("insumos").select("id,nome").eq("empresa_id", id).order("id"),
        ),
        db
          .from("alertas")
          .select("id,mensagem,lido_em,criado_em")
          .eq("empresa_id", id)
          .is("dispensado_em", null)
          .order("criado_em", { ascending: false })
          .limit(20)
          .then((r) => {
            if (r.error)
              throw new AppError(502, "Não foi possível carregar os alertas.");
            return r.data as Alert[];
          }),
      ]);
    return {
      company: company.data as Company,
      sales,
      expenses,
      categories,
      items,
      supplies,
      alerts,
    };
  }
  async saveGoal(
    tenant: Tenant,
    revenue: number,
    marginTarget?: number | null,
  ) {
    const r = await this.client
      .from("empresas")
      .update({
        meta_faturamento_mensal: revenue,
        ...(marginTarget === undefined
          ? {}
          : { meta_margem_lucro_percentual: marginTarget }),
      })
      .eq("id", tenant.companyId)
      .select("id")
      .single();
    if (r.error)
      throw new AppError(502, "Não foi possível salvar a meta de faturamento.");
  }
  async history(tenant: Tenant, supplyId: string, start: string, end: string) {
    const supply = await this.client
      .from("insumos")
      .select("id")
      .eq("id", supplyId)
      .eq("empresa_id", tenant.companyId)
      .maybeSingle();
    if (supply.error)
      throw new AppError(502, "Não foi possível consultar o insumo.");
    if (!supply.data) throw new AppError(404, "Insumo não encontrado.");
    const rows = await all<{
      data_compra: string;
      valor_unitario: number;
      unidade_medida: string;
      fornecedor_id: string | null;
    }>(
      this.client
        .from("historico_precos")
        .select("data_compra,valor_unitario,unidade_medida,fornecedor_id")
        .eq("empresa_id", tenant.companyId)
        .eq("insumo_id", supplyId)
        .gte("data_compra", start)
        .lt("data_compra", end)
        .order("data_compra")
        .order("id"),
    );
    const suppliers = await all<{ id: string; razao_social: string }>(
      this.client
        .from("fornecedores")
        .select("id,razao_social")
        .eq("empresa_id", tenant.companyId)
        .order("id"),
    );
    return rows.map((r) => ({
      date: r.data_compra,
      value: Number(r.valor_unitario),
      unit: r.unidade_medida,
      supplier:
        suppliers.find((s) => s.id === r.fornecedor_id)?.razao_social ??
        "Fornecedor não informado",
    }));
  }
}
