import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../src/web/app.ts";
import { SupabasePricingRepository } from "../src/infra/supabase/pricing.ts";
import type { DashboardRepository } from "../src/core/dashboard/types.ts";
const input = {
  name: "Bolo",
  baseCost: 20,
  markup: 100,
  currentPrice: null,
  monthlyUnits: 0,
  ingredients: [],
};
test("pricing routes require auth, validate inputs and keep tenancy out of payload", async () => {
  let saved = 0;
  const app = await buildApp(async () => ({
    tenant: { companyId: randomUUID(), profileId: randomUUID(), role: "owner" },
    repository: {} as DashboardRepository,
    pricing: {
      data: async () => ({ products: [] }),
      quote: async (draft) => {
        assert.equal(draft.currentPrice, null);
        return { suggestedPrice: 40 };
      },
      save: async () => {
        saved++;
        return { success: true };
      },
    },
  }));
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/pricing" })).statusCode,
      401,
    );
    const headers = { authorization: "Bearer test" };
    for (const baseCost of [6.99, 2.51, 0.29])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/pricing/quote",
            headers,
            payload: { ...input, baseCost },
          })
        ).statusCode,
        200,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/pricing/quote",
          headers,
          payload: input,
        })
      ).statusCode,
      200,
    );
    for (const patch of [
      { markup: -1 },
      { companyId: randomUUID() },
      { baseCost: 0.001 },
      { monthlyUnits: 1.5 },
      { ingredients: [{ supplyId: randomUUID(), quantity: 0 }] },
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/pricing/quote",
            headers,
            payload: { ...input, ...patch },
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/pricing/products",
          headers,
          payload: { ...input, id: randomUUID(), version: null },
        })
      ).statusCode,
      200,
    );
    assert.equal(saved, 1);
  } finally {
    await app.close();
  }
});
test("pricing repository uses trusted tenant and sanitizes unknown database failures", async () => {
  let calls: { path: string; body: Record<string, unknown> }[] = [];
  let failure: string | null = null;
  const client = createClient("http://localhost:9999", "test", {
    global: {
      fetch: async (url, init) => {
        calls.push({ path: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify(
            failure
              ? { code: failure, message: "private db detail" }
              : { suggestedPrice: 40 },
          ),
          {
            status: failure ? 400 : 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
  });
  const repo = new SupabasePricingRepository(client, "trusted-company");
  await repo.data();
  await repo.quote(input);
  await repo.save("product", null, input);
  assert.ok(calls.every((c) => c.body.p_empresa === "trusted-company"));
  assert.match(calls[2]!.path, /salvar_precificacao/);
  failure = "PGRST202";
  await assert.rejects(() => repo.data(), /20261019160000_product_pricing/);
  failure = "XX000";
  await assert.rejects(
    () => repo.quote(input),
    (error) => error instanceof Error && !error.message.includes("private"),
  );
});
