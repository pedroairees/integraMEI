import { test, expect } from "@playwright/test";

test("cost supplies appear only after financial confirmation, with reviewed lines and no duplicates", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
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
  const catalog = async () => {
    const r = await page.request.get("/api/backend/supplies?q=Auto%20E2E");
    expect(r.ok()).toBeTruthy();
    return (await r.json()).supplies;
  };
  await page.goto("/notas-fiscais");
  await page.getByRole("button", { name: "Custos", exact: true }).click();
  await page
    .getByLabel("Selecionar notas fiscais")
    .setInputFiles({
      name: "automacao-custo.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 auto supply test\n%%EOF"),
    });
  const review = page.getByRole("dialog", { name: "Revisar nota fiscal" });
  await expect(review).toBeVisible({ timeout: 30000 });
  expect(await catalog()).toHaveLength(0);
  await review
    .getByLabel("Nome do insumo 1", { exact: true })
    .fill("Auto E2E Farinha");
  await review.getByLabel("Quantidade 1", { exact: true }).fill("2.5");
  await review.getByLabel("Unidade 1", { exact: true }).fill("kg");
  await review.getByLabel("Preço unitário 1 (R$)", { exact: true }).fill("5.2");
  await review.getByRole("button", { name: "Adicionar item" }).click();
  await review
    .getByLabel("Nome do insumo 2", { exact: true })
    .fill("Auto E2E Embalagem");
  await review.getByLabel("Quantidade 2", { exact: true }).fill("4");
  await review.getByLabel("Unidade 2", { exact: true }).fill("un");
  // Missing price may be saved as a draft; it must block professional posting.
  await review
    .getByRole("button", { name: "Salvar revisão", exact: true })
    .click();
  await expect(review).not.toBeVisible();
  expect(await catalog()).toHaveLength(0);
  const card = page
    .getByRole("article")
    .filter({ hasText: "automacao-custo.pdf" });
  await card
    .getByRole("button", { name: "Lançar no financeiro", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Lançar no financeiro" });
  await post.getByRole("checkbox").check();
  await post.getByRole("button", { name: "Confirmar lançamento" }).click();
  await expect(post.getByRole("alert")).toContainText("Revise todos os itens");
  expect(await catalog()).toHaveLength(0);
  await post.getByRole("button", { name: "Cancelar" }).click();
  const otherTab = await context.newPage();
  await otherTab.goto("/insumos");
  await expect(
    otherTab.getByRole("button", {
      name: "Auto E2E Farinha (kg)",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.bringToFront();
  await card.getByRole("button", { name: "Revisar dados" }).click();
  await review.getByLabel("Preço unitário 2 (R$)", { exact: true }).fill("1.5");
  await page.setViewportSize({ width: 390, height: 844 });
  await review
    .getByLabel("Nome do insumo 1", { exact: true })
    .evaluate((el) => el.closest("div")?.scrollIntoView({ block: "start" }));
  expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/invoice-auto-supplies-mobile.png",
  });
  await review
    .getByRole("button", { name: "Salvar e lançar", exact: true })
    .click();
  await expect(post).toBeVisible();
  expect(await catalog()).toHaveLength(0);
  await post.getByRole("checkbox").check();
  await post.getByRole("button", { name: "Confirmar lançamento" }).click();
  await expect(post).not.toBeVisible();
  await expect(
    otherTab.getByRole("button", {
      name: "Auto E2E Farinha (kg)",
      exact: true,
    }),
  ).toBeVisible();
  await otherTab.close();
  const supplies = await catalog();
  expect(supplies).toHaveLength(2);
  const notes = (
    await (
      await page.request.get("/api/backend/invoices?kind=cost&period=all")
    ).json()
  ).invoices;
  const note = notes.find(
    (n: { nome_arquivo: string }) => n.nome_arquivo === "automacao-custo.pdf",
  );
  expect(
    (
      await page.request.post(`/api/backend/invoices/${note.id}/post`, {
        headers,
        data: { version: note.versao_arquivo, scope: "professional" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(await catalog()).toHaveLength(2);
  await page.goto("/insumos");
  await page
    .getByRole("button", { name: "Auto E2E Farinha (kg)", exact: true })
    .click();
  await expect(page.getByText(/Média simples de 1 registro/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Histórico real/ })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Auto E2E Embalagem (un)", exact: true })
    .click();
  await expect(page.getByText(/Média simples de 1 registro/)).toBeVisible();
});
