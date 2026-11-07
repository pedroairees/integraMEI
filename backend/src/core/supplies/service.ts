import { AppError } from "../errors.ts";
import type { PricePoint, SuppliesRepository } from "./types.ts";

export function priceSummary(points: PricePoint[], unit: string) {
  const rows = points.filter((p) => p.unit === unit);
  const sum = rows.reduce((total, p) => total + BigInt(Math.round(p.value * 10000)), 0n);
  const count = BigInt(rows.length);
  const sorted = [...rows].sort(
    (a, b) =>
      a.value - b.value ||
      a.date.localeCompare(b.date) ||
      a.id.localeCompare(b.id),
  );
  return {
    points: rows,
    minimum: sorted[0] ?? null,
    maximum: sorted.at(-1) ?? null,
    average: rows.length ? Number((sum * 2n + count) / (count * 2n)) / 10000 : null,
  };
}
function dateValue(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export async function supplyHistory(
  repository: SuppliesRepository,
  id: string,
  start: string,
  end: string,
  unit?: string,
) {
  if (
    !dateValue(start) ||
    !dateValue(end) ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 366 * 3 * 86400000
  )
    throw new AppError(400, "Selecione um período válido de até três anos.");
  const supply = await repository.get(id);
  const points = await repository.prices(id, start, end);
  const units = [
    ...new Set([supply.unidade_medida, ...points.map((p) => p.unit)]),
  ].sort();
  const selectedUnit = unit || supply.unidade_medida;
  if (!units.includes(selectedUnit))
    throw new AppError(400, "Unidade não disponível para esse insumo.");
  return {
    supply,
    units,
    unit: selectedUnit,
    ...priceSummary(points, selectedUnit),
  };
}
