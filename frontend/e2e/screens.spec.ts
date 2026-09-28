import { test, expect, type Page } from "@playwright/test";

const screens = [
  ["notas-fiscais", "Notas Fiscais"],
  ["insumos", "Insumos"],
  ["precificacao", "Precificação"],
  ["alertas", "Alertas"],
  ["relatorios", "Relatórios"],
  ["configuracoes", "Configurações"],
] as const;

async function authenticate(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    headers: { Origin: "http://localhost:3107" },
    data: {
      cnpj: "12345678000195",
      password: "Only-for-local-tests!42",
      rememberMe: false,
    },
  });
  expect(response.ok()).toBeTruthy();
}

test("all new screens reject anonymous and RSC requests", async ({
  request,
}) => {
  for (const [route] of screens) {
    const variants: Record<string, string>[] = [{}, { RSC: "1" }];
    for (const headers of variants) {
      const response = await request.get(`/${route}`, {
        maxRedirects: 0,
        headers,
      });
      expect(response.status()).toBe(307);
      expect(
        new URL(response.headers().location, "http://localhost:3107").pathname,
      ).toBe("/");
    }
  }
});

for (const [route, title] of screens) {
  test(`${route}: protected navigation, rendered assets, desktop and responsive layouts`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticate(page);
    await page.goto(`/${route}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: title, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/Prévia das telas/)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1024 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page
            .locator("img")
            .evaluateAll((images) =>
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        )
        .toBe(true);
      await page.screenshot({
        path: `test-results/${route}-${width}.png`,
        fullPage: true,
      });
    }
    await page
      .getByRole("link", { name: "Notas Fiscais", exact: true })
      .click();
    await expect(page).toHaveURL(/\/notas-fiscais$/);
    expect(errors).toEqual([]);
  });
}

test("preview controls work locally without business requests or persistence", async ({
  page,
}) => {
  await authenticate(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/notas-fiscais");
  await page.getByRole("button", { name: "Custos", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Últimas notas enviadas/ }),
  ).toContainText("SAÍDAS");
  await page
    .getByLabel("Selecionar notas fiscais")
    .setInputFiles({
      name: "nota-exemplo.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF"),
    });
  await expect(page.getByRole("status")).toContainText("nada foi enviado");
  await expect(
    page.getByText("nota-exemplo.pdf", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Período das notas").selectOption("previous");
  await expect(
    page.getByText("Não há notas de exemplo para este período."),
  ).toBeVisible();

  await page.goto("/insumos");
  await page.getByLabel("Produto", { exact: true }).fill("Farinha de Trigo");
  await page.getByRole("button", { name: "Pesquisar insumo" }).click();
  await expect(page.getByText("R$ 7,80", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Evolução ilustrativa/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/insumos-example.png",
    fullPage: true,
  });
  await page.getByLabel("Período do histórico").selectOption("3");
  await expect(page.getByRole("status")).toContainText(
    "Não há dados demonstrativos",
  );

  await page.goto("/precificacao");
  await page.getByLabel("Produto", { exact: true }).fill("Bolo de chocolate");
  await page
    .getByLabel("Custo Total Unitário (R$)", { exact: true })
    .fill("18,50");
  await page.getByLabel("Margem de Lucro Desejada (%)").fill("50");
  await page.getByRole("button", { name: "Sugerir Preço" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Nenhum valor foi calculado ou salvo",
  );

  await page.goto("/relatorios");
  await page.getByLabel("Data Inicial").fill("2026-04-01");
  await page.getByLabel("Data Final").fill("2026-04-30");
  await page.getByLabel("Lucro", { exact: true }).check();
  await page.getByLabel("Excel (XLSX)").check();
  await page.getByRole("button", { name: "Gerar Relatório" }).click();
  await expect(page.getByRole("status")).toContainText(
    "nenhum arquivo ou e-mail foi gerado",
  );
  await page.screenshot({
    path: "test-results/relatorios-selected.png",
    fullPage: true,
  });

  await page.goto("/configuracoes");
  const toggle = page.getByRole("switch", {
    name: "Receber alertas por e-mail",
  });
  await expect(toggle).toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await page.getByLabel("Senha atual", { exact: true }).fill("preview-only");
  await page.getByRole("button", { name: "Mostrar senha" }).click();
  await expect(page.getByLabel("Senha atual", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "nenhum e-mail foi enviado",
  );
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(page.getByLabel("Senha atual", { exact: true })).toHaveValue("");
  expect(writes).toEqual([]);
});
