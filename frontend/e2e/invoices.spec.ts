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
  await page.goto("/notas-fiscais");
  await expect(
    page.getByRole("button", { name: "Atualizar lista" }),
  ).toBeEnabled();
}

test("AI upload errors are separate from list errors and list refresh recovers", async ({
  page,
}) => {
  let failList = false;
  await page.route(/\/api\/backend\/invoices(?:\?|$)/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: failList ? 503 : 200,
        json: failList
          ? { message: "Não foi possível consultar suas notas." }
          : { invoices: [] },
      });
    } else {
      await route.fulfill({
        status: 503,
        json: {
          message:
            "Não foi possível concluir a leitura automática. Groq: tempo de resposta excedido. Gemini: limite de uso atingido. Nenhum novo arquivo foi salvo; notas existentes foram preservadas.",
        },
      });
    }
  });
  await login(page);
  await page.getByLabel("Selecionar notas fiscais").setInputFiles({
    name: "erro-ia.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nAI failure E2E\n%%EOF"),
  });
  await expect(page.locator('p[role="alert"]')).toContainText(
    "Groq: tempo de resposta excedido",
  );
  await expect(
    page.getByText(/Nenhuma nota enviada neste período/),
  ).toBeVisible();
  await expect(page.getByText(/A lista não pôde ser carregada/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/invoices-ai-error-mobile.png",
    fullPage: true,
  });
  failList = true;
  await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText(
    "Não foi possível consultar suas notas.",
  );
  await expect(page.getByText(/A lista não pôde ser carregada/)).toBeVisible();
  failList = false;
  await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  await expect(
    page.getByText(/Nenhuma nota enviada neste período/),
  ).toBeVisible();
});

