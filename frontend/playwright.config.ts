import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3107",
    browserName: "chromium",
    channel: process.platform === "win32" ? "msedge" : undefined,
    viewport: { width: 1440, height: 1024 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://localhost:3107",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
