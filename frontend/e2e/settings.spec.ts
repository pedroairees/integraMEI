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
  await page.goto("/configuracoes");
  await expect(page.getByLabel("Nome completo")).toBeVisible();
}
test("settings use the logged profile, persist preferences and update the dashboard greeting", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByLabel("Nome completo")).toHaveValue(
    "Perfil Cadastrado",
  );
  await expect(page.getByLabel("E-mail atual")).toHaveValue(
    "dashboard@example.test",
  );
  await expect(page.getByText("12.345.678/0001-95")).toBeVisible();
  await expect(page.getByPlaceholder(/Moziel/)).toHaveCount(0);
  await page.getByLabel("Nome completo").fill("Ana da Conta");
  await page.getByLabel("Telefone", { exact: true }).fill("11998765432");
  await page
    .getByRole("switch", { name: "Receber alertas por e-mail" })
    .focus();
  await page.keyboard.press("Space");
  await page.getByRole("switch", { name: "Lembretes notas fiscais" }).click();
  await page
    .getByLabel("Fuso horário dos relatórios")
    .selectOption("America/Manaus");
  await page
    .getByRole("button", { name: "Salvar configurações", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Configurações salvas");
  await page.reload();
  await expect(page.getByLabel("Nome completo")).toHaveValue("Ana da Conta");
  await expect(page.getByLabel("Telefone", { exact: true })).toHaveValue(
    "(11) 99876-5432",
  );
  await expect(
    page.getByRole("switch", { name: "Receber alertas por e-mail" }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Lembretes notas fiscais" }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Fuso horário dos relatórios")).toHaveValue(
    "America/Manaus",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/settings-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Olá, Ana!" })).toBeVisible();
});
test("settings verify current password without ending browser session and email awaits confirmation", async ({
  page,
}) => {
  await login(page);
  await page.getByLabel("Senha atual", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Enviar link", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Senha atual incorreta");
  await page
    .getByLabel("Senha atual", { exact: true })
    .fill("Only-for-local-tests!42");
  await page.getByRole("button", { name: "Mostrar senha" }).click();
  await expect(page.getByLabel("Senha atual", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Enviar link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("recuperação aceita");
  await expect(page.getByLabel("Senha atual", { exact: true })).toHaveValue("");
  expect((await page.request.get("/api/backend/settings")).ok()).toBeTruthy();
  await page
    .getByLabel("Novo e-mail", { exact: true })
    .fill("new@example.test");
  await page.getByRole("button", { name: "Solicitar alteração" }).click();
  await expect(page.getByRole("status")).toContainText("confirmação");
  await page.reload();
  await expect(page.getByText(/Confirmação pendente para/)).toContainText(
    "new@example.test",
  );
  await expect(page.getByLabel("E-mail atual")).toHaveValue(
    "dashboard@example.test",
  );
});
test("settings rejects anonymous requests and does not claim success on a failed save", async ({
  page,
}) => {
  expect((await page.request.get("/api/backend/settings")).status()).toBe(401);
  await login(page);
  await page.route("**/api/backend/settings", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ message: "Falha de teste ao salvar." }),
        })
      : route.continue(),
  );
  await page.getByLabel("Nome completo").fill("Ainda não salvo");
  await page
    .getByRole("button", { name: "Salvar configurações", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Falha de teste");
  await expect(
    page.getByText("Configurações salvas na sua conta."),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Nome completo")).not.toHaveValue(
    "Ainda não salvo",
  );
});
