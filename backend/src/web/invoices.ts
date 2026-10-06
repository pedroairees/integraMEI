import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../core/errors.ts";
import { InvoiceService, MAX_UPLOAD_BODY } from "../core/invoices/service.ts";
import type { InvoiceFilter, InvoiceReader } from "../core/invoices/types.ts";
import { ResilientInvoiceReader } from "../infra/ocr/reader.ts";

export function registerInvoices(app: FastifyInstance, reader?: InvoiceReader) {
  const service = (request: FastifyRequest) => {
    const repository = request.sessionContext?.invoices;
    if (!repository)
      throw new AppError(503, "Serviço de notas não disponível.");
    return new InvoiceService(
      repository,
      reader ??
        new ResilientInvoiceReader({
          report: (event) =>
            request.log[event.outcome === "success" ? "info" : "warn"](
              event,
              "Leitura de nota por IA",
            ),
        }),
    );
  };
  const common = { tags: ["Notas fiscais"], security: [{ bearerAuth: [] }] };
  const params = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  };
  app.post<{ Params: { id: string }; Body: { version: string; scope: "professional" | "personal" } }>(
    "/v1/invoices/:id/post",
    { schema: { ...common, params, body: {
      type: "object", additionalProperties: false, required: ["version", "scope"],
      properties: { version: { type: "string", format: "uuid" }, scope: { type: "string", enum: ["professional", "personal"] } },
    } } },
    async request => ({ invoice: await service(request).post(request.params.id, request.body.version, request.body.scope) }),
  );
  app.delete<{ Params: { id: string }; Body: { reason: string } }>(
    "/v1/invoices/:id",
    {
      schema: {
        ...common,
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: {
            reason: { type: "string", minLength: 10, maxLength: 1000 },
          },
        },
        description:
          "Exclui a nota pendente da conta e seu arquivo privado. Operação irreversível.",
      },
    },
    async (request) => {
      await service(request).delete(request.params.id, request.body.reason);
      return { success: true };
    },
  );
  app.get<{ Querystring: InvoiceFilter }>(
    "/v1/invoices",
    {
      schema: {
        ...common,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["revenue", "cost"],
              default: "revenue",
            },
            period: {
              type: "string",
              enum: ["current", "previous", "all"],
              default: "current",
            },
            offset: {
              type: "integer",
              minimum: 0,
              maximum: 100000,
              default: 0,
            },
          },
        },
      },
    },
    async (request) => ({
      invoices: await service(request).repository.list(request.query),
    }),
  );
  app.post<{
    Body: {
      name: string;
      mime: string;
      content: string;
      kind: "revenue" | "cost";
    };
  }>(
    "/v1/invoices",
    {
      bodyLimit: MAX_UPLOAD_BODY,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        ...common,
        description:
          "Guarda arquivo privado e rascunho da nota. Não lança valores no financeiro.",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "mime", "content", "kind"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            mime: {
              type: "string",
              enum: ["application/pdf", "image/jpeg", "image/png"],
            },
            content: {
              type: "string",
              minLength: 4,
              maxLength: MAX_UPLOAD_BODY,
            },
            kind: { type: "string", enum: ["revenue", "cost"] },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await service(request).upload(request.body);
      return reply.code(result.duplicate ? 200 : 201).send(result);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/invoices/:id/read",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { ...common, params },
    },
    async (request) => ({
      invoice: await service(request).read(request.params.id),
    }),
  );
  app.patch<{
    Params: { id: string };
    Body: { version: string; data: unknown };
  }>(
    "/v1/invoices/:id",
    {
      bodyLimit: 128 * 1024,
      schema: {
        ...common,
        params,
        body: {
          type: "object",
          required: ["version", "data"],
          additionalProperties: false,
          properties: {
            version: { type: "string", format: "uuid" },
            data: {
              type: "object",
              additionalProperties: false,
              required: ["supplier", "cnpj", "date", "total", "items"],
              properties: {
                supplier: { type: "string", minLength: 1, maxLength: 200 },
                cnpj: { type: "string", pattern: "^[0-9]{14}$" },
                recipientCnpj: {
                  type: ["string", "null"],
                  pattern: "^[0-9]{14}$",
                },
                operation: {
                  type: ["string", "null"],
                  enum: ["sale", "service", "other", null],
                },
                number: { type: ["string", "null"], maxLength: 80 },
                date: { type: "string", format: "date" },
                total: { type: "number", minimum: 0, maximum: 999999999.99 },
                items: {
                  type: "array",
                  minItems: 1,
                  maxItems: 200,
                  items: { type: "string", minLength: 1, maxLength: 500 },
                },
              },
            },
          },
        },
      },
    },
    async (request) => ({
      invoice: await service(request).review(
        request.params.id,
        request.body.version,
        request.body.data,
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/v1/invoices/:id/file",
    { schema: { ...common, params } },
    async (request, reply) => {
      const repository = service(request).repository;
      const invoice = await repository.get(request.params.id);
      const file = await repository.download(invoice);
      return reply
        .header("Content-Type", invoice.mime_arquivo)
        .header(
          "Content-Disposition",
          `attachment; filename="nota.${invoice.mime_arquivo === "application/pdf" ? "pdf" : invoice.mime_arquivo === "image/png" ? "png" : "jpg"}"; filename*=UTF-8''${encodeURIComponent(invoice.nome_arquivo)}`,
        )
        .header("X-Content-Type-Options", "nosniff")
        .send(file);
    },
  );
}
