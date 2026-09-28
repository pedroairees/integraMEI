// Public response contract; no server secrets or database clients enter the browser.
export interface DashboardData {
  filter: { month: string; months: number; scope: string };
  companyName: string;
  canEditGoal: boolean;
  empty: boolean;
  updatedAt: string;
  insight: string;
  marginTarget: number | null;
  metrics: {
    revenue: number;
    costs: number;
    profit: number;
    withdrawals: number;
    margin: number | null;
    revenueChange: number | null;
    costChange: number | null;
    profitChange: number | null;
  };
  goal: {
    value: number;
    percentage: number | null;
    projection: number | null;
    projectedToReach: boolean | null;
    daysWithSales: number;
  };
  evolution: { month: string; value: number }[];
  distribution: {
    id: string;
    name: string;
    value: number;
    percentage: number;
    topSupplies: { id: string; name: string; value: number }[];
  }[];
  alerts: {
    id: string;
    mensagem: string;
    lido_em: string | null;
    criado_em: string;
  }[];
}
export const currency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );
export const percentage = (value: number) =>
  `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;
export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
