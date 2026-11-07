import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../core/errors.ts";
import { timeZones, type SettingsInput } from "../core/settings/types.ts";

export function registerSettings(app: FastifyInstance) {
  const repo = (request: FastifyRequest) => {
    if (!request.sessionContext?.settings)
      throw new AppError(503, "Configurações indisponíveis.");
    return request.sessionContext.settings;
  };
  app.get("/v1/settings", async (r) => repo(r).get());
  app.patch<{ Body: SettingsInput }>(
    "/v1/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "fullName",
            "phone",
            "emailAlerts",
            "invoiceReminders",
            "lowStockAlerts",
            "timeZone",
          ],
          properties: {
            fullName: {
              type: "string",
              minLength: 2,
              maxLength: 160,
              pattern: "^[^\\x00-\\x1F\\x7F]+$",
            },
            phone: { type: "string", pattern: "^[0-9]{10,11}$" },
            emailAlerts: { type: "boolean" },
            invoiceReminders: { type: "boolean" },
            lowStockAlerts: { type: "boolean" },
            timeZone: { type: "string", enum: timeZones },
          },
        },
      },
    },
    async (r) => {
      const fullName = r.body.fullName.trim().replace(/ +/g, " ");
      if (fullName.length < 2)
        throw new AppError(400, "Informe seu nome completo.");
      return repo(r).save({ ...r.body, fullName });
    },
  );
  app.post<{ Body: { email: string } }>(
    "/v1/settings/email",
    {
      config: { rateLimit: { max: 3, timeWindow: "5 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
          },
        },
      },
    },
    async (r) => {
      // Verify that the profile/email synchronization migration is available before contacting Auth.
      await repo(r).get();
      await repo(r).changeEmail(r.body.email.trim().toLowerCase());
      return {
        message:
          "Solicitação de alteração enviada. Confira o e-mail atual e o novo e-mail e siga as confirmações solicitadas. O endereço será atualizado após a confirmação.",
      };
    },
  );
  app.post<{ Body: { currentPassword: string } }>(
    "/v1/settings/password-reset",
    {
      config: { rateLimit: { max: 3, timeWindow: "5 minutes" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (r) => {
      await repo(r).requestPasswordReset(r.body.currentPassword);
      return {
        message:
          "Solicitação de recuperação aceita. Confira a caixa de entrada e o spam do e-mail da sua conta.",
      };
    },
  );
}
