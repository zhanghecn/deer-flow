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

const BASE_URL = process.env.OPENAGENTS_BASE_URL ?? "http://127.0.0.1:8083";
const LOGIN_ACCOUNT = process.env.OPENAGENTS_ADMIN_ACCOUNT ?? "admin";
const LOGIN_PASSWORD = process.env.OPENAGENTS_ADMIN_PASSWORD ?? "admin123";
const HEADLESS = process.env.HEADLESS === "1";
const SLOW_MO = Number(process.env.PW_SLOW_MO ?? "120");
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? "900000");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  "todos/multi_agent_test_suite_complete/agent_test_package/runtime_results/agent_skill_regression_probe",
);
const SCREENSHOT_ROOT = path.join(OUTPUT_ROOT, "screenshots");
const RESULTS_JSON = path.join(OUTPUT_ROOT, "results.json");
const chromium = loadChromium(REPO_ROOT);

const SCENARIO_A_PROMPT =
  "从 https://github.com/MiniMax-AI/skills.git 安装全部可安装 skills；然后自己挑一个最适合代码审查的 skill，新建一个 agent 并挂载；接着切换到这个新 agent，对 /mnt/skills/system/skills/pr-review/scripts/validate_skills.py 做一次真实代码审查，并给出主要 findings。";
const SCENARIO_B_CREATE_PROMPT =
  "根据这句需求自主创建一个新 skill：‘把任意 Markdown 文档总结成固定模板，必须输出 3 条摘要、1 条风险、1 条后续建议’。把这个 skill 保存到 store，再创建一个新 agent 挂载该 skill。先不要执行真实任务，只告诉我你创建的 skill 名和 agent 名。";
const SCENARIO_B_USE_PROMPT = "请总结 /mnt/skills/system/skills/pr-review/SKILL.md。";

