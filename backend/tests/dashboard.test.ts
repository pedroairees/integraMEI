import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateDashboard,
  DashboardService,
  monthOffset,
  parseFilter,
} from "../src/core/dashboard/service.ts";
import type {
  DashboardSource,
  DashboardRepository,
  Tenant,
} from "../src/core/dashboard/types.ts";
import { buildApp } from "../src/web/app.ts";
import { AppError } from "../src/core/errors.ts";

const now = new Date("2026-09-20T15:00:00Z");
const tenant: Tenant = {
  companyId: "company-a",
  profileId: "profile-a",
  role: "owner",
};
const empty = (): DashboardSource => ({
  company: {
    id: "company-a",
    razao_social: "Empresa A",
    meta_faturamento_mensal: 8000,
  },
  sales: [],
  expenses: [],
  items: [],
  categories: [],
  supplies: [],
  alerts: [],
});
const filter = { month: "2026-09", months: 6, scope: "professional" as const };
test("empty dashboard is honest, has no percentages or fabricated projection", () => {
  const d = calculateDashboard(empty(), filter, now);
  assert.equal(d.empty, true);
  assert.equal(d.metrics.profit, 0);
  assert.equal(d.metrics.margin, null);
  assert.equal(d.metrics.revenueChange, null);
  assert.equal(d.goal.projection, null);
  assert.equal(d.evolution.length, 6);
});
test("RN-005: personal withdrawals never lower operational profit; scope only changes expense charts", () => {
  const s = empty();
  s.sales = [{ id: "s", data: "2026-09-01", valor_total: 100 }];
  s.expenses = [
    {
      id: "p",
      data_emissao: "2026-09-02",
      valor_total: 30,
      tipo: "professional",
      categoria_id: null,
    },
    {
      id: "w",
      data_emissao: "2026-09-02",
      valor_total: 20,
      tipo: "personal",
      categoria_id: null,
    },
  ];
  const d = calculateDashboard(s, filter, now),
    personal = calculateDashboard(s, { ...filter, scope: "personal" }, now);
  assert.equal(d.metrics.profit, 70);
  assert.equal(d.metrics.withdrawals, 20);
  assert.equal(d.metrics.margin, 70);
  assert.equal(d.distribution[0]?.value, 30);
  assert.equal(personal.metrics.profit, 70);
  assert.equal(personal.distribution[0]?.value, 20);
});
test("integer cents avoid 0.1 + 0.2 errors; refunds/loss comparisons stay finite", () => {
  const s = empty();
  s.sales = [
    { id: "a", data: "2026-09-01", valor_total: 0.1 },
    { id: "b", data: "2026-09-02", valor_total: 0.2 },
  ];
  assert.equal(calculateDashboard(s, filter, now).metrics.revenue, 0.3);
});
test("projection requires 15 distinct sales days, not 15 transactions", () => {
  const s = empty();
  s.sales = Array.from({ length: 15 }, (_, i) => ({
    id: String(i),
    data: `2026-09-${String(i + 1).padStart(2, "0")}`,
    valor_total: 100,
  }));
  assert.equal(calculateDashboard(s, filter, now).goal.projection, 2250);
  s.sales = s.sales.map((s) => ({ ...s, data: "2026-09-01" }));
  assert.equal(calculateDashboard(s, filter, now).goal.projection, null);
});
test("month boundaries include leap years and comparison across year", () => {
  assert.equal(monthOffset("2026-01", -1), "2025-12");
  assert.throws(() => parseFilter({ month: "2026-13" }, now));
  assert.throws(() => parseFilter({ month: "2026-10" }, now));
  assert.throws(() => parseFilter({ scope: "injected" }, now));
});
test("top supplies only include notes inside selected category/month and visible supplies", () => {
  const s = empty();
  s.categories = [{ id: "c", nome: "Insumos" }];
  s.supplies = [{ id: "i", nome: "Farinha" }];
  s.expenses = [
    {
      id: "n",
      data_emissao: "2026-09-01",
      valor_total: 50,
      tipo: "professional",
      categoria_id: "c",
    },
  ];
  s.items = [
    { nota_fiscal_id: "n", insumo_id: "i", valor_total_item: 40 },
    { nota_fiscal_id: "other-tenant", insumo_id: "i", valor_total_item: 900 },
    { nota_fiscal_id: "n", insumo_id: "invisible", valor_total_item: 900 },
  ];
  assert.deepEqual(
    calculateDashboard(s, filter, now).distribution[0]?.topSupplies,
    [{ id: "i", name: "Farinha", value: 40 }],
  );
});
test("only owners may save valid goals", async () => {
  let saved = 0;
  const repo = {
    saveGoal: async () => {
      saved++;
    },
  } as unknown as DashboardRepository;
  const service = new DashboardService(repo);
  await assert.rejects(service.updateGoal({ ...tenant, role: "member" }, 100));
  for (const value of [-1, Infinity, NaN, 1.234])
    await assert.rejects(service.updateGoal(tenant, value));
  for (const margin of [-1, 101, NaN, 12.123])
    await assert.rejects(service.updateGoal(tenant, 8000, margin));
  await service.updateGoal(tenant, 8000);
  assert.equal(saved, 1);
});
test("HTTP: auth, input validation, OpenAPI and server-side tenant identity", async () => {
  let target = "";
  const repository: DashboardRepository = {
    source: async (t) => {
      target = t.companyId;
      return empty();
    },
    saveGoal: async () => {},
    history: async () => [],
  };
  const app = await buildApp(
    async (token) => {
      if (token !== "valid") throw new AppError(401, "Sessão inválida");
      return { tenant, repository };
    },
    { docs: true },
  );
  try {
    assert.equal((await app.inject({ url: "/v1/dashboard" })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: "/v1/dashboard",
          headers: { authorization: "Bearer forged" },
        })
      ).statusCode,
      401,
    );
    const headers = { authorization: "Bearer valid" };
    assert.equal(
      (
        await app.inject({
          url: "/v1/dashboard?month=2026-09&companyId=other",
          headers,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: "/v1/dashboard?months=900", headers }))
        .statusCode,
      400,
    );
    const response = await app.inject({
      url: "/v1/dashboard?month=2026-09",
      headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().metrics.profit, 0);
    assert.equal(target, "company-a");
    assert.match(response.headers["cache-control"]!, /no-store/);
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/dashboard/goal",
          headers,
          payload: { value: 2000 },
        })
      ).statusCode,
      204,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/dashboard/goal",
          headers,
          payload: { value: -1 },
        })
      ).statusCode,
      400,
    );
    const docs = await app.inject({ url: "/docs/json" });
    assert.equal(docs.statusCode, 200);
    assert.ok(docs.json().paths["/v1/dashboard/goal"]);
  } finally {
    await app.close();
  }
});
