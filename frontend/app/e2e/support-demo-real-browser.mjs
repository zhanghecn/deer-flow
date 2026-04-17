import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const resultsDir = path.join(
  repoRoot,
  "docs/testing/results/2026-04-17-support-sdk-demo-runtime",
);
const summaryPath = path.join(resultsDir, "setup-summary.json");

async function waitForRunSnapshot(page) {
  // Real model latency varies. A bounded settle window is enough here because
  // the API smoke test separately verifies exact MCP event payloads.
  await page.waitForTimeout(20_000);
}

async function waitForWorkspacePlayground(page) {
  // The workspace playground renders the public timeline incrementally and
  // can take longer than the lightweight demos to settle on slower runs.
  await page.waitForTimeout(45_000);
}

async function fillWorkspacePlayground(page, token, prompt) {
  // Labels are locale-dependent, so accept both the zh-CN and English forms
  // that the same component renders in tests and browser verification.
  await page.waitForSelector("textarea", { timeout: 60_000 });
  await page.getByLabel(/User Key|用户 Key/).fill(token);
  await page.getByLabel(/Prompt|提示词/).fill(prompt);
}

function publishedAgentButton(page) {
  return page.getByRole("button", {
    name: /Run published agent|运行已发布 Agent/,
  });
}

async function run() {
  const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  const httpToken = summary.tokens.find((item) =>
    item.allowed_agents.includes("support-cases-http-demo"),
  );
  const stdioToken = summary.tokens.find((item) =>
    item.allowed_agents.includes("support-cases-stdio-demo"),
  );

  if (!httpToken || !stdioToken) {
    throw new Error("Missing demo tokens in setup-summary.json");
  }

  const browser = await chromium.launch({
    headless: true,
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });

  await context.addCookies([
    {
      name: "locale",
      value: "zh-CN",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();

  await page.goto("http://127.0.0.1:8083/login", {
    waitUntil: "networkidle",
  });
  console.log("login page ready");
  await page.fill("#login-account", summary.user.name);
  await page.fill("#login-password", summary.user.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/workspace/**", { timeout: 60_000 });
  console.log("logged in");

  await page.goto("http://127.0.0.1:8083/workspace/agents", {
    waitUntil: "networkidle",
  });
  await page.screenshot({
    path: path.join(resultsDir, "01-workspace-agents.png"),
    fullPage: true,
  });

  await page.goto(
    "http://127.0.0.1:8083/docs/agents/support-cases-http-demo/support",
    {
      waitUntil: "networkidle",
    },
  );
  console.log("docs support ready");
  await page.getByPlaceholder("https://gateway.example.com/v1").fill(
    "http://127.0.0.1:8083/v1",
  );
  await page.getByPlaceholder("df_live_xxx").fill(httpToken.token);
  await page
    .getByPlaceholder("你可以问文件列表、分页读文件、glob 过滤或 grep 搜索。")
    .fill("请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。");
  await page.getByRole("button", { name: "发送" }).click();
  await waitForRunSnapshot(page);
  console.log("docs support run finished");
  await page.screenshot({
    path: path.join(resultsDir, "02-docs-support-http.png"),
    fullPage: true,
  });

  await page.goto("http://127.0.0.1:8084", {
    waitUntil: "networkidle",
  });
  console.log("standalone demo ready");
  await page.getByLabel("用户 Key").fill(stdioToken.token);
  await page.getByLabel("Agent").fill("support-cases-stdio-demo");
  await page
    .getByPlaceholder("直接问已发布的客服 Agent，或使用左侧预置问题。")
    .fill("请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。");
  await page.getByRole("button", { name: "发送" }).click();
  await waitForRunSnapshot(page);
  console.log("standalone demo run finished");
  await page.screenshot({
    path: path.join(resultsDir, "03-standalone-demo-stdio.png"),
    fullPage: true,
  });

  await page.goto(
    "http://127.0.0.1:8083/workspace/agents/support-cases-http-demo/playground?agent_status=prod",
    {
      waitUntil: "networkidle",
    },
  );
  console.log("workspace playground ready");
  const workspacePrompt =
    "请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。";
  console.log(
    `workspace playground body: ${(await page.locator("body").innerText()).slice(0, 600)}`,
  );
  await fillWorkspacePlayground(page, httpToken.token, workspacePrompt);
  await publishedAgentButton(page).click();
  await waitForWorkspacePlayground(page);
  console.log("workspace playground run finished");
  await page.screenshot({
    path: path.join(resultsDir, "07-workspace-playground-current.png"),
    fullPage: true,
  });

  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
