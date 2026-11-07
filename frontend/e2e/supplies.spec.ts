import { test, expect } from "@playwright/test";
test("supplies persist catalog and manual/invoice prices, filter history, and keep financial totals unchanged", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const headers = { Origin: "http://localhost:3107" };
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers,
        data: {
          cnpj: "12345678000195",
          password: "Only-for-local-tests!42",
          rememberMe: false,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/insumos");
  // The first backend-proxy request also compiles the Next dev route on a cold cache.
  await expect(
    page.getByRole("button", { name: "Farinha (kg)", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Novo insumo", exact: true }).click();
  const form = page.getByRole("form", { name: "Cadastrar insumo" });
  await form.getByLabel("Nome do insumo").fill("Manteiga E2E");
  await form.getByLabel("Unidade de medida").fill("kg");
  await form.getByRole("button", { name: "Salvar insumo" }).click();
  await expect(page.getByText("Insumo salvo na sua empresa.")).toBeVisible();
  await expect(page.getByText(/Histórico indisponível/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Histórico real/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Registrar preço", exact: true })
    .click();
  const price = page.getByRole("form", { name: "Registrar preço" });
  await price.getByLabel("Origem do preço").selectOption("manual");
  await price.getByLabel("Fornecedor", { exact: true }).fill("Loja manual E2E");
  await price.getByLabel("Quantidade (kg)", { exact: true }).fill("2");
  await price.getByLabel("Preço unitário (R$/kg)", { exact: true }).fill("5.5");
  await price.getByRole("checkbox").check();
  await price.getByRole("button", { name: "Salvar preço" }).click();
  await expect(page.getByRole("img", { name: /Histórico real/ })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Manteiga E2E (kg)", exact: true })
    .click();
  await expect(page.getByRole("img", { name: /Histórico real/ })).toBeVisible();
  await page.getByText("Ver histórico em tabela").click();
  await expect(
    page.getByRole("cell", { name: "Loja manual E2E", exact: true }),
  ).toBeVisible();
  const upload = await page.request.post("/api/backend/invoices", {
    headers,
    data: {
      name: "insumos-e2e.pdf",
      mime: "application/pdf",
      kind: "cost",
      content: Buffer.from("%PDF-1.4 supplies cost test\n%%EOF").toString(
        "base64",
      ),
    },
  });
  expect(upload.ok()).toBeTruthy();
  const uploaded = (await upload.json()).invoice;
  const review = await page.request.patch(
    `/api/backend/invoices/${uploaded.id}`,
    {
      headers,
      data: {
        version: uploaded.versao_arquivo,
        data: {
          ...uploaded.dados_extracao,
          total: 100,
          items: ["Manteiga E2E"],
          lineItems: [
            {
              description: "Manteiga E2E",
              quantity: 3,
              unit: "kg",
              unitPrice: 4,
            },
          ],
        },
      },
    },
  );
  expect(review.ok()).toBeTruthy();
  const reviewed = (await review.json()).invoice;
  expect(
    (
      await page.request.post(`/api/backend/invoices/${uploaded.id}/post`, {
        headers,
        data: { version: reviewed.versao_arquivo, scope: "professional" },
      })
    ).ok(),
  ).toBeTruthy();
  const before = await (
    await page.request.get("/api/backend/dashboard")
  ).json();
  await page
    .getByRole("button", { name: "Atualizar dados", exact: true })
    .click();
  await expect(page.getByText(/Média simples de 2 registro/)).toBeVisible();
  const after = await (await page.request.get("/api/backend/dashboard")).json();
  expect(after.metrics).toEqual(before.metrics);
  await page.getByLabel("Período do histórico").selectOption("custom");
  await page.getByLabel("Data inicial", { exact: true }).fill("2020-01-01");
  await page.getByLabel("Data final", { exact: true }).fill("2020-01-31");
  await expect(page.getByText(/Histórico indisponível/)).toBeVisible();
  await page.getByLabel("Período do histórico").selectOption("6");
  await expect(page.getByRole("img", { name: /Histórico real/ })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/insumos-live-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Editar insumo" }).click();
  await page.getByLabel("Insumo ativo").uncheck();
  await page.getByRole("button", { name: "Salvar insumo" }).click();
  await expect(
    page.getByRole("button", { name: "Registrar preço", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Média simples de 2 registro/)).toBeVisible();
  expect(errors).toEqual([]);
});
