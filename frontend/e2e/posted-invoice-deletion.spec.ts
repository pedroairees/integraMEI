import { test, expect } from "@playwright/test";

test("deleting posted invoices reverses dashboard and linked prices, preserves catalog and survives reload", async ({
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
  const dashboard = async () => {
    const result = await page.request.get("/api/backend/dashboard");
    expect(result.ok()).toBeTruthy();
    return result.json();
  };
  const overview = await context.newPage();
  await overview.goto("/dashboard");
  const baseline = await dashboard();
  for (const kind of ["cost", "revenue"] as const) {
    const name = `posted-delete-${kind}.pdf`;
    const upload = await page.request.post("/api/backend/invoices", {
      headers,
      data: {
        name,
        kind,
        mime: "application/pdf",
        content: Buffer.from(`%PDF-1.4 posted-delete ${kind}\n%%EOF`).toString(
          "base64",
        ),
      },
    });
    expect(upload.ok()).toBeTruthy();
    const draft = (await upload.json()).invoice;
    const review = await page.request.patch(
      `/api/backend/invoices/${draft.id}`,
      {
        headers,
        data: {
          version: draft.versao_arquivo,
          data: {
            ...draft.dados_extracao,
            total: 50,
            items: ["Insumo exclusão E2E"],
            lineItems: [
              {
                description: "Insumo exclusão E2E",
                quantity: 2,
                unit: "kg",
                unitPrice: 10,
              },
            ],
          },
        },
      },
    );
    expect(review.ok()).toBeTruthy();
    const reviewed = (await review.json()).invoice;
    const post = await page.request.post(
      `/api/backend/invoices/${draft.id}/post`,
      {
        headers,
        data: { version: reviewed.versao_arquivo, scope: "professional" },
      },
    );
    expect(post.ok()).toBeTruthy();
    const note = (await post.json()).invoice;
    const field = kind === "cost" ? "costs" : "revenue";
    expect((await dashboard()).metrics[field]).toBe(
      baseline.metrics[field] + 50,
    );
    const staleDelete = await page.request.delete(
      `/api/backend/invoices/${note.id}`,
      {
        headers,
        data: {
          reason: "Tentativa com uma versão antiga da nota.",
          version: draft.versao_arquivo,
        },
      },
    );
    expect(staleDelete.status()).toBe(409);
    await page.goto("/notas-fiscais");
    if (kind === "cost")
      await page.getByRole("button", { name: "Custos", exact: true }).click();
    const card = page.getByRole("article").filter({ hasText: name });
    await card
      .getByRole("button", { name: "Excluir nota", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: "Excluir nota fiscal" });
    await expect(modal).toContainText("Esta nota já foi lançada");
    await modal.getByRole("button", { name: "Cancelar" }).click();
    expect((await dashboard()).metrics[field]).toBe(
      baseline.metrics[field] + 50,
    );
    await card
      .getByRole("button", { name: "Excluir nota", exact: true })
      .click();
    await modal
      .getByLabel("Justificativa da exclusão")
      .fill("Nota lançada por engano durante o teste de exclusão.");
    await modal.getByRole("button", { name: "Confirmar exclusão" }).click();
    await expect(modal).toBeVisible(); // Required acknowledgment has not been checked.
    await modal.getByRole("checkbox").check();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `test-results/posted-delete-${kind}.png` });
    await modal.getByRole("button", { name: "Confirmar exclusão" }).click();
    await expect(modal).not.toBeVisible();
    await expect(card).toHaveCount(0);
    expect(
      (
        await page.request.get(`/api/backend/invoices/${note.id}/file`)
      ).status(),
    ).toBe(404);
    expect((await dashboard()).metrics).toEqual(baseline.metrics);
    const metric = overview
      .getByRole("article")
      .filter({
        has: overview.getByRole("heading", {
          name: kind === "cost" ? "Custos Profissionais" : "Faturamento",
          exact: true,
        }),
      });
    // The dashboard tab receives the invalidation, not just a new API request.
    if (kind === "cost")
      await expect(metric).toContainText(
        new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(baseline.metrics.costs),
      );
    await page.reload();
    await expect(card).toHaveCount(0);
    expect(
      (
        await page.request.delete(`/api/backend/invoices/${note.id}`, {
          headers,
          data: {
            reason: "Repetição da exclusão já concluída.",
            version: note.versao_arquivo,
          },
        })
      ).ok(),
    ).toBeTruthy();
    if (kind === "cost") {
      const catalog = (
        await (
          await page.request.get(
            "/api/backend/supplies?q=Insumo%20exclus%C3%A3o%20E2E",
          )
        ).json()
      ).supplies;
      expect(catalog).toHaveLength(1);
      const history = await page.request.get(
        `/api/backend/supplies/${catalog[0].id}/prices?start=${note.dados_extracao.date}&end=${note.dados_extracao.date}`,
      );
      expect(history.ok()).toBeTruthy();
      expect((await history.json()).points).toHaveLength(0);
      await page.goto("/insumos");
      await page
        .getByRole("button", { name: "Insumo exclusão E2E (kg)", exact: true })
        .click();
      await expect(page.getByText(/Histórico indisponível/)).toBeVisible();
    }
  }
  await overview.close();
});
