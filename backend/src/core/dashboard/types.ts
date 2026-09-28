export type Scope = "professional" | "personal" | "all";
export interface DashboardFilter {
  month: string;
  months: number;
  scope: Scope;
}
export interface Company {
  id: string;
  razao_social: string;
  meta_faturamento_mensal: number;
  meta_margem_lucro_percentual?: number | null;
}
export interface Sale {
  id: string;
  data: string;
  valor_total: number;
}
export interface Expense {
  id: string;
  data_emissao: string;
  valor_total: number;
  tipo: Scope | "unclassified";
  categoria_id: string | null;
}
export interface Category {
  id: string;
  nome: string;
}
export interface Item {
  nota_fiscal_id: string;
  insumo_id: string | null;
  valor_total_item: number;
}
export interface Supply {
  id: string;
  nome: string;
}
export interface Alert {
  id: string;
  mensagem: string;
  lido_em: string | null;
  criado_em: string;
}
export interface DashboardSource {
  company: Company;
  sales: Sale[];
  expenses: Expense[];
  categories: Category[];
  items: Item[];
  supplies: Supply[];
  alerts: Alert[];
}
export interface Tenant {
  companyId: string;
  profileId: string;
  role: string;
}
export interface DashboardRepository {
  source(tenant: Tenant, start: string, end: string): Promise<DashboardSource>;
  saveGoal(
    tenant: Tenant,
    revenue: number,
    marginTarget?: number | null,
  ): Promise<void>;
  history(
    tenant: Tenant,
    supplyId: string,
    start: string,
    end: string,
  ): Promise<{ date: string; value: number; unit: string; supplier: string }[]>;
}
