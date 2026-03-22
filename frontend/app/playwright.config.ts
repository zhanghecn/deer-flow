import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const { port } = new URL(baseURL);
const webServerPort = Number(port || "3000");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    launchOptions: process.platform === "linux" ? { args: ["--no-sandbox"] } : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: `pnpm dev -- --host localhost --port ${webServerPort} --strictPort`,
    port: webServerPort,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
