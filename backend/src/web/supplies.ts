import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../core/errors.ts";
import { supplyHistory } from "../core/supplies/service.ts";
import type { SupplyInput, PriceInput } from "../core/supplies/types.ts";
const uuid = { type: "string", format: "uuid" };
export function registerSupplies(app: FastifyInstance) {
  const repo = (request: FastifyRequest) => {
    if (!request.sessionContext?.supplies)
      throw new AppError(503, "Serviço de insumos indisponível.");
    return request.sessionContext.supplies;
  };
  const common = { tags: ["Insumos"], security: [{ bearerAuth: [] }] };
  const params = { type: "object", required: ["id"], properties: { id: uuid } };
  const input = {
    type: "object",
    additionalProperties: false,
    required: ["name", "unit", "minimum", "active"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" },
      unit: { type: "string", pattern: "^[a-z0-9²³]{1,12}$" },
      minimum: {
        type: "number",
        minimum: 0,
        maximum: 999999999,
      },
      active: { type: "boolean" },
      version: uuid,
    },
  };
  app.get<{ Querystring: { q?: string; offset?: number } }>(
    "/v1/supplies",
    {
      schema: {
        ...common,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 120 },
            offset: { type: "integer", minimum: 0, maximum: 100000 },
          },
        },
      },
    },
    async (r) => ({
      supplies: await repo(r).list(r.query.q ?? "", r.query.offset ?? 0),
    }),
  );
  app.get("/v1/supplies/invoices", { schema: common }, async (r) => ({
    invoices: await repo(r).invoices(),
  }));
  app.post<{ Body: SupplyInput }>(
    "/v1/supplies",
    { schema: { ...common, body: input } },
    async (r, reply) =>
      reply.code(201).send({ supply: await repo(r).save(null, r.body) }),
  );
  app.patch<{ Params: { id: string }; Body: SupplyInput }>(
    "/v1/supplies/:id",
    {
      schema: {
        ...common,
        params,
        body: { ...input, required: [...input.required, "version"] },
      },
    },
    async (r) => ({ supply: await repo(r).save(r.params.id, r.body) }),
  );
  app.get<{
    Params: { id: string };
    Querystring: { start: string; end: string; unit?: string };
  }>(
    "/v1/supplies/:id/prices",
    {
      schema: {
        ...common,
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["start", "end"],
          properties: {
            start: { type: "string", format: "date" },
            end: { type: "string", format: "date" },
            unit: { type: "string", maxLength: 30 },
          },
        },
      },
    },
    async (r) =>
      supplyHistory(
        repo(r),
        r.params.id,
        r.query.start,
        r.query.end,
        r.query.unit,
      ),
  );
  app.post<{ Params: { id: string }; Body: PriceInput }>(
    "/v1/supplies/:id/prices",
    {
      schema: {
        ...common,
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "source", "quantity", "price"],
          properties: {
            requestId: uuid,
            source: { type: "string", enum: ["manual", "invoice"] },
            invoiceId: uuid,
            itemIndex: { type: "integer", minimum: 0, maximum: 199 },
            date: { type: "string", format: "date" },
            quantity: {
              type: "number",
              exclusiveMinimum: 0,
              maximum: 999999999,
            },
            price: {
              type: "number",
              minimum: 0,
              maximum: 999999999,
            },
            supplier: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              pattern: "\\S",
            },
          },
          allOf: [
            {
              if: { properties: { source: { const: "manual" } } },
              then: {
                required: ["date", "supplier"],
                not: {
                  anyOf: [
                    { required: ["invoiceId"] },
                    { required: ["itemIndex"] },
                  ],
                },
              },
            },
            {
              if: { properties: { source: { const: "invoice" } } },
              then: {
                required: ["invoiceId", "itemIndex"],
                not: {
                  anyOf: [{ required: ["date"] }, { required: ["supplier"] }],
                },
              },
            },
          ],
        },
      },
    },
    async (r, reply) => {
      await repo(r).register(r.params.id, r.body);
      return reply.code(201).send({ success: true });
    },
  );
}