function log(step, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[agent-skill-regression] ${step}${suffix}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toolCalls(messages = []) {
  return messages.flatMap((message) =>
    Array.isArray(message?.tool_calls) ? message.tool_calls : [],
  );
}

function toolCallNames(messages = []) {
  return toolCalls(messages)
    .map((call) => call?.name)
    .filter((name) => typeof name === "string" && name.trim().length > 0);
}

function toolMessages(messages = []) {
  return messages
    .filter((message) => message?.type === "tool")
    .map((message) => extractTextParts(message.content).join("\n").trim())
    .filter(Boolean);
}

function latestStartedThreadId(runMonitor, baselineStartCount) {
  for (let index = runMonitor.startedRuns.length - 1; index >= 0; index -= 1) {
    const run = runMonitor.startedRuns[index];
    if (run.count <= baselineStartCount) {
      break;
    }
    if (run.threadId) {
      return run.threadId;
    }
  }
  return null;
}

function buildRunMonitor(page) {
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

  return runMonitor;
}

async function waitForThreadId({ page, runMonitor, baselineStartCount, key }) {
  return waitForCondition(
    `${key} thread id`,
    async () =>
      parseThreadIdFromURL(page.url()) ??
      latestStartedThreadId(runMonitor, baselineStartCount),
    90000,
    300,
  );
}

async function waitForFinalAssistantState({
  auth,
  page,
  runMonitor,
  baselineStartCount,
  threadId,
  key,
}) {
  await waitForCondition(
    `${key} stream start`,
    async () => runMonitor.startedCount > baselineStartCount,
    120000,
    300,
  );

  await waitForCondition(
    `${key} stream finish`,
    async () =>
      runMonitor.activeRequests.size === 0 &&
      runMonitor.finishedCount >= runMonitor.startedCount,
    RUN_TIMEOUT_MS,
    1000,
  );

  return waitForCondition(
    `${key} assistant state`,
    async () => {
      const current = await getThreadState(auth, BASE_URL, threadId);
      const messages = current?.values?.messages ?? [];
      const lastMessage = messages.at(-1);
      return lastMessage?.type === "ai" ? current : null;
    },
    120000,
    1500,
  );
}

async function runScenario({
  page,
  auth,
  runMonitor,
  key,
  selectionPath,
  prompt,
}) {
  const baselineStartCount = runMonitor.startedCount;
  await page.goto(`${BASE_URL}${selectionPath}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("textarea[name='message']").last().waitFor({
    state: "visible",
    timeout: 60000,
  });
  await sendMessage(page, prompt);

  const threadId = await waitForThreadId({
    page,
    runMonitor,
    baselineStartCount,
    key,
  });
  const state = await waitForFinalAssistantState({
    auth,
    page,
    runMonitor,
    baselineStartCount,
    threadId,
    key,
  });
  const messages = state?.values?.messages ?? [];

  return {
    threadId,
    messages,
    latestText: latestAssistantText(messages),
    toolCallNames: toolCallNames(messages),
    toolMessages: toolMessages(messages),
    screenshot: await capture(page, SCREENSHOT_ROOT, key),
  };
}

function extractNameFromToolMessages(messages, pattern) {
  for (const message of messages) {
    const match = pattern.exec(message);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function normalizeSkillIndex(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.skills)) {
    return payload.skills;
  }
  return [];
}

async function main() {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  await fs.mkdir(SCREENSHOT_ROOT, { recursive: true });

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOW_MO,
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  const runMonitor = buildRunMonitor(page);

  const result = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    scenarioA: null,
    scenarioB: null,
  };

  try {
    await login(page, {
      baseUrl: BASE_URL,
      account: LOGIN_ACCOUNT,
      password: LOGIN_PASSWORD,
    });
    result.loginScreenshot = await capture(page, SCREENSHOT_ROOT, "after-login");

    const auth = await readAuthState(page);
    assert(auth?.token, "Login succeeded but auth token was missing.");

    const scenarioA = await runScenario({
      page,
      auth,
      runMonitor,
      key: "scenario-a",
      selectionPath: "/workspace/chats/new?agent_status=dev",
      prompt: SCENARIO_A_PROMPT,
    });

    assert(
      scenarioA.toolCallNames.includes("install_skill_from_registry"),
      "Scenario A did not call install_skill_from_registry.",
    );
    assert(
      scenarioA.toolCallNames.includes("setup_agent"),
      "Scenario A did not call setup_agent.",
    );
    assert(
      scenarioA.toolCallNames.includes("task"),
      "Scenario A did not call task to use the created agent.",
    );
    assert(
      scenarioA.latestText.trim().length >= 30,
      "Scenario A finished without a substantive assistant answer.",
    );

    const scenarioBCreate = await runScenario({
      page,
      auth,
      runMonitor,
      key: "scenario-b-create",
      selectionPath: "/workspace/chats/new?agent_status=dev",
      prompt: SCENARIO_B_CREATE_PROMPT,
    });

    assert(
      scenarioBCreate.toolCallNames.includes("save_skill_to_store"),
      "Scenario B creation did not call save_skill_to_store.",
    );
    assert(
      scenarioBCreate.toolCallNames.includes("setup_agent"),
      "Scenario B creation did not call setup_agent.",
    );

    const createdSkillName = extractNameFromToolMessages(
      scenarioBCreate.toolMessages,
      /Skill '([^']+)' saved to /,
    );
    const createdAgentName = extractNameFromToolMessages(
      scenarioBCreate.toolMessages,
      /Agent '([^']+)' (?:created|updated) successfully!/,
    );

    assert(createdSkillName, "Scenario B creation did not expose a saved skill name.");
    assert(createdAgentName, "Scenario B creation did not expose a created agent name.");

    const createdAgent = await fetchJSON(
      auth,
      `${BASE_URL}/api/agents/${encodeURIComponent(createdAgentName)}?status=dev`,
    );
    assert(
      createdAgent?.name === createdAgentName,
      `Created agent '${createdAgentName}' was not returned by the dev agent API.`,
    );

    const devSkills = normalizeSkillIndex(
      await fetchJSON(auth, `${BASE_URL}/api/skills?status=dev`),
    );
    assert(
      devSkills.some((skill) => skill?.name === createdSkillName),
      `Created skill '${createdSkillName}' was not returned by the dev skills API.`,
    );

    const scenarioBUse = await runScenario({
      page,
      auth,
      runMonitor,
      key: "scenario-b-use",
      selectionPath: `/workspace/agents/${encodeURIComponent(createdAgentName)}/chats/new?agent_status=dev`,
      prompt: SCENARIO_B_USE_PROMPT,
    });

    const readFilePaths = toolCalls(scenarioBUse.messages)
      .filter((call) => call?.name === "read_file")
      .map((call) => call?.args?.file_path)
      .filter((filePath) => typeof filePath === "string" && filePath.trim().length > 0);
    const normalizedAnswer = scenarioBUse.latestText.replace(/\r\n/g, "\n");

    assert(
      readFilePaths.some((filePath) =>
        filePath.startsWith(`/mnt/user-data/agents/dev/${createdAgentName}/skills/`) &&
        filePath.endsWith("/SKILL.md"),
      ),
      "Scenario B use did not read the attached copied skill from the runtime agent path.",
    );
    assert(
      readFilePaths.includes("/mnt/skills/system/skills/pr-review/SKILL.md"),
      "Scenario B use did not read the requested source document path.",
    );
    assert(
      /(3\s*Key Takeaways|3\s*条摘要|摘要)/i.test(normalizedAnswer),
      "Scenario B use did not follow the summary template header.",
    );
    assert(
      /(Risk|风险)/i.test(normalizedAnswer),
      "Scenario B use did not include the required risk section.",
    );
    assert(
      /(Follow-up Recommendation|后续建议|建议)/i.test(normalizedAnswer),
      "Scenario B use did not include the required follow-up recommendation section.",
    );

    result.scenarioA = scenarioA;
    result.scenarioB = {
      createdSkillName,
      createdAgentName,
      creation: scenarioBCreate,
      use: scenarioBUse,
    };
    result.success = true;
  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.stack ?? error.message : String(error);
    result.failureScreenshot = await capture(
      page,
      SCREENSHOT_ROOT,
      "failure",
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
