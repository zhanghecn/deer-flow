import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  capture,
  extractTextParts,
  extractThreadIdFromRunURL,
  fetchJSON,
  getThreadState,
  isRunStreamRequest,
  latestAssistantText,
  loadChromium,
  login,
  parseThreadIdFromURL,
  readAuthState,
  sendMessage,
  waitForCondition,
} from "./browser_probe_utils.mjs";

const BASE_URL = process.env.OPENAGENTS_BASE_URL ?? "http://127.0.0.1:3101";
const LOGIN_ACCOUNT = process.env.OPENAGENTS_ADMIN_ACCOUNT ?? "admin";
const LOGIN_PASSWORD = process.env.OPENAGENTS_ADMIN_PASSWORD ?? "admin123";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  "todos/multi_agent_test_suite_complete/agent_test_package/runtime_results",
);
const SCREENSHOT_ROOT = path.join(OUTPUT_ROOT, "screenshots");
const RESULTS_JSON = path.join(OUTPUT_ROOT, "find_skills_browser_probe.json");
const chromium = loadChromium(REPO_ROOT);

const scenarios = [
  {
    key: "success",
    prompt:
      "请明确使用 $find-skills 搜索一个适合 Playwright 浏览器自动化、表单填写和页面排错的现成 skill。先给我最匹配的 2 个候选、source 和为什么匹配；然后安装你认为最合适的那个到 dev。完成后必须告诉我最终安装的 source、skill 名称，以及是否调用了 install_skill_from_registry。",
  },
  {
    key: "invalid-source",
    prompt:
      "请明确使用 $find-skills，并故意尝试安装这个 source：vercel-labs/agent-skills@playwright-nonexistent-skill。若安装失败，必须告诉我 registry/CLI 返回的关键错误行，不能只说“失败”或“超时”。",
  },
];

function log(step, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[find-skills-probe] ${step}${suffix}`);
}

function toolMessages(messages = []) {
  return messages
    .filter((message) => message?.type === "tool")
    .map((message) => extractTextParts(message.content).join("\n").trim())
    .filter(Boolean);
}

function extractToolCalls(messages = []) {
  return messages.flatMap((message) => message?.tool_calls ?? []);
}

async function main() {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  await fs.mkdir(SCREENSHOT_ROOT, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 120,
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();

  const runMonitor = {
    startedCount: 0,
    finishedCount: 0,
    activeRequests: new Set(),
    startedRuns: [],
  };

  page.on("request", (request) => {
    if (!isRunStreamRequest(request)) {
      return;
    }
    runMonitor.startedCount += 1;
    runMonitor.startedRuns.push({
      count: runMonitor.startedCount,
      threadId: extractThreadIdFromRunURL(request.url()),
      url: request.url(),
    });
    runMonitor.activeRequests.add(request);
    log("stream:start", request.url());
  });
  const finishRunRequest = (request) => {
    if (!runMonitor.activeRequests.has(request)) {
      return;
    }
    runMonitor.activeRequests.delete(request);
    runMonitor.finishedCount += 1;
    log("stream:end", request.url());
  };
  page.on("requestfinished", finishRunRequest);
  page.on("requestfailed", finishRunRequest);

  const result = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    scenarios: [],
  };

  try {
    await login(page, {
      baseUrl: BASE_URL,
      account: LOGIN_ACCOUNT,
      password: LOGIN_PASSWORD,
    });
    result.loginScreenshot = await capture(
      page,
      SCREENSHOT_ROOT,
      "find-skills-after-login",
    );
    const auth = await readAuthState(page);
    if (!auth?.token) {
      throw new Error("Login succeeded but auth token was missing.");
    }

    for (const scenario of scenarios) {
      const beforeStart = runMonitor.startedCount;
      await page.goto(`${BASE_URL}/workspace/chats/new?agent_status=dev`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("textarea[name='message']").last().waitFor({
        state: "visible",
        timeout: 60000,
      });
      await sendMessage(page, scenario.prompt);

      const threadId = await waitForCondition(
        `${scenario.key} thread id`,
        async () => {
          if (parseThreadIdFromURL(page.url())) {
            return parseThreadIdFromURL(page.url());
          }
          for (let index = runMonitor.startedRuns.length - 1; index >= 0; index -= 1) {
            const run = runMonitor.startedRuns[index];
            if (run.count <= beforeStart) {
              break;
            }
            if (run.threadId) {
              return run.threadId;
            }
          }
          return null;
        },
        90000,
        500,
      );

      await waitForCondition(
        `${scenario.key} stream finish`,
        async () =>
          runMonitor.startedCount > beforeStart &&
          runMonitor.activeRequests.size === 0 &&
          runMonitor.finishedCount >= runMonitor.startedCount,
        900000,
        1000,
      );

      const state = await waitForCondition(
        `${scenario.key} final assistant state`,
        async () => {
          const current = await getThreadState(auth, BASE_URL, threadId);
          const messages = current?.values?.messages ?? [];
          const lastMessage = messages.at(-1);
          return lastMessage?.type === "ai" ? current : null;
        },
        120000,
        1500,
      );

      const messages = state?.values?.messages ?? [];
      const toolCalls = extractToolCalls(messages).map((call) => call.name);
      const latestText = latestAssistantText(messages);
      const toolOutputs = toolMessages(messages);
      const screenshot = await capture(
        page,
        SCREENSHOT_ROOT,
        `find-skills-${scenario.key}`,
      );

      result.scenarios.push({
        key: scenario.key,
        prompt: scenario.prompt,
        threadId,
        toolCalls,
        latestText,
        toolOutputs,
        screenshot,
      });
    }

    result.success = true;
  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.stack ?? error.message : String(error);
    result.failureScreenshot = await capture(
      page,
      SCREENSHOT_ROOT,
      "find-skills-failure",
    ).catch(() => null);
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await fs.writeFile(RESULTS_JSON, JSON.stringify(result, null, 2));
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
