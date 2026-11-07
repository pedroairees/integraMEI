import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PricingInput,
  PricingRepository,
} from "../../core/pricing/types.ts";
import { AppError } from "../../core/errors.ts";

const known = [
  "Dados de precificação inválidos.",
  "Catálogo muito grande para esta tela.",
  "Há insumo inativo na composição.",
  "Quantidade inválida ou insumo repetido.",
  "Há insumo sem preço de compra na unidade cadastrada.",
  "Impossível calcular: vincule insumos ou defina um custo base para este produto.",
  "Confira o percentual de impostos da empresa.",
  "O cálculo ultrapassa o valor permitido.",
  "O produto mudou. Atualize os dados antes de salvar.",
  "Já existe um produto com esse nome.",
];
export class SupabasePricingRepository implements PricingRepository {
  private client: SupabaseClient;
  private companyId: string;
  constructor(client: SupabaseClient, companyId: string) {
    this.client = client;
    this.companyId = companyId;
  }
  private async call(name: string, args = {}) {
    const { data, error } = await this.client.rpc(name, {
      p_empresa: this.companyId,
      ...args,
    });
    if (error) {
      if (["PGRST202", "PGRST204", "42P01", "42703"].includes(error.code))
        throw new AppError(
          503,
          "Aplique a migração 20261019160000_product_pricing.sql no Supabase para habilitar a precificação.",
        );
      if (error.code === "42501")
        throw new AppError(
          403,
          "Você não tem acesso a esse produto ou insumo.",
        );
      if (error.code === "P0001" && known.includes(error.message))
        throw new AppError(409, error.message);
      throw new AppError(
        502,
        "Não foi possível acessar a precificação. Tente novamente.",
      );
    }
    return data;
  }
  data() {
    return this.call("dados_precificacao");
  }
  quote(input: PricingInput) {
    return this.call("calcular_precificacao", { p_dados: input });
  }
  save(id: string, version: string | null, input: PricingInput) {
    return this.call("salvar_precificacao", {
      p_id: id,
      p_versao: version,
      p_dados: input,
    });
  }
}
