import { test, expect, type BrowserContext, type Page } from "@playwright/test";

async function login(page: Page, remember = false) {
  await page.goto("/");
  await page.getByLabel("CNPJ", { exact: true }).fill("12345678000195");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Only-for-local-tests!42");
  if (remember) await page.getByText("Lembrar de mim", { exact: true }).click();
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Olá, Usuário!" }),
  ).toBeVisible();
}

async function alterSession(
  context: BrowserContext,
  transform: (session: Record<string, unknown>) => void,
) {
  const cookies = await context.cookies();
  const authCookie = cookies.find(
    (cookie) =>
      cookie.name.startsWith("sb-") && cookie.name.endsWith("-auth-token"),
  );
  expect(authCookie).toBeDefined();
  const session = JSON.parse(
    Buffer.from(
      authCookie!.value.slice("base64-".length),
      "base64url",
    ).toString(),
  );
  transform(session);
  await context.addCookies([
    {
      ...authCookie!,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    },
  ]);
}

test("anonymous requests and RSC requests cannot read dashboard content", async ({
  page,
  request,
}) => {
  const variants: Record<string, string>[] = [{}, { RSC: "1" }];
  for (const headers of variants) {
    const response = await request.get("/dashboard", {
      maxRedirects: 0,
      headers,
    });
    expect(response.status()).toBe(307);
    expect(
      new URL(response.headers().location, "http://localhost:3107").pathname,
    ).toBe("/");
    expect(await response.text()).not.toContain("Lucro Líquido");
  }
  await page.goto("/dashboard");
  await expect(page).toHaveURL("http://localhost:3107/");
});

test("wrong password does not grant access", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("CNPJ", { exact: true }).fill("12345678000195");
  await page.getByLabel("Senha", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("form [role=alert]")).toHaveText(
    "CNPJ ou senha inválidos.",
  );
  await page.goto("/dashboard");
  await expect(page).toHaveURL("http://localhost:3107/");
});

test("login opens dashboard; reload and logout enforce the session", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const authCookie = (await context.cookies()).find((cookie) =>
    cookie.name.startsWith("sb-"),
  );
  expect(authCookie?.httpOnly).toBe(true);
  expect(authCookie?.expires).toBe(-1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Olá, Usuário!" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lucro Líquido" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Notificações", exact: true }).click();
  await expect(page.locator("#dashboard-notifications")).toContainText(
    "Nenhum alerta",
  );
  await page.getByRole("button", { name: "Finalizar sessão" }).click();
  await expect(page).toHaveURL("http://localhost:3107/");
  await page.goto("/dashboard");
  await expect(page).toHaveURL("http://localhost:3107/");
  expect(errors).toEqual([]);
});

test("remembered sessions persist and expired tokens refresh", async ({
  page,
  context,
}) => {
  await login(page, true);
  const before = (await context.cookies()).find((cookie) =>
    cookie.name.endsWith("-auth-token"),
  );
  expect(before!.expires).toBeGreaterThan(Date.now() / 1000);
  await alterSession(context, (session) => {
    session.expires_at = Math.floor(Date.now() / 1000) - 120;
  });
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Olá, Usuário!" }),
  ).toBeVisible();
  const after = (await context.cookies()).find((cookie) =>
    cookie.name.endsWith("-auth-token"),
  );
  expect(after!.value).not.toBe(before!.value);
});

test("forged cookies and expired sessions without valid refresh tokens are rejected", async ({
  page,
  context,
}) => {
  await login(page);
  await alterSession(context, (session) => {
    session.access_token = "forged.jwt.token";
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL("http://localhost:3107/");
  await login(page);
  await alterSession(context, (session) => {
    session.expires_at = 1;
    session.refresh_token = "invalid-refresh-token";
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL("http://localhost:3107/");
});

test("mobile and tablet layouts fit the viewport", async ({ page }) => {
  await login(page);
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "Lucro Líquido" }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/dashboard-${width}.png`,
      fullPage: true,
    });
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll("body *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth,
        )
        .map((element) => element.className)
        .slice(0, 12),
    }));
    expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(
      width,
    );
  }
});

test("cross-origin logout is rejected", async ({ page, request }) => {
  await login(page);
  const response = await request.post("/api/auth/logout", {
    headers: { Origin: "https://other.example" },
  });
  expect(response.status()).toBe(403);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("real backend calculates metrics, filters expenses and persists goal through the provider", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole("region", { name: "Resumo financeiro" }),
  ).toContainText("600,00");
  await expect(
    page.getByRole("region", { name: "Resumo financeiro" }),
  ).toContainText("1.200,00");
  await page.getByLabel("Visão", { exact: true }).selectOption("personal");
  await expect(
    page.getByRole("button", { name: /Retiradas: R\$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Resumo financeiro" }),
  ).toContainText("600,00");
  await page.getByLabel("Visão", { exact: true }).selectOption("professional");
  await page.getByRole("button", { name: /Insumos: R\$/ }).click();
  await page.getByRole("button", { name: /Farinha.*Ver histórico/ }).click();
  await expect(
    page.getByRole("heading", { name: "Histórico: Farinha" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Fornecedor de teste" }),
  ).toBeVisible();
  await page.getByText("Editar meta", { exact: true }).click();
  await page.getByLabel("Meta mensal (R$)").fill("10000");
  await page.getByLabel("Meta de margem (%)").fill("40");
  await page.getByRole("button", { name: "Salvar meta", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Resumo financeiro" }),
  ).toContainText("10.000,00");
  await expect(
    page.getByText("Meta de margem atingida (40%).", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Resumo financeiro" }),
  ).toContainText("10.000,00");
  await page.getByLabel("Mês de referência").fill("2020-01");
  await expect(page.getByRole("status")).toContainText(
    "Nenhuma venda ou despesa",
  );
  await expect(
    page.getByRole("region", { name: "Resumo financeiro" }),
  ).not.toContainText("1.200,00");
});

test("financial adapter blocks anonymous access, cross-origin updates and arbitrary forwarding", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/backend/dashboard")).status()).toBe(401);
  await login(page);
  const result = await request.patch("/api/backend/dashboard/goal", {
    headers: { Origin: "https://other.example" },
    data: { value: 1 },
  });
  expect(result.status()).toBe(403);
  expect((await request.get("/api/backend/auth/admin/users")).status()).toBe(
    404,
  );
});
