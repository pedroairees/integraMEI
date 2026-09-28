const number = { type: "number" } as const;
const nullableNumber = { anyOf: [number, { type: "null" }] } as const;
const text = { type: "string" } as const;
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  additionalProperties: false,
});
const array = (items: unknown) => ({ type: "array", items });
export const errorSchema = object({ message: text });
export const filterSchema = {
  ...object({
    month: { type: "string", pattern: "^20[0-9]{2}-(0[1-9]|1[0-2])$" },
    months: { type: "integer", enum: [3, 6, 12] },
    scope: { type: "string", enum: ["professional", "personal", "all"] },
  }),
};
export const historySchema = array(
  object({ date: text, value: number, unit: text, supplier: text }),
);
export const dashboardSchema = object({
  filter: filterSchema,
  companyName: text,
  canEditGoal: { type: "boolean" },
  empty: { type: "boolean" },
  updatedAt: text,
  insight: text,
  marginTarget: nullableNumber,
  metrics: object(
    Object.fromEntries(
      [
        "revenue",
        "costs",
        "profit",
        "withdrawals",
        "margin",
        "revenueChange",
        "costChange",
        "profitChange",
      ].map((k) => [k, nullableNumber]),
    ),
  ),
  goal: object({
    value: number,
    percentage: nullableNumber,
    projection: nullableNumber,
    projectedToReach: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    daysWithSales: number,
  }),
  evolution: array(object({ month: text, value: number })),
  distribution: array(
    object({
      id: text,
      name: text,
      value: number,
      percentage: number,
      topSupplies: array(object({ id: text, name: text, value: number })),
    }),
  ),
  alerts: array(
    object({
      id: text,
      mensagem: text,
      lido_em: { anyOf: [text, { type: "null" }] },
      criado_em: text,
    }),
  ),
});
