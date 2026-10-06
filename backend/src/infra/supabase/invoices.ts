import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../core/errors.ts";
import type {
  Invoice,
  InvoiceFilter,
  InvoiceRepository,
  ExtractedInvoice,
} from "../../core/invoices/types.ts";
import { MAX_FILE_SIZE, parseExtraction } from "../../core/invoices/service.ts";

const bucket = "invoice-documents";
const fields =
  "id,natureza,nome_arquivo,mime_arquivo,tamanho_arquivo,caminho_arquivo,hash_arquivo,criado_em,status,revisado_em,versao_arquivo,dados_extracao,exclusao_solicitada_em,exclusao_justificativa,lancado_financeiro_em,tipo";
function normalize(invoice: Invoice): Invoice {
  const value = invoice.dados_extracao;
  return {
    ...invoice,
    dados_extracao: parseExtraction(
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    ),
  };
}
function fail(error: { code?: string } | null, message: string) {
  if (error)
    throw new AppError(
      502,
      ["42703", "PGRST204"].includes(error.code ?? "")
        ? "O banco precisa das migrações de notas fiscais, incluindo 20261006120000_invoice_financial_posting.sql."
        : message,
    );
}
export class SupabaseInvoiceRepository implements InvoiceRepository {
  client: SupabaseClient;
  authId: string;
  companyId: string;
  constructor(client: SupabaseClient, authId: string, companyId: string) {
    this.client = client;
    this.authId = authId;
    this.companyId = companyId;
  }
  query() {
    return this.client
      .from("notas_fiscais")
      .select(fields)
      .eq("empresa_id", this.companyId)
      .eq("enviado_por", this.authId);
  }
  async companyCnpj() {
    const { data, error } = await this.client
      .from("empresas")
      .select("cnpj")
      .eq("id", this.companyId)
      .single();
    fail(error, "Não foi possível conferir o CNPJ da sua empresa.");
    if (!data?.cnpj) throw new AppError(422, "CNPJ da empresa não cadastrado.");
    return String(data.cnpj);
  }
  filePath(id: string, extension: string) {
    return `${this.authId}/${this.companyId}/${id}.${extension}`;
  }
  async list(filter: InvoiceFilter) {
    let query = this.query()
      .eq("natureza", filter.kind)
      .order("criado_em", { ascending: false })
      .order("id", { ascending: false });
    if (filter.period !== "all") {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
      }).format(new Date());
      const [year, month] = today.split("-").map(Number);
      const offset = filter.period === "previous" ? -1 : 0;
      const date = (delta: number) =>
        new Date(Date.UTC(year!, month! - 1 + delta, 1))
          .toISOString()
          .slice(0, 10) + "T00:00:00-03:00";
      query = query
        .gte("criado_em", date(offset))
        .lt("criado_em", date(offset + 1));
    }
    const { data, error } = await query.range(
      filter.offset,
      filter.offset + 49,
    );
    fail(error, "Não foi possível carregar suas notas.");
    return (data as Invoice[]).map(normalize);
  }
  async get(id: string) {
    const { data, error } = await this.query().eq("id", id).maybeSingle();
    fail(error, "Não foi possível consultar a nota.");
    if (!data) throw new AppError(404, "Nota não encontrada.");
    return normalize(data as Invoice);
  }
  async duplicate(hash: string) {
    const { data, error } = await this.query()
      .eq("hash_arquivo", hash)
      .maybeSingle();
    fail(error, "Não foi possível verificar o envio.");
    return data ? normalize(data as Invoice) : null;
  }
  async upload(path: string, file: Buffer, mime: string) {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, file, { contentType: mime, upsert: false });
    if (error)
      throw new AppError(
        502,
        "Não foi possível guardar o arquivo. Verifique o bucket privado invoice-documents e suas políticas.",
      );
  }
  async removeFile(path: string) {
    if (!path.startsWith(`${this.authId}/${this.companyId}/`))
      throw new AppError(404, "Arquivo não encontrado.");
    const { error } = await this.client.storage.from(bucket).remove([path]);
    if (error)
      throw new AppError(
        502,
        "Não foi possível excluir o arquivo. A exclusão está pendente; tente novamente.",
      );
    // Storage may return success with an empty result when RLS disallows deletion.
    const split = path.lastIndexOf("/");
    const { data, error: checkError } = await this.client.storage
      .from(bucket)
      .list(path.slice(0, split), { search: path.slice(split + 1), limit: 2 });
    if (checkError || data?.some((item) => item.name === path.slice(split + 1)))
      throw new AppError(
        502,
        "Não foi possível confirmar a exclusão do arquivo. Tente excluir novamente.",
      );
  }
  async insert(invoice: Invoice) {
    const { data, error } = await this.client
      .from("notas_fiscais")
      .insert({
        ...invoice,
        enviado_por: this.authId,
        empresa_id: this.companyId,
      })
      .select(fields)
      .single();
    fail(
      error,
      "Não foi possível registrar a nota. O arquivo não foi registrado como salvo.",
    );
    return normalize(data as Invoice);
  }
  async download(invoice: Invoice) {
    if (invoice.exclusao_solicitada_em)
      throw new AppError(409, "Esta nota está em exclusão.");
    if (
      !invoice.caminho_arquivo.startsWith(`${this.authId}/${this.companyId}/`)
    )
      throw new AppError(404, "Arquivo não encontrado.");
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(invoice.caminho_arquivo);
    if (error || !data)
      throw new AppError(502, "Não foi possível abrir o arquivo da nota.");
    if (data.size > MAX_FILE_SIZE)
      throw new AppError(413, "Arquivo excede o limite de 5 MB.");
    return Buffer.from(await data.arrayBuffer());
  }
  async save(
    invoice: Invoice,
    extraction: ExtractedInvoice,
    reviewed: boolean,
  ) {
    const { data, error } = await this.client
      .from("notas_fiscais")
      .update({
        dados_extracao: extraction,
        cnpj_emissor: extraction.cnpj,
        numero_documento: extraction.number,
        data_emissao: extraction.date,
        valor_total: extraction.total,
        revisado_em: reviewed ? new Date().toISOString() : null,
        versao_arquivo: randomUUID(),
      })
      .eq("id", invoice.id)
      .eq("empresa_id", this.companyId)
      .eq("enviado_por", this.authId)
      .eq("status", "pending_review")
      .is("exclusao_solicitada_em", null)
      .eq("versao_arquivo", invoice.versao_arquivo)
      .select(fields)
      .maybeSingle();
    fail(
      error,
      "Não foi possível salvar a revisão. Confira se o período da nota está aberto.",
    );
    if (!data)
      throw new AppError(
        409,
        "A nota mudou durante a operação. Atualize a lista.",
      );
    return normalize(data as Invoice);
  }

  async beginDeletion(invoice: Invoice, reason: string) {
    if (invoice.exclusao_solicitada_em && invoice.exclusao_justificativa)
      return invoice;
    let query = this.client
      .from("notas_fiscais")
      .update({
        exclusao_solicitada_em:
          invoice.exclusao_solicitada_em || new Date().toISOString(),
        exclusao_justificativa: reason,
      })
      .eq("id", invoice.id)
      .eq("empresa_id", this.companyId)
      .eq("enviado_por", this.authId)
      .eq("status", "pending_review")
      .eq("versao_arquivo", invoice.versao_arquivo)
      .is("exclusao_justificativa", null);
    if (!invoice.exclusao_solicitada_em)
      query = query.is("exclusao_solicitada_em", null);
    const { data, error } = await query.select(fields).maybeSingle();
    fail(
      error,
      "Não foi possível iniciar a exclusão. Confira as permissões e se o período da nota está aberto.",
    );
    if (!data)
      throw new AppError(
        409,
        "A nota mudou. Atualize a lista antes de excluir.",
      );
    return normalize(data as Invoice);
  }

  async post(invoice: Invoice, scope: "professional" | "personal") {
    const { error } = await this.client.rpc("lancar_nota_financeiro", {
      p_nota_id: invoice.id,
      p_empresa_id: this.companyId,
      p_versao: invoice.versao_arquivo,
      p_tipo: scope,
    });
    if (error) {
      if (["PGRST202", "42883", "42703"].includes(error.code))
        throw new AppError(503, "Aplique a migração 20261006120000_invoice_financial_posting.sql no Supabase antes de lançar notas.");
      if (error.code === "23505") throw new AppError(409, "Este arquivo já foi lançado no financeiro da empresa.");
      if (error.code === "42501") throw new AppError(403, "Você não pode lançar esta nota.");
      if (error.code === "P0001") throw new AppError(409, "Não foi possível lançar: confira a revisão, a versão da nota e se o mês está aberto. Atualize a lista.");
      throw new AppError(502, "Não foi possível confirmar o lançamento. Atualize a lista antes de tentar novamente.");
    }
    return this.get(invoice.id);
  }

  async finishDeletion(invoice: Invoice) {
    const { data, error } = await this.client
      .from("notas_fiscais")
      .delete()
      .eq("id", invoice.id)
      .eq("empresa_id", this.companyId)
      .eq("enviado_por", this.authId)
      .eq("status", "pending_review")
      .not("exclusao_solicitada_em", "is", null)
      .select("id");
    fail(
      error,
      "O arquivo foi removido, mas a exclusão do registro está pendente. Tente excluir novamente.",
    );
    if (!data?.length) {
      try {
        await this.get(invoice.id);
      } catch (error) {
        if (error instanceof AppError && error.status === 404) return;
        throw error;
      }
      throw new AppError(
        409,
        "A exclusão do registro não foi autorizada. Atualize a lista e verifique as permissões.",
      );
    }
  }
}
