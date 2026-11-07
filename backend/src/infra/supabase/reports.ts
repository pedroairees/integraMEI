import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../core/errors.ts";
import type {
  Original,
  ReportRepository,
  ReportSource,
} from "../../core/reports/types.ts";
export class SupabaseReportRepository implements ReportRepository {
  private client: SupabaseClient;
  private company: string;
  constructor(client: SupabaseClient, company: string) {
    this.client = client;
    this.company = company;
  }
  private async rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await this.client.rpc(name, {
      p_empresa: this.company,
      ...args,
    });
    if (error) {
      if (["PGRST202", "42703", "42P01"].includes(error.code))
        throw new AppError(
          503,
          "Aplique a migração 20261102120000_reports.sql no Supabase para habilitar os relatórios.",
        );
      if (error.code === "42501")
        throw new AppError(403, "Você não tem acesso a este relatório.");
      const safe = [
        "Muitos lançamentos. Reduza o período do relatório.",
        "Limite de 10 envios por hora. Tente mais tarde.",
        "Solicitação conflitante.",
      ];
      if (safe.includes(error.message)) throw new AppError(409, error.message);
      throw new AppError(
        502,
        "Não foi possível consultar ou registrar o relatório. Tente novamente.",
      );
    }
    return data;
  }
  async source(start: string, end: string) {
    const source = (await this.rpc("dados_relatorio", {
      p_inicio: start,
      p_fim: end,
    })) as ReportSource;
    const { data, error } = await this.client.from("preferencias_usuario").select("fuso_horario").maybeSingle();
    // Preserve exports on installations that have not enabled account settings yet.
    if (error && !["42P01", "PGRST205"].includes(error.code)) throw new AppError(502, "Não foi possível consultar o fuso horário dos relatórios.");
    source.company.timeZone = data?.fuso_horario || "America/Sao_Paulo";
    return source;
  }
  async original(file: Original) {
    // Paths originate exclusively from the tenant-scoped DB snapshot. Never accept a URL from the caller.
    if (file.path.split("/")[1] !== this.company)
      throw new AppError(403, "Arquivo fora da empresa selecionada.");
    const { data, error } = await this.client.storage
      .from("invoice-documents")
      .download(file.path);
    if (error || !data)
      throw new AppError(
        422,
        "Uma nota original está indisponível ou sem permissão. Gere sem originais ou revise as notas.",
      );
    if (data.size > 5 * 1024 * 1024)
      throw new AppError(422, "Uma nota original ultrapassa 5 MB.");
    return Buffer.from(await data.arrayBuffer());
  }
  async reserve(id: string, hash: string) {
    return (await this.rpc("reservar_envio_relatorio", {
      p_id: id,
      p_hash: hash,
    })) as string;
  }
  async finish(id: string, status: "sent" | "uncertain") {
    await this.rpc("concluir_envio_relatorio", { p_id: id, p_status: status });
  }
}
