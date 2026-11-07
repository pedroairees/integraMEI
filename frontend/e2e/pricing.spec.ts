import { test, expect, type Page } from "@playwright/test";
async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    headers: { Origin: "http://localhost:3107" },
    data: {
      cnpj: "12345678000195",
      password: "Only-for-local-tests!42",
      rememberMe: false,
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/precificacao");
}
test("pricing calculates, simulates, saves, reloads and uses current supply prices", async ({
  page,
}) => {
  await login(page);
  const price = page.getByRole("region", {
    name: "Preço sugerido",
    exact: true,
  });
  await page.getByLabel("Produto", { exact: true }).fill("Bolo E2E");
  await page.getByLabel("Custo base unitário (R$)").fill("20");
  await page.getByLabel("Preço de venda atual (opcional)").fill("30");
  await page.getByLabel("Unidades previstas por mês").fill("10");
  await page.getByRole("button", { name: "Sugerir Preço" }).click();
  await expect(price).toContainText("40,00");
  await page.getByLabel("Markup desejado (%)").fill("80");
  await expect(price).toContainText("36,00");
  await expect(page.getByText("R$ 360,00", { exact: true })).toBeVisible();
  await page.getByLabel("Custo base unitário (R$)").fill("0");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Impossível calcular",
  );
  await expect(
    page.getByRole("button", { name: "Salvar produto" }),
  ).toBeDisabled();
  await page.getByLabel("Custo base unitário (R$)").fill("2");
  await page.getByLabel("Markup desejado (%)").fill("100");
  await page.getByRole("button", { name: "Adicionar insumo" }).click();
  await page
    .getByRole("combobox", { name: "Insumo 1", exact: true })
    .selectOption("22222222-2222-4222-8222-222222222222");
  await page.getByLabel("Quantidade 1 (kg)").fill("0,5");
  await expect(price).toContainText("10,00");
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText(/Produto e composição salvos/)).toBeVisible();
  await expect(page.getByLabel("Produtos salvos")).toBeEnabled();
  await expect(page.getByLabel("Produtos salvos")).not.toHaveValue("");
  const id = await page.getByLabel("Produtos salvos").inputValue();
  await page.reload();
  await page.getByLabel("Produtos salvos").selectOption(id);
  await expect(page.getByLabel("Produto", { exact: true })).toHaveValue(
    "Bolo E2E",
  );
  await expect(price).toContainText("10,00");
  const response = await page.request.post(
    "/api/backend/supplies/22222222-2222-4222-8222-222222222222/prices",
    {
      headers: { Origin: "http://localhost:3107" },
      data: {
        requestId: crypto.randomUUID(),
        source: "manual",
        date: new Date().toISOString().slice(0, 10),
        supplier: "Fornecedor E2E",
        quantity: 1,
        price: 16,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Atualizar dados" }).click();
  await expect(price).toContainText("20,00");
  await expect(page.getByText(/Seu custo subiu/)).toContainText("5,00");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `test-results/pricing-functional-${width}.png`,
      fullPage: true,
    });
  }
});
test("pricing preserves drafts on request errors, blocks stale writes, handles missing migration and rejects anonymous requests", async ({
  page,
}) => {
  expect((await page.request.get("/api/backend/pricing")).status()).toBe(401);
  await login(page);
  await page.route("**/api/backend/pricing/quote", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Falha temporária de teste." }),
    }),
  );
  await page.getByLabel("Produto", { exact: true }).fill("Preservar rascunho");
  await page.getByLabel("Custo base unitário (R$)").fill("10");
  await page.getByRole("button", { name: "Sugerir Preço" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Falha temporária",
  );
  await expect(page.getByLabel("Produto", { exact: true })).toHaveValue(
    "Preservar rascunho",
  );
  await page.unroute("**/api/backend/pricing/quote");
  await page.getByRole("button", { name: "Sugerir Preço" }).click();
  await expect(
    page.getByRole("region", { name: "Preço sugerido", exact: true }),
  ).toContainText("20,00");
  await page.route("**/api/backend/pricing/products", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        message: "O produto mudou. Atualize os dados antes de salvar.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(
    page.getByText("O produto mudou. Atualize os dados antes de salvar.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.route("**/api/backend/pricing", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          "Aplique a migração 20261019160000_product_pricing.sql no Supabase para habilitar a precificação.",
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "20261019160000_product_pricing.sql",
  );
  await expect(
    page.getByRole("button", { name: "Salvar produto" }),
  ).toBeDisabled();
});
