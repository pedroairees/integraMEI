import { test, expect, type Page } from "@playwright/test";
const month = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
})
  .format(new Date())
  .slice(0, 7);
async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", {
    headers: { Origin: "http://localhost:3107" },
    data: {
      cnpj: "12345678000195",
      password: "Only-for-local-tests!42",
      rememberMe: false,
    },
  });
  expect(r.ok()).toBeTruthy();
  await page.goto("/relatorios");
  await page.getByLabel("Data Inicial").fill(`${month}-01`);
  await page.getByLabel("Data Final").fill(`${month}-28`);
}
test("reports download PDF, Excel and both, send attachments with consent, and fit mobile", async ({
  page,
}) => {
  await login(page);
  for (const [label, extension] of [
    ["PDF", "pdf"],
    ["Excel (XLSX)", "xlsx"],
    ["PDF e Excel", "zip"],
  ]) {
    await page.getByLabel(label!, { exact: true }).check();
    const promise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Gerar Relatório" }).click();
    const download = await promise;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`\\.${extension}$`),
    );
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Relatório gerado",
    );
  }
  await page.getByLabel("Enviar por e-mail", { exact: true }).check();
  await page
    .getByLabel("E-mail do destinatário")
    .fill("accountant@example.test");
  await expect(
    page.getByRole("button", { name: "Enviar relatório", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/Conferi o destinatário/).check();
  await page
    .getByRole("button", { name: "Enviar relatório", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "aceito pelo servidor",
  );
  await expect(
    page.getByRole("button", { name: "Enviar relatório", exact: true }),
  ).toBeDisabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `test-results/reports-${width}.png`,
      fullPage: true,
    });
  }
});
test("reports empty period and unavailable SMTP do not claim success", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/backend/reports/download", {
        headers: { Origin: "http://localhost:3107" },
        data: {},
      })
    ).status(),
  ).toBe(401);
  await page.route("**/api/backend/reports/options", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ emailConfigured: false }),
    }),
  );
  await login(page);
  await page.getByLabel("Data Inicial").fill("2000-01-01");
  await page.getByLabel("Data Final").fill("2000-01-31");
  await page.getByRole("button", { name: "Gerar Relatório" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Nada para exportar",
  );
  await page.getByLabel("Enviar por e-mail", { exact: true }).check();
  await expect(
    page.getByText(/O envio por e-mail ainda não foi configurado/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar relatório", exact: true }),
  ).toBeDisabled();
});
