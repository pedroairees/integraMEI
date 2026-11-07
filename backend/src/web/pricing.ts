import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../core/errors.ts";
import type { PricingInput } from "../core/pricing/types.ts";
const uuid = { type: "string", format: "uuid" };
const money = {
  type: "number",
  minimum: 0,
  maximum: 999999999,
};
const properties = {
  name: { type: "string", minLength: 1, maxLength: 160, pattern: "\\S" },
  baseCost: money,
  markup: { type: "number", minimum: 0, maximum: 9999.99 },
  currentPrice: { ...money, type: ["number", "null"] },
  monthlyUnits: { type: "integer", minimum: 0, maximum: 1000000 },
  ingredients: {
    type: "array",
    maxItems: 50,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["supplyId", "quantity"],
      properties: {
        supplyId: uuid,
        quantity: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 999999999,
        },
      },
    },
  },
};
const body = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
};
// Decimal validation without binary floating-point modulo (e.g. 6.99 / .01).
function validateDecimals(input: PricingInput) {
  const decimal = (n: number, places: number) =>
    new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(String(n));
  if (
    ![
      input.baseCost,
      input.markup,
      ...(input.currentPrice === null ? [] : [input.currentPrice]),
    ].every((n) => decimal(n, 2)) ||
    !input.ingredients.every((i) => decimal(i.quantity, 3))
  ) {
    throw new AppError(
      400,
      "Use até duas casas decimais nos valores e três nas quantidades.",
    );
  }
}
export function registerPricing(app: FastifyInstance) {
  const repo = (r: FastifyRequest) => {
    if (!r.sessionContext?.pricing)
      throw new AppError(503, "Serviço de precificação indisponível.");
    return r.sessionContext.pricing;
  };
  app.get("/v1/pricing", async (r) => repo(r).data());
  app.post<{ Body: PricingInput }>(
    "/v1/pricing/quote",
    { schema: { body } },
    async (r) => {
      validateDecimals(r.body);
      return repo(r).quote(r.body);
    },
  );
  app.post<{ Body: PricingInput & { id: string; version: string | null } }>(
    "/v1/pricing/products",
    {
      schema: {
        body: {
          ...body,
          required: [...body.required, "id", "version"],
          properties: {
            ...properties,
            id: uuid,
            version: { type: ["string", "null"], format: "uuid" },
          },
        },
      },
    },
    async (r) => {
      const { id, version, ...input } = r.body;
      validateDecimals(input);
      return repo(r).save(id, version, input);
    },
  );
}
