import { test, expect } from "@playwright/test";

test("reviewed postings update dashboard totals and charts, persist, and never double count", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const origin = { Origin: "http://localhost:3107" };
  const login = await page.request.post("/api/auth/login", {
    headers: origin,
    data: {
      cnpj: "12345678000195",
      password: "Only-for-local-tests!42",
      rememberMe: false,
    },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/dashboard");
  const dashboard = async (month?: string) => {
    const response = await page.request.get(
      `/api/backend/dashboard${month ? `?month=${month}` : ""}`,
    );
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const before = await dashboard();
  const invoices = await context.newPage();
  await invoices.goto("/notas-fiscais");
  const month = before.filter.month;
  const previousDate = new Date(`${month}-01T00:00:00Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous = previousDate.toISOString().slice(0, 7);
  const previousBefore = await dashboard(previous);

  async function post(
    kind: "cost" | "revenue",
    total: string,
    scope = "professional",
    date = `${month}-01`,
  ) {
    await invoices.bringToFront();
    await invoices
      .getByRole("button", {
        name: kind === "cost" ? "Custos" : "Faturamento",
        exact: true,
      })
      .click();
    const file = {
      name: `lancamento-${kind}-${scope}-${date}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(
        `%PDF-1.4\nFinancial ${kind} ${scope} ${date}\n%%EOF`,
      ),
    };
    await expect
      .poll(
        async () => {
          const result = invoices.waitForResponse(
            (r) =>
              r.url().endsWith("/api/backend/invoices") &&
              r.request().method() === "POST",
          );
          await invoices
            .getByLabel("Selecionar notas fiscais")
            .setInputFiles(file);
          return (await result).status();
        },
        { timeout: 70_000, intervals: [1000, 5000, 10000] },
      )
      .not.toBe(429);
    const review = invoices.getByRole("dialog", {
      name: "Revisar nota fiscal",
    });
    await expect(review).toBeVisible();
    const unposted = await dashboard();
    await review.getByLabel("Valor total (R$)").fill(total);
    await review.getByLabel("Data de emissão").fill(date);
    const draftFirst =
      kind === "cost" && scope === "professional" && date === `${month}-01`;
    await review
      .getByRole("button", {
        name: draftFirst ? "Salvar revisão" : "Salvar e lançar",
        exact: true,
      })
      .click();
    await expect(review).not.toBeVisible();
    expect((await dashboard()).metrics).toEqual(unposted.metrics);
    const card = invoices.getByRole("article").filter({ hasText: file.name });
    if (draftFirst) {
      const pending = await dashboard();
      expect(pending.pending.count).toBe(unposted.pending.count + 1);
      expect(pending.pending.costs).toBe(
        unposted.pending.costs + Number(total),
      );
      await page.bringToFront();
      await expect(
        page.getByRole("complementary", { name: "Lançamentos pendentes" }),
      ).toContainText("ainda não lançada");
      await invoices.bringToFront();
      await card
        .getByRole("button", { name: "Lançar no financeiro", exact: true })
        .click();
    }
    const confirmation = invoices.getByRole("dialog", {
      name: "Lançar no financeiro",
    });
    if (kind === "cost")
      await confirmation
        .getByLabel("Finalidade da despesa")
        .selectOption(scope);
    await confirmation
      .getByLabel("Conferi os dados e confirmo este lançamento.")
      .check();
    if (kind === "cost" && scope === "professional" && date === `${month}-01`) {
      await invoices.setViewportSize({ width: 390, height: 844 });
      await invoices.screenshot({
        path: "test-results/financial-posting-mobile.png",
        fullPage: true,
      });
    }
    await confirmation
      .getByRole("button", { name: "Confirmar lançamento" })
      .click();
    await expect(confirmation).not.toBeVisible();
    await expect(
      card.getByText("Lançada no financeiro", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Excluir nota", exact: true }),
    ).toBeEnabled();
    await expect(
      card.getByRole("button", { name: "Revisar dados", exact: true }),
    ).toBeDisabled();
    const download = await card
      .getByRole("link", { name: "Baixar original" })
      .getAttribute("href");
    const list = await (
      await invoices.request.get(
        `/api/backend/invoices?kind=${kind}&period=all`,
      )
    ).json();
    const saved = list.invoices.find(
      (n: { nome_arquivo: string }) => n.nome_arquivo === file.name,
    );
    const repeat = await invoices.request.post(
      download!.replace(/\/file$/, "/post"),
      {
        headers: origin,
        data: { version: saved.versao_arquivo, scope },
      },
    );
    expect(repeat.ok()).toBeTruthy();
    expect((await dashboard()).pending.count).toBe(unposted.pending.count);
    return card;
  }

  await post("cost", "100.00");
  await page.bringToFront();
  const costCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Custos Profissionais" }),
  });
  const money = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  await expect(costCard).toContainText(money(before.metrics.costs + 100), {
    timeout: 35_000,
  });
  const withCost = await dashboard();
  expect(withCost.metrics.costs).toBe(before.metrics.costs + 100);
  expect(withCost.metrics.profit).toBe(before.metrics.profit - 100);
  expect(withCost.evolution.at(-1).value).toBe(
    before.evolution.at(-1).value + 100,
  );
  await expect(
    page.getByRole("button", { name: /Sem categoria: R\$/ }).last(),
  ).toContainText(
    money(
      (before.distribution.find(
        (category: { name: string }) => category.name === "Sem categoria",
      )?.value ?? 0) + 100,
    ),
  );
  await post("revenue", "300.00");
  const withRevenue = await dashboard();
  expect(withRevenue.metrics.revenue).toBe(before.metrics.revenue + 300);
  expect(withRevenue.metrics.profit).toBe(before.metrics.profit + 200);
  expect(withRevenue.goal.percentage).toBeGreaterThan(before.goal.percentage);
  await post("cost", "50.00", "personal");
  const withWithdrawal = await dashboard();
  expect(withWithdrawal.metrics.withdrawals).toBe(
    before.metrics.withdrawals + 50,
  );
  expect(withWithdrawal.metrics.profit).toBe(withRevenue.metrics.profit);
  await post("cost", "25.00", "professional", `${previous}-01`);
  const previousAfter = await dashboard(previous);
  expect(previousAfter.metrics.costs).toBe(previousBefore.metrics.costs + 25);
  expect((await dashboard()).metrics.costs).toBe(withWithdrawal.metrics.costs);
  await page.bringToFront();
  await page.reload();
  await expect(costCard).toContainText(money(before.metrics.costs + 100));
  await expect(
    page.getByRole("region", { name: "Resumo financeiro" }),
  ).toContainText(money(before.metrics.revenue + 300));
  await page.screenshot({
    path: "test-results/dashboard-posted.png",
    fullPage: true,
  });
});
