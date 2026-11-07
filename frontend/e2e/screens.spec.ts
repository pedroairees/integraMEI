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
    await expect(page.getByText(/Prévia das telas/)).toHaveCount(0);
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

