import { AppError } from "../errors.ts";
import type { Report, ReportInput, ReportSource } from "./types.ts";
export const reportLabels = {
  revenue: "Faturamento",
  cost: "Custos",
  profit: "Lucro",
  full: "Relatório completo",
};
export function validateReport(input: ReportInput) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (
    !valid(input.start) ||
    !valid(input.end) ||
    input.start > input.end ||
    (Date.parse(input.end) - Date.parse(input.start)) / 86400000 > 366
  )
    throw new AppError(400, "Selecione um período válido de até 367 dias.");
}
export function prepareReport(
  source: ReportSource,
  input: ReportInput,
): Report {
  validateReport(input);
  const rows = source.rows
    .filter((r) => r.date >= input.start && r.date <= input.end)
    .filter(
      (r) =>
        input.scope === "all" ||
        r.kind === "revenue" ||
        r.scope === "professional",
    )
    .filter((r) =>
      input.type === "revenue"
        ? r.kind === "revenue"
        : input.type === "cost"
          ? r.kind === "cost"
          : input.type === "profit"
            ? r.kind === "revenue" || r.scope === "professional"
            : true,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!rows.length)
    throw new AppError(
      422,
      "Nada para exportar: não foram encontrados registros no período e filtros selecionados.",
    );
  if (rows.length > 5000)
    throw new AppError(
      422,
      "Muitos lançamentos. Reduza o período do relatório.",
    );
  const sum = (predicate: (r: (typeof rows)[number]) => boolean) => {
    let total = 0n;
    for (const r of rows.filter(predicate)) {
      const value = Number(r.amount);
      if (!Number.isFinite(value) || Math.abs(value) > 999999999999)
        throw new AppError(
          422,
          "Há valores inválidos no relatório. Revise os lançamentos.",
        );
      total += BigInt(Math.round(value * 100));
    }
    if (total > 9007199254740991n || total < -9007199254740991n)
      throw new AppError(422, "Valores muito altos. Reduza o período.");
    return Number(total) / 100;
  };
  const revenue = sum((r) => r.kind === "revenue"),
    cost = sum((r) => r.kind === "cost" && r.scope === "professional");
  return {
    company: source.company,
    rows,
    input,
    generatedAt: new Date().toISOString(),
    totals: {
      revenue,
      cost,
      personal: sum((r) => r.kind === "cost" && r.scope === "personal"),
      unclassified: sum(
        (r) =>
          r.kind === "cost" && !["personal", "professional"].includes(r.scope),
      ),
      profit: Math.round((revenue - cost) * 100) / 100,
    },
  };
}
