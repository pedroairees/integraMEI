import { AppError } from "../errors.ts";
import type {
  DashboardFilter,
  DashboardRepository,
  DashboardSource,
  Tenant,
} from "./types.ts";

export function currentMonth(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .slice(0, 7);
}
export function monthOffset(month: string, offset: number) {
  const [year, value] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, value - 1 + offset, 1))
    .toISOString()
    .slice(0, 7);
}
export function parseFilter(
  query: Record<string, unknown>,
  now = new Date(),
): DashboardFilter {
  const month = String(query.month ?? currentMonth(now));
  const months = Number(query.months ?? 6);
  const scope = query.scope ?? "professional";
  if (
    !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month) ||
    month > currentMonth(now) ||
    ![3, 6, 12].includes(months) ||
    !["professional", "personal", "all"].includes(String(scope))
  ) {
    throw new AppError(
      400,
      "Selecione um mês válido (não futuro), visão e intervalo de 3, 6 ou 12 meses.",
    );
  }
  return { month, months, scope: scope as DashboardFilter["scope"] };
}
// Values are summed as integer cents; presentation is the frontend's responsibility.
const cents = (value: number) => Math.round(Number(value) * 100);
const money = (value: number) => value / 100;
const percent = (value: number) => Math.round(value * 100) / 100;
const change = (current: number, previous: number) =>
  previous === 0
    ? null
    : percent(((current - previous) / Math.abs(previous)) * 100);

