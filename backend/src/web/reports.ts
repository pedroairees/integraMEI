import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../core/errors.ts";
import { prepareReport, validateReport } from "../core/reports/service.ts";
import type { ReportInput, ReportMailer } from "../core/reports/types.ts";
import { reportFiles, downloadable } from "../infra/reports/documents.ts";
const properties = {
  start: { type: "string", format: "date" },
  end: { type: "string", format: "date" },
  type: { type: "string", enum: ["revenue", "cost", "profit", "full"] },
  scope: { type: "string", enum: ["professional", "all"] },
  format: { type: "string", enum: ["pdf", "xlsx", "both"] },
  originals: { type: "boolean" },
};
const body = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
};
export function registerReports(app: FastifyInstance, mailer: ReportMailer) {
  let running = 0;
  const repo = (r: FastifyRequest) => {
    if (!r.sessionContext?.reports)
      throw new AppError(503, "Serviço de relatórios indisponível.");
    return r.sessionContext.reports;
  };
  const limited = async <T>(task: () => Promise<T>) => {
    if (running >= 2)
      throw new AppError(
        429,
        "Há relatórios em geração. Tente novamente em instantes.",
      );
    running++;
    try {
      return await task();
    } finally {
      running--;
    }
  };
  app.get("/v1/reports/options", async () => ({
    emailConfigured: mailer.configured,
  }));
  app.post<{ Body: ReportInput }>(
    "/v1/reports/download",
    {
      schema: { body },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (r, reply) =>
      limited(async () => {
        validateReport(r.body);
        const repository = repo(r);
        const report = prepareReport(
          await repository.source(r.body.start, r.body.end),
          r.body,
        );
        const file = await downloadable(await reportFiles(report, repository));
        return reply
          .type(file.mime)
          .header("Content-Disposition", `attachment; filename="${file.name}"`)
          .header("X-Content-Type-Options", "nosniff")
          .send(file.content);
      }),
  );
  app.post<{ Body: ReportInput & { recipient: string; requestId: string } }>(
    "/v1/reports/email",
    {
      schema: {
        body: {
          ...body,
          required: [...body.required, "recipient", "requestId"],
          properties: {
            ...properties,
            recipient: {
              type: "string",
              format: "email",
              maxLength: 254,
              pattern: "^[^\\s<>@,;]+@[^\\s<>@,;]+$",
            },
            requestId: { type: "string", format: "uuid" },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (r) =>
      limited(async () => {
        if (!mailer.configured)
          throw new AppError(
            503,
            "Envio de e-mail ainda não configurado. Configure SMTP no backend; o download continua disponível.",
          );
        const { recipient, requestId, ...input } = r.body;
        validateReport(input);
        const repository = repo(r);
        const report = prepareReport(
          await repository.source(input.start, input.end),
          input,
        );
        const files = await reportFiles(report, repository);
        const hash = createHash("sha256")
          .update(
            JSON.stringify([
              input.start,
              input.end,
              input.type,
              input.scope,
              input.format,
              input.originals,
              recipient.toLowerCase(),
            ]),
          )
          .digest("hex");
        const state = await repository.reserve(requestId, hash);
        if (state === "sent")
          return {
            message:
              "Este envio já foi aceito pelo servidor de e-mail. Confira a caixa de entrada e o spam.",
          };
        if (state !== "reserved")
          throw new AppError(
            409,
            "Este envio já foi iniciado. Confira o destinatário antes de iniciar um novo envio para evitar duplicidade.",
          );
        try {
          await mailer.send(recipient, files, requestId);
          await repository.finish(requestId, "sent");
        } catch {
          try {
            await repository.finish(requestId, "uncertain");
          } catch {
            /* The durable processing reservation still prevents an automatic resend. */
          }
          throw new AppError(
            502,
            "Não foi possível confirmar o envio. Confira a caixa de entrada e o spam do destinatário antes de tentar um novo envio.",
          );
        }
        return {
          message:
            "Relatório aceito pelo servidor de e-mail. Confira a caixa de entrada e o spam do destinatário.",
        };
      }),
  );
}
