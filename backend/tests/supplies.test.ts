import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { priceSummary, supplyHistory } from "../src/core/supplies/service.ts";
import type {
  PricePoint,
  SuppliesRepository,
  SupplyRecord,
} from "../src/core/supplies/types.ts";
import type { DashboardRepository } from "../src/core/dashboard/types.ts";
import { SupabaseSuppliesRepository } from "../src/infra/supabase/supplies.ts";
import { buildApp } from "../src/web/app.ts";
const supply: SupplyRecord = {
  id: randomUUID(),
  nome: "Farinha",
  unidade_medida: "kg",
  estoque_minimo: 0,
  ativo: true,
  versao_cadastro: randomUUID(),
};
const points: PricePoint[] = [
  {
    id: "a",
    date: "2026-01-01",
    value: 4,
    unit: "kg",
    supplier: "A",
    source: "invoice",
  },
  {
    id: "b",
    date: "2026-01-02",
    value: 6,
    unit: "kg",
    supplier: "B",
    source: "manual",
  },
  {
    id: "c",
    date: "2026-01-02",
    value: 0.02,
    unit: "g",
    supplier: "A",
    source: "invoice",
  },
];
const repository: SuppliesRepository = {
  list: async () => [supply],
  get: async () => supply,
  save: async () => supply,
  prices: async () => points,
  register: async () => {},
  invoices: async () => [],
};
test("history statistics separate units and sources, preserve zero prices, and don't fabricate empty averages", () => {
  const result = priceSummary(points, "kg");
  assert.equal(result.average, 5);
  assert.equal(result.minimum?.supplier, "A");
  assert.equal(result.maximum?.value, 6);
  assert.equal(result.points.length, 2);
  assert.equal(priceSummary([], "kg").average, null);
  assert.equal(priceSummary([{ ...points[0]!, value: 0 }], "kg").average, 0);
});
test("history validates date range and unit and returns real unit alternatives", async () => {
  const result = await supplyHistory(
    repository,
    supply.id,
    "2026-01-01",
    "2026-01-31",
  );
  assert.deepEqual(result.units, ["g", "kg"]);
  assert.equal(result.average, 5);
  for (const [start, end] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-02-02", "2026-01-01"],
    ["2000-01-01", "2026-01-01"],
  ] as const)
    await assert.rejects(
      () => supplyHistory(repository, supply.id, start, end),
      { status: 400 },
    );
  await assert.rejects(
    () => supplyHistory(repository, supply.id, "2026-01-01", "2026-01-31", "l"),
    { status: 400 },
  );
});
test("supply HTTP endpoints require session, reject forged tenant and invalid prices, and support catalog and both price sources", async () => {
  let writes = 0;
  const app = await buildApp(async () => ({
    tenant: { companyId: "trusted", profileId: "profile", role: "owner" },
    repository: {} as DashboardRepository,
    supplies: {
      ...repository,
      register: async () => {
        writes++;
      },
    },
  }));
  const headers = { authorization: "Bearer test" };
  try {
    assert.equal((await app.inject({ url: "/v1/supplies" })).statusCode, 401);
    assert.equal(
      (await app.inject({ url: "/v1/supplies", headers })).statusCode,
      200,
    );
    const payload = { name: "Farinha", unit: "kg", minimum: 0, active: true };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/supplies",
          headers,
          payload,
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/supplies",
          headers,
          payload: { ...payload, companyId: "spoof" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/supplies/${supply.id}`,
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
    const manual = {
      requestId: randomUUID(),
      source: "manual",
      quantity: 0.1,
      price: 1.25,
      date: "2026-01-02",
      supplier: "Loja",
    };
    const send = (p: unknown) =>
      app.inject({
        method: "POST",
        url: `/v1/supplies/${supply.id}/prices`,
        headers,
        payload: p as object,
      });
    assert.equal((await send(manual)).statusCode, 201);
    assert.equal(
      (
        await send({
          requestId: randomUUID(),
          source: "invoice",
          quantity: 2,
          price: 3,
          invoiceId: randomUUID(),
          itemIndex: 0,
        })
      ).statusCode,
      201,
    );
    for (const bad of [
      { ...manual, price: -1 },
      { ...manual, quantity: 0 },
      { ...manual, date: undefined },
      { ...manual, invoiceId: randomUUID() },
      { ...manual, source: "invoice" },
      { ...manual, companyId: "spoof" },
    ])
      assert.equal((await send(bad)).statusCode, 400);
    assert.equal(writes, 2);
    const r = await app.inject({
      url: `/v1/supplies/${supply.id}/prices?start=2026-01-01&end=2026-01-31`,
      headers,
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["cache-control"], "private, no-store");
    assert.equal(r.json().average, 5);
  } finally {
    await app.close();
  }
});
test("repository uses trusted company/owner in queries and RPCs; database diagnostics stay private", async () => {
  const client = createClient("http://localhost:1", "public-key", {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.includes("/rpc/")) {
          const body = JSON.parse(String(init?.body));
          assert.equal(body.p_empresa, "trusted-company");
          return Response.json(
            { code: "PGRST202", message: "private details" },
            { status: 400 },
          );
        }
        assert.equal(url.searchParams.get("empresa_id"), "eq.trusted-company");
        if (url.pathname.endsWith("notas_fiscais"))
          assert.equal(url.searchParams.get("enviado_por"), "eq.trusted-owner");
        return Response.json([]);
      },
    },
  });
  const repo = new SupabaseSuppliesRepository(
    client,
    "trusted-company",
    "trusted-owner",
  );
  await repo.list("%_", 0);
  await repo.invoices();
  await repo.prices(supply.id, "2026-01-01", "2026-01-31");
  await assert.rejects(
    () => repo.save(null, { name: "X", unit: "kg", minimum: 0, active: true }),
    (error) =>
      error instanceof Error &&
      error.message.includes("20261018170000_supplies_management.sql") &&
      !error.message.includes("private"),
  );
});