test("upload, extract, review, download, duplicate protection and persistence after logout/login", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await expect(page.getByText("ZK Embalagens")).toHaveCount(0);
  await page.getByRole("button", { name: "Custos", exact: true }).click();
  const file = {
    name: "nota-persistente.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nInvoice E2E persistence\n%%EOF"),
  };
  await page.getByLabel("Selecionar notas fiscais").setInputFiles(file);
  const dialog = page.getByRole("dialog", { name: "Revisar nota fiscal" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Emitente / fornecedor")).toHaveValue(
    "Fornecedor E2E",
  );
  await dialog.getByLabel("Valor total (R$)").fill("99.50");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/invoice-review-mobile.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Salvar revisão" }).click();
  await expect(dialog).not.toBeVisible();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: file.name, exact: true }),
  });
  await expect(card.getByText("Dados revisados")).toBeVisible();
  await expect(card.getByText("R$ 99,50")).toBeVisible();
  const downloadUrl = await card
    .getByRole("link", { name: "Baixar original" })
    .getAttribute("href");
  const download = await page.request.get(downloadUrl!);
  expect(download.ok()).toBeTruthy();
  expect(await download.body()).toEqual(file.buffer);
  expect(download.headers()["cache-control"]).toContain("no-store");
  await page.getByLabel("Selecionar notas fiscais").setInputFiles(file);
  await expect(page.getByText(/Nenhuma cópia foi criada/)).toBeVisible();
  await expect(card).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "Custos", exact: true }).click();
  await expect(card.getByText("R$ 99,50")).toBeVisible();
  await page.screenshot({
    path: "test-results/invoices-saved-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.screenshot({
    path: "test-results/invoices-saved-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Finalizar sessão" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get(downloadUrl!)).status()).toBe(401);
  await login(page);
  await page.getByRole("button", { name: "Custos", exact: true }).click();
  await expect(card.getByText("R$ 99,50")).toBeVisible();
  await page.getByLabel("Período das notas").selectOption("previous");
  await expect(card).toHaveCount(0);
  await page.getByLabel("Período das notas").selectOption("all");
  await expect(card).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("OCR failure and ambiguous documents are rejected before saving; invalid and oversized files are rejected", async ({
  page,
}) => {
  await login(page);
  const input = page.getByLabel("Selecionar notas fiscais");
  await input.setInputFiles({
    name: "empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  await expect(page.locator("p[role=alert]")).toContainText("até 5 MB");
  await input.setInputFiles({
    name: "too-big.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.locator("p[role=alert]")).toContainText("até 5 MB");
  await input.setInputFiles({
    name: "false.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<html>not a PDF</html>"),
  });
  await expect(page.locator("p[role=alert]")).toContainText(
    "conteúdo não corresponde",
  );
  await input.setInputFiles({
    name: "nota-ilegivel.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nunreadable\n%%EOF"),
  });
  await expect(page.locator("p[role=alert]")).toBeVisible();
  const card = page
    .getByRole("article")
    .filter({ hasText: "nota-ilegivel.pdf" });
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
  await input.setInputFiles({
    name: "ambiguous.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nambiguous\n%%EOF"),
  });
  await expect(page.locator("p[role=alert]")).toContainText(
    "Não foi possível vincular",
  );
  await expect(
    page.getByRole("article").filter({ hasText: "ambiguous.pdf" }),
  ).toHaveCount(0);
});

test("BFF refuses forged origins, unknown routes and anonymous access", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/backend/invoices")).status()).toBe(401);
  expect(
    (
      await request.delete(
        "/api/backend/invoices/00000000-0000-4000-8000-000000000000",
        { headers: { Origin: "http://localhost:3107" } },
      )
    ).status(),
  ).toBe(401);
  await login(page);
  expect(
    (
      await page.request.delete(
        "/api/backend/invoices/00000000-0000-4000-8000-000000000000",
        { headers: { Origin: "https://evil.example" } },
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/backend/invoices", {
        headers: { Origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/backend/invoices/arbitrary", {
        headers: { Origin: "http://localhost:3107" },
        data: {},
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(
        "/api/backend/invoices/00000000-0000-4000-8000-000000000000/file",
      )
    ).status(),
  ).toBe(404);
});

test("delete asks confirmation and removes both record and original permanently", async ({
  page,
}) => {
  await login(page);
  const file = {
    name: "nota-para-excluir.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nInvoice revenue deletion E2E\n%%EOF"),
  };
  await page.getByLabel("Selecionar notas fiscais").setInputFiles(file);
  await expect(
    page.getByRole("dialog", { name: "Revisar nota fiscal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  const card = page.getByRole("article").filter({ hasText: file.name });
  const download = await card
    .getByRole("link", { name: "Baixar original" })
    .getAttribute("href");
  await card.getByRole("button", { name: "Excluir nota", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Excluir nota fiscal" });
  await expect(deletion).toBeVisible();
  await expect(
    deletion.getByRole("button", { name: "Confirmar exclusão" }),
  ).toBeDisabled();
  await deletion.getByRole("button", { name: "Cancelar" }).click();
  await expect(card).toBeVisible();
  expect((await page.request.get(download!)).ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByRole("button", { name: "Excluir nota", exact: true }).click();
  await deletion.getByLabel("Justificativa da exclusão").fill("       ");
  await expect(
    deletion.getByRole("button", { name: "Confirmar exclusão" }),
  ).toBeDisabled();
  await deletion
    .getByLabel("Justificativa da exclusão")
    .fill("Arquivo enviado por engano para testar a exclusão.");
  await page.screenshot({
    path: "test-results/invoice-delete-mobile.png",
    fullPage: true,
  });
  await deletion.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(
    page.getByText(/Nota e arquivo original excluídos permanentemente/),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  expect((await page.request.get(download!)).status()).toBe(404);
  await page.reload();
  await expect(card).toHaveCount(0);
  const again = await page.request.delete(download!.replace(/\/file$/, ""), {
    headers: { Origin: "http://localhost:3107" },
    data: { reason: "Arquivo enviado por engano para testar a exclusão." },
  });
  expect(again.ok()).toBeTruthy();
  // Same bytes can be uploaded after deletion: neither the DB hash nor file was left behind.
  await page.getByLabel("Selecionar notas fiscais").setInputFiles(file);
  await expect(
    page.getByRole("dialog", { name: "Revisar nota fiscal" }),
  ).toBeVisible();
});

test("wrong-tab documents are rejected in both directions, even duplicate uploads", async ({
  page,
}) => {
  test.setTimeout(100_000);
  await login(page);
  const input = page.getByLabel("Selecionar notas fiscais");
  // All cases share a local IP. Respect the real upload limit instead of disabling it.
  async function upload(file: {
    name: string;
    mimeType: string;
    buffer: Buffer;
  }) {
    await expect
      .poll(
        async () => {
          const response = page.waitForResponse(
            (response) =>
              response.url().endsWith("/api/backend/invoices") &&
              response.request().method() === "POST",
          );
          await input.setInputFiles(file);
          return (await response).status();
        },
        { timeout: 70_000, intervals: [1000, 5000, 10000] },
      )
      .not.toBe(429);
  }
  const cost = {
    name: "custo-classificacao.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nInvoice cost category E2E\n%%EOF"),
  };
  const revenue = {
    name: "venda-classificacao.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nInvoice revenue category E2E\n%%EOF"),
  };
  await upload(cost);
  await expect(page.locator("p[role=alert]")).toContainText(
    "Envie na aba Custos",
  );
  await expect(
    page.getByRole("article").filter({ hasText: cost.name }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Custos", exact: true }).click();
  await upload(revenue);
  await expect(page.locator("p[role=alert]")).toContainText(
    "Envie na aba Faturamento",
  );
  await upload(cost);
  const review = page.getByRole("dialog", { name: "Revisar nota fiscal" });
  await expect(review).toBeVisible();
  await expect(review.getByLabel("CNPJ do emitente")).toHaveAttribute(
    "readonly",
    "",
  );
  await review.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Faturamento", exact: true }).click();
  await upload(cost);
  await expect(page.locator("p[role=alert]")).toContainText(
    "Envie na aba Custos",
  );
  await expect(
    page.getByRole("button", { name: "Faturamento", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await upload(revenue);
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Cancelar" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: revenue.name }),
  ).toBeVisible();
});
