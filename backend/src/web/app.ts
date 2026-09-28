import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { AppError } from "../core/errors.ts";
import {
  DashboardService,
  monthOffset,
  parseFilter,
} from "../core/dashboard/service.ts";
import type {
  ResolveSession,
  SessionContext,
} from "../infra/supabase/session.ts";
import {
  dashboardSchema,
  errorSchema,
  filterSchema,
  historySchema,
} from "./schemas.ts";

declare module "fastify" {
  interface FastifyRequest {
    sessionContext: SessionContext | null;
  }
}
export async function buildApp(
  resolveSession: ResolveSession,
  options: { logger?: boolean; docs?: boolean } = {},
) {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: ["req.headers.authorization", "req.headers.cookie"],
          serializers: {
            req: (request) => ({
              method: request.method,
              url: request.url?.split("?")[0],
            }),
          },
        }
      : false,
    bodyLimit: 8192,
    requestTimeout: 20000,
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "IntegraMEI API",
        version: "0.1.0",
        description:
          "US004: dashboard financeiro autenticado. Valores em BRL. Custos somente de notas confirmadas; lucro exclui retiradas pessoais (RN-005).",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  if (options.docs) await app.register(swaggerUi, { routePrefix: "/docs" });
  app.decorateRequest("sessionContext", null);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!request.url.startsWith("/v1/")) return;
    const token = /^Bearer (\S+)$/.exec(
      request.headers.authorization ?? "",
    )?.[1];
    if (!token)
      throw new AppError(401, "Entre na sua conta para acessar os dados.");
    request.sessionContext = await resolveSession(token);
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof AppError
        ? error.status
        : (error as { validation?: unknown }).validation
          ? 400
          : (error as { statusCode?: number }).statusCode === 429
            ? 429
            : 500;
    if (status >= 500)
      request.log.error(
        { code: (error as { code?: string }).code, status },
        "Falha ao processar requisição",
      );
    void reply
      .code(status)
      .send({
        message:
          error instanceof AppError
            ? error.message
            : status === 400
              ? "Dados inválidos. Confira os filtros e valores informados."
              : status === 429
                ? "Muitas tentativas. Aguarde um minuto."
                : "Não foi possível processar a solicitação agora.",
      });
  });
  app.get(
    "/health",
    {
      schema: {
        description: "Disponibilidade do processo (não testa o banco).",
        response: {
          200: { type: "object", properties: { status: { type: "string" } } },
        },
      },
    },
    async () => ({ status: "ok" }),
  );
  const common = {
    tags: ["Dashboard"],
    security: [{ bearerAuth: [] }],
    response: {
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      502: errorSchema,
    },
  };
  app.get<{ Querystring: Record<string, unknown> }>(
    "/v1/dashboard",
    {
      schema: {
        ...common,
        description:
          "Resumo por mês, visão e intervalo. Projeção exige 15 dias distintos com vendas no mês; sem base, retorna null.",
        querystring: filterSchema,
        response: { ...common.response, 200: dashboardSchema },
      },
    },
    async (request) => {
      const { tenant, repository } = request.sessionContext!;
      return new DashboardService(repository).get(
        tenant,
        parseFilter(request.query),
      );
    },
  );
  app.patch<{ Body: { value: number; marginTarget?: number | null } }>(
    "/v1/dashboard/goal",
    {
      schema: {
        ...common,
        description:
          "Define metas da empresa. Apenas owner. value=0 remove a meta de receita; marginTarget=null remove a meta de margem.",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: {
            value: { type: "number", minimum: 0, maximum: 999999999 },
            marginTarget: {
              anyOf: [
                { type: "number", minimum: 0, maximum: 100 },
                { type: "null" },
              ],
            },
          },
        },
        response: { ...common.response, 204: { type: "null" } },
      },
    },
    async (request, reply) => {
      const { tenant, repository } = request.sessionContext!;
      await new DashboardService(repository).updateGoal(
        tenant,
        request.body.value,
        request.body.marginTarget,
      );
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    "/v1/supplies/:id/history",
    {
      schema: {
        ...common,
        description:
          "Preços unitários do insumo e fornecedores no intervalo selecionado. Nunca mistura empresas nem unidades.",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        querystring: filterSchema,
        response: { ...common.response, 200: historySchema, 404: errorSchema },
      },
    },
    async (request) => {
      const { tenant, repository } = request.sessionContext!,
        filter = parseFilter(request.query);
      return repository.history(
        tenant,
        request.params.id,
        `${monthOffset(filter.month, 1 - filter.months)}-01`,
        `${monthOffset(filter.month, 1)}-01`,
      );
    },
  );
  return app;
}
