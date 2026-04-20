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
const sampleDataDir = path.join(
  repoRoot,
  "../ai-numerology/backend/agents/examples/案例大全",
);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function resetWorkbench() {
  await fetch("http://127.0.0.1:8084/api/files/reset", { method: "POST" });
}

async function runWorkbench(page) {
  await page.goto("http://127.0.0.1:8084", {
    waitUntil: "networkidle",
  });

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("MCP 文件调试台") &&
      document.body.innerText.includes("工具工作台") &&
      document.body.innerText.includes("当前工具规范"),
    undefined,
    { timeout: 60_000 },
  );

  const folderChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传目录" }).click();
  const folderChooser = await folderChooserPromise;
  await folderChooser.setFiles(sampleDataDir);

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("文件资源库") &&
      document.body.innerText.includes("http://127.0.0.1:8084/mcp-http/mcp") &&
      document.body.innerText.includes("已上传") &&
      document.body.innerText.includes("4 个文件") &&
      document.body.innerText.includes("案例大全 · 4") &&
      document.body.innerText.includes("Final_盲派八字案例训练集.md") &&
      document.body.innerText.includes("EXPLORER"),
    undefined,
    { timeout: 60_000 },
  );

  await page.getByRole("button", {
    name: "Final_盲派八字案例训练集.md",
  }).first().click();
  await page.waitForFunction(
    () => document.body.innerText.includes("盲派八字真实案例训练集"),
    undefined,
    { timeout: 60_000 },
  );

  await page.screenshot({
    path: path.join(resultsDir, "08-acceptance-console-uploaded.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "执行工具" }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("调用记录") &&
      document.body.innerText.includes("fs_ls") &&
      document.body.innerText.includes("\"entry_type\": \"directory\"") &&
      document.body.innerText.includes("\"path\": \"案例大全\""),
    undefined,
    { timeout: 120_000 },
  );

  await page.screenshot({
    path: path.join(resultsDir, "09-acceptance-console-complete.png"),
    fullPage: true,
  });
}

async function run() {
  await ensureDir(resultsDir);
  await resetWorkbench();
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    locale: "zh-CN",
  });

  const page = await context.newPage();
  await runWorkbench(page);
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
