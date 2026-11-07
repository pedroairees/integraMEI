import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, type User } from "@supabase/supabase-js";
import { buildApp } from "../src/web/app.ts";
import type { SessionContext } from "../src/infra/supabase/session.ts";
import { SupabaseSettingsRepository } from "../src/infra/supabase/settings.ts";
import type { Settings, SettingsInput } from "../src/core/settings/types.ts";
const initial: Settings = {
  fullName: "Pessoa da conta",
  phone: "61912345678",
  email: "account@example.test",
  pendingEmail: null,
  cnpj: "12345678000195",
  emailAlerts: false,
  invoiceReminders: true,
  lowStockAlerts: true,
  timeZone: "America/Sao_Paulo",
};
const input: SettingsInput = {
  fullName: initial.fullName,
  phone: initial.phone,
  emailAlerts: false,
  invoiceReminders: true,
  lowStockAlerts: true,
  timeZone: initial.timeZone,
};

test("settings require authentication and validate fields without accepting identity or CNPJ overrides", async () => {
  let saved = { ...initial };
  let recovery = 0;
  let emails = 0;
  const app = await buildApp(
    async () =>
      ({
        settings: {
          get: async () => saved,
          save: async (data: SettingsInput) => (saved = { ...saved, ...data }),
          changeEmail: async () => {
            emails++;
          },
          requestPasswordReset: async () => {
            recovery++;
          },
        },
      }) as unknown as SessionContext,
  );
  const headers = { authorization: "Bearer test" };
  try {
    for (const [method, url, payload] of [
      ["GET", "/v1/settings", undefined],
      ["PATCH", "/v1/settings", input],
      ["POST", "/v1/settings/email", { email: "other@example.test" }],
      ["POST", "/v1/settings/password-reset", { currentPassword: "private" }],
    ] as const) {
      assert.equal(
        (await app.inject({ method, url, payload })).statusCode,
        401,
      );
    }
    const get = await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers,
    });
    assert.equal(get.json().fullName, initial.fullName);
    for (const patch of [
      { companyId: "other" },
      { email: "bypass@example.test" },
      { fullName: "  " },
      { phone: "123" },
      { timeZone: "invalid" },
      { emailAlerts: "yes" },
    ])
      assert.equal(
        (
          await app.inject({
            method: "PATCH",
            url: "/v1/settings",
            headers,
            payload: { ...input, ...patch },
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/settings",
          headers,
          payload: { ...input, fullName: "  Novo  Nome  ", emailAlerts: true },
        })
      ).statusCode,
      200,
    );
    assert.equal(saved.fullName, "Novo Nome");
    assert.equal(saved.email, initial.email);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/settings/email",
          headers,
          payload: { email: "valid@example.test" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/settings/password-reset",
          headers,
          payload: { currentPassword: "private" },
        })
      ).statusCode,
      200,
    );
    assert.equal(emails, 1);
    assert.equal(recovery, 1);
  } finally {
    await app.close();
  }
});

test("settings adapter passes only the verified company and authoritative Auth email", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const client = createClient("http://localhost:1", "public", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return Response.json({ ...initial, email: "stale@example.test" });
      },
    },
  });
  const repo = new SupabaseSettingsRepository(
    client,
    "trusted-company",
    {
      id: "verified-id",
      email: "verified@example.test",
      new_email: "pending@example.test",
    } as User,
    "http://localhost:1",
    "public",
    "jwt",
  );
  assert.equal((await repo.get()).email, "verified@example.test");
  assert.equal((await repo.save(input)).pendingEmail, "pending@example.test");
  assert.equal(calls[0]!.body.p_empresa, "trusted-company");
  assert.equal(calls[1]!.body.p_empresa, "trusted-company");
  assert.deepEqual(calls[1]!.body.p_dados, input);
});