export function calculateDashboard(
  source: DashboardSource,
  filter: DashboardFilter,
  now = new Date(),
) {
  const { month, months, scope } = filter;
  const previous = monthOffset(month, -1);
  const selectedExpenses = source.expenses.filter(
    (e) => e.tipo === "professional" || e.tipo === "personal",
  );
  const sumSales = (m: string) =>
    source.sales
      .filter((s) => s.data.slice(0, 7) === m)
      .reduce((n, s) => n + cents(s.valor_total), 0);
  const sumExpenses = (m: string, type: string) =>
    selectedExpenses
      .filter((e) => e.data_emissao.slice(0, 7) === m && e.tipo === type)
      .reduce((n, e) => n + cents(e.valor_total), 0);
  const revenue = sumSales(month),
    costs = sumExpenses(month, "professional"),
    withdrawals = sumExpenses(month, "personal");
  const previousRevenue = sumSales(previous),
    previousCosts = sumExpenses(previous, "professional");
  const visible = selectedExpenses.filter(
    (e) =>
      e.data_emissao.slice(0, 7) === month &&
      (scope === "all" || e.tipo === scope),
  );
  const distribution = new Map<
    string,
    {
      id: string;
      name: string;
      value: number;
      topSupplies: { id: string; name: string; value: number }[];
    }
  >();
  for (const expense of visible) {
    const id = expense.categoria_id ?? "uncategorized";
    const entry = distribution.get(id) ?? {
      id,
      name: source.categories.find((c) => c.id === id)?.nome ?? "Sem categoria",
      value: 0,
      topSupplies: [],
    };
    entry.value += cents(expense.valor_total);
    distribution.set(id, entry);
  }
  const total = [...distribution.values()].reduce((n, e) => n + e.value, 0);
  const categories = [...distribution.values()]
    .sort((a, b) => b.value - a.value)
    .map((entry) => {
      const noteIds = new Set(
        visible
          .filter((e) => (e.categoria_id ?? "uncategorized") === entry.id)
          .map((e) => e.id),
      );
      const supplies = new Map<string, number>();
      for (const item of source.items)
        if (
          item.insumo_id &&
          noteIds.has(item.nota_fiscal_id) &&
          source.supplies.some((s) => s.id === item.insumo_id)
        ) {
          supplies.set(
            item.insumo_id,
            (supplies.get(item.insumo_id) ?? 0) + cents(item.valor_total_item),
          );
        }
      return {
        ...entry,
        value: money(entry.value),
        percentage: total ? percent((entry.value / total) * 100) : 0,
        topSupplies: [...supplies]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id, value]) => ({
            id,
            name: source.supplies.find((s) => s.id === id)!.nome,
            value: money(value),
          })),
      };
    });
  const goal = cents(source.company.meta_faturamento_mensal);
  const daysWithSales = new Set(
    source.sales.filter((s) => s.data.slice(0, 7) === month).map((s) => s.data),
  ).size;
  const daysInMonth =
    (new Date(`${monthOffset(month, 1)}-01T00:00:00Z`).getTime() -
      new Date(`${month}-01T00:00:00Z`).getTime()) /
    86400000;
  const todayDay = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
    }).format(now),
  );
  const elapsed = month === currentMonth(now) ? todayDay : daysInMonth;
  const projected =
    daysWithSales >= 15 ? Math.round((revenue / elapsed) * daysInMonth) : null;
  const revenueChange = change(revenue, previousRevenue),
    costChange = change(costs, previousCosts);
  return {
    filter,
    companyName: source.company.razao_social,
    metrics: {
      revenue: money(revenue),
      costs: money(costs),
      profit: money(revenue - costs),
      withdrawals: money(withdrawals),
      margin: revenue ? percent(((revenue - costs) / revenue) * 100) : null,
      revenueChange,
      costChange,
      profitChange: change(revenue - costs, previousRevenue - previousCosts),
    },
    goal: {
      value: money(goal),
      percentage: goal ? percent((revenue / goal) * 100) : null,
      projection: projected === null ? null : money(projected),
      projectedToReach:
        projected !== null && goal > 0 ? projected >= goal : null,
      daysWithSales,
    },
    marginTarget: source.company.meta_margem_lucro_percentual ?? null,
    evolution: Array.from({ length: months }, (_, i) => {
      const m = monthOffset(month, i - months + 1);
      return {
        month: m,
        value: money(
          scope === "all"
            ? sumExpenses(m, "professional") + sumExpenses(m, "personal")
            : sumExpenses(m, scope),
        ),
      };
    }),
    distribution: categories,
    alerts: source.alerts,
    empty:
      source.sales.every((s) => s.data.slice(0, 7) !== month) &&
      !selectedExpenses.some((e) => e.data_emissao.slice(0, 7) === month),
    insight:
      revenueChange === null || costChange === null
        ? "Sem base suficiente no mês anterior para comparar receita e custos."
        : `Receita: ${revenueChange.toFixed(2)}%; custos profissionais: ${costChange.toFixed(2)}% em relação ao mês anterior.`,
    updatedAt: now.toISOString(),
  };
}
export class DashboardService {
  repository: DashboardRepository;
  constructor(repository: DashboardRepository) {
    this.repository = repository;
  }
  async get(tenant: Tenant, filter: DashboardFilter) {
    const source = await this.repository.source(
      tenant,
      `${monthOffset(filter.month, -Math.max(filter.months - 1, 1))}-01`,
      `${monthOffset(filter.month, 1)}-01`,
    );
    return {
      ...calculateDashboard(source, filter),
      canEditGoal: tenant.role === "owner",
    };
  }
  async updateGoal(
    tenant: Tenant,
    value: number,
    marginTarget?: number | null,
  ) {
    if (tenant.role !== "owner")
      throw new AppError(403, "Somente o proprietário pode alterar a meta.");
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 999999999 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
    )
      throw new AppError(
        400,
        "Informe uma meta válida com até duas casas decimais.",
      );
    if (
      marginTarget !== undefined &&
      marginTarget !== null &&
      (!Number.isFinite(marginTarget) ||
        marginTarget < 0 ||
        marginTarget > 100 ||
        Math.abs(marginTarget * 100 - Math.round(marginTarget * 100)) > 0.00001)
    )
      throw new AppError(
        400,
        "Informe uma meta de margem entre 0 e 100% com até duas casas decimais.",
      );
    await this.repository.saveGoal(tenant, value, marginTarget);
  }
}
