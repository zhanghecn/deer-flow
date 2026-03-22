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
  sanitizeProbeToken,
  sendMessage,
  waitForCondition,
} from "./browser_probe_utils.mjs";

const BASE_URL = process.env.OPENAGENTS_BASE_URL ?? "http://127.0.0.1:3101";
const LOGIN_ACCOUNT = process.env.OPENAGENTS_ADMIN_ACCOUNT ?? "admin";
const LOGIN_PASSWORD = process.env.OPENAGENTS_ADMIN_PASSWORD ?? "admin123";
const HEADLESS = process.env.HEADLESS === "1";
const SLOW_MO = Number(process.env.PW_SLOW_MO ?? "150");
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? "900000");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const chromium = loadChromium(REPO_ROOT);
const ONLY_SUITE = process.env.ONLY_SUITE?.trim() ?? "";
const ARTIFACT_KEYS = (process.env.ARTIFACT_KEYS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const SKIP_ARTIFACTS = process.env.SKIP_ARTIFACTS === "1";
const RUN_ARTIFACTS_ONLY = ONLY_SUITE === "artifacts";
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  "todos/multi_agent_test_suite_complete/agent_test_package/runtime_results",
);
const SCREENSHOT_ROOT = path.join(OUTPUT_ROOT, "screenshots");
const DOWNLOAD_ROOT = path.join(OUTPUT_ROOT, "downloads");
const DEMO_ROOT = path.join(OUTPUT_ROOT, "demo-extracts");
const RESULTS_JSON = path.join(OUTPUT_ROOT, "headed_full_flow_results.json");
const TEST_RUN_ID = sanitizeProbeToken(
  process.env.OPENAGENTS_TEST_RUN_ID?.trim() ?? Date.now().toString(36).slice(-6),
);
const RETRY_SUFFIX = sanitizeProbeToken(
  process.env.RUN_SUFFIX?.trim() ?? TEST_RUN_ID,
);

function buildDomainSuite({
  key,
  label,
  stem,
  skillPurpose,
  agentPurpose,
  agentTestPrompt,
}) {
  const skillName = `oa-test-${stem}-${TEST_RUN_ID}`;
  const agentName = `oa-${stem}-agent-${TEST_RUN_ID}`;

  return {
    key,
    label,
    skillName,
    agentName,
    createSkillPrompt:
      `/create-skill 请明确使用 $skill-creator 创建一个名为 ${skillName} 的最小可用技能草稿。用途: ${skillPurpose}。只创建可测试的最小版本, 不要过度扩展。完成后给我 next_steps。`,
    createAgentFollowup:
      `请立即调用 setup_agent 完成这个 dev agent。要求: ${agentPurpose}；必须复用已经发布到 prod 的 skill ${skillName}，并在 skills 参数里显式写 source_path=store/prod/${skillName}，不要只传裸 name，也不要新建内联 skill。`,
    agentTestPrompt,
  };
}

const domainSuites = [
  buildDomainSuite({
    key: "software",
    label: "软件工程与代码类",
    stem: "se-code",
    skillPurpose:
      "聚焦软件工程与代码任务, 包括代码审查、根因定位、回归测试、补测试、架构约束检查",
    agentPurpose:
      "这是一个 dev agent，专注代码审查、性能诊断、bug 修复与补回归测试",
    agentTestPrompt:
      "请审查这段 TypeScript 代码并指出至少 3 个具体问题，然后给一个最小修复方案： function login(u:any,p:any){ if(u=='admin'){ return md5(p) } return null }",
  }),
  buildDomainSuite({
    key: "browser",
    label: "网页与浏览器操作类",
    stem: "web-browser",
    skillPurpose:
      "聚焦网页与浏览器操作任务, 包括页面导航、表单填写、登录校验、多标签切换、截图与浏览器流程排错",
    agentPurpose:
      "专注浏览器操作、页面流程验证、状态恢复与多窗口问题复现",
    agentTestPrompt:
      "请给出一个网站登录流程的浏览器测试清单，覆盖登录、刷新、返回、重新打开标签页、错误提示和上传文件验证，并输出成结构化 markdown。",
  }),
  buildDomainSuite({
    key: "tool_api",
    label: "工具调用与 API 使用类",
    stem: "tool-api",
    skillPurpose:
      "聚焦工具调用与 API 使用, 包括选择 built-in tools、校验请求头、线程绑定、interrupt/resume、artifact API 与发布导出链路",
    agentPurpose:
      "专注工具调用、API 验证、发布导出和错误回退",
    agentTestPrompt:
      "请输出一个 API 测试计划，覆盖鉴权、线程绑定、interrupt/resume、artifact 下载、open API 调用和错误回退，每项给出输入、期望、失败信号。",
  }),
  buildDomainSuite({
    key: "life",
    label: "综合与复杂生活场景类",
    stem: "life-workflow",
    skillPurpose:
      "聚焦综合生活与复杂工作流场景, 包括多约束决策、文件整合、结构化交付和方案比较",
    agentPurpose:
      "专注复杂生活与商业场景拆解、比较和结构化交付",
    agentTestPrompt:
      "请为 2 位成人规划一个 3 天上海亲子行程，预算 6000 元以内，输出按天安排、预算分配、雨天备选和风险提示。",
  }),
];

const artifactScenarios = [
  {
    key: "markdown",
    prompt:
      "请生成一个 markdown 文件，文件名为 /mnt/user-data/outputs/agent-smoke-note.md，内容包含标题、一个三列表格和 3 条待办。完成后必须用 present_files 展示这个 markdown 文件。",
  },
  {
    key: "pdf",
    prompt:
      "请使用 Python 标准库或系统现成能力生成一个最小可打开的 PDF 文件，输出到 /mnt/user-data/outputs/openagents-smoke-report.pdf。内容必须包含标题 OpenAgents Smoke PDF、今天日期、以及 3 条编号项。不要安装新依赖，也不要长时间卡在环境探测；若无现成库，请直接写最小 PDF 结构。完成后用 present_files 展示这个 PDF。",
  },
  {
    key: "word",
    prompt:
      "请使用 Python 标准库或系统现成能力生成一个最小可打开的 DOCX 文件，输出到 /mnt/user-data/outputs/openagents-smoke-report.docx。内容必须包含标题 OpenAgents Smoke Word、一个两列表格和 3 条项目符号。不要安装新依赖；若没有 docx 库，请直接写最小 OOXML zip 结构。完成后用 present_files 展示这个 DOCX。",
  },
  {
    key: "ppt",
    prompt:
      "请明确使用 $ppt-generation 生成一个 3 页的 PPTX，主题为 OpenAgents 测试流程，输出到 /mnt/user-data/outputs/openagents-test-flow.pptx，并把结果作为文件产物给我。",
  },
  {
    key: "image",
    prompt:
      "请明确使用 $image-generation 生成一张 16:9 图片，主题为鹿角风格的智能体工作台，输出到 /mnt/user-data/outputs/openagents-agent-workbench.jpg，并展示给我。",
  },
  {
    key: "video",
    prompt:
      "请明确使用 $video-generation 生成一个很短的视频示例，主题为智能体在白板前规划任务，输出到 /mnt/user-data/outputs/openagents-agent-planning.mp4。",
  },
  {
    key: "podcast",
    prompt:
      "请明确使用 $podcast-generation 把一段简短文字转成播客，输出 transcript markdown 与音频文件到 /mnt/user-data/outputs/ 目录，并把文件展示给我。文本内容: OpenAgents 用统一虚拟路径约束来隔离本地、sandbox 和 remote 运行时。",
  },
];

const selectedDomainSuites = ONLY_SUITE
  ? domainSuites.filter(
      (suite) =>
        suite.key === ONLY_SUITE ||
        suite.skillName === ONLY_SUITE ||
        suite.agentName === ONLY_SUITE,
    )
  : domainSuites;
const selectedArtifactScenarios =
  ARTIFACT_KEYS.length > 0
    ? artifactScenarios.filter((scenario) => ARTIFACT_KEYS.includes(scenario.key))
    : artifactScenarios;

function log(step, detail = "") {
  const stamp = new Date().toISOString();
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[${stamp}] ${step}${suffix}`);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function isThreadStateRequest(url) {
  return (
    url.includes("/api/langgraph/threads/") && url.includes("/state?subgraphs=true")
  );
}

function extractToolCalls(messages = []) {
  return messages.flatMap((message) => message?.tool_calls ?? []);
}

async function getProbeThreadState(auth, threadId) {
  return getThreadState(auth, BASE_URL, threadId);
}

async function captureProbe(page, name) {
  return capture(page, SCREENSHOT_ROOT, name);
}

async function loginProbe(page) {
  log("login:start", BASE_URL);
  await login(page, {
    baseUrl: BASE_URL,
    account: LOGIN_ACCOUNT,
    password: LOGIN_PASSWORD,
  });
  log("login:done", page.url());
}

async function listSkills(auth, status) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchJSON(auth, `${BASE_URL}/api/skills${suffix}`);
}

async function getAgent(auth, name, status = "dev") {
  return fetchJSON(
    auth,
    `${BASE_URL}/api/agents/${encodeURIComponent(name)}?status=${encodeURIComponent(status)}`,
  );
}

async function checkAgentNameAvailability(auth, name) {
  return fetchJSON(
    auth,
    `${BASE_URL}/api/agents/check?name=${encodeURIComponent(name)}`,
  );
}

async function getAgentExport(auth, name) {
  return fetchJSON(auth, `${BASE_URL}/api/agents/${encodeURIComponent(name)}/export`);
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

async function waitForThreadReference({ page, runMonitor, baselineStartCount }) {
  return waitForCondition(
    "thread URL",
    async () =>
      parseThreadIdFromURL(page.url()) ??
      latestStartedThreadId(runMonitor, baselineStartCount),
    90000,
    300,
  );
}

async function waitForRunCompletion({
  page,
  auth,
  threadId,
  runMonitor,
  baselineStartCount,
  baselineHumanCount = 0,
}) {
  await waitForCondition(
    `run stream start for ${threadId}`,
    async () => runMonitor.startedCount > baselineStartCount,
    120000,
    300,
  );

  await waitForCondition(
    `run stream finish for ${threadId}`,
    async () => runMonitor.activeRequests.size === 0 && runMonitor.finishedCount >= runMonitor.startedCount,
    RUN_TIMEOUT_MS,
    1000,
  );

  return waitForCondition(
    `state update for ${threadId}`,
    async () => {
      const state = await getProbeThreadState(auth, threadId);
      const messages = state?.values?.messages ?? [];
      const humanCount = messages.filter((message) => message?.type === "human").length;
      const lastMessage = messages.at(-1);
      if (humanCount <= baselineHumanCount || lastMessage?.type !== "ai") {
        return null;
      }
      return state;
    },
    120000,
    1500,
  );
}

async function startAutosendRun({ page, auth, prompt, selectionPath, runMonitor }) {
  const beforeStart = runMonitor.startedCount;
  log("run:start", selectionPath);
  await page.goto(`${BASE_URL}${selectionPath}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("textarea[name='message']").last().waitFor({
    state: "visible",
    timeout: 60000,
  });
  await sendMessage(page, prompt);
  const threadId = await waitForThreadReference({
    page,
    runMonitor,
    baselineStartCount: beforeStart,
  });
  const state = await waitForRunCompletion({
    page,
    auth,
    threadId,
    runMonitor,
    baselineStartCount: beforeStart,
    baselineHumanCount: 0,
  });
  log("run:done", `${selectionPath} thread=${threadId}`);
  return { threadId, state };
}

async function continueRun({
  page,
  auth,
  prompt,
  runMonitor,
  threadId: explicitThreadId,
}) {
  const threadId = explicitThreadId ?? parseThreadIdFromURL(page.url());
  if (!threadId) {
    throw new Error(`Cannot continue run because page URL has no thread id: ${page.url()}`);
  }
  const beforeStart = runMonitor.startedCount;
  const beforeState = await getProbeThreadState(auth, threadId);
  const beforeHumanCount = (beforeState?.values?.messages ?? []).filter(
    (message) => message?.type === "human",
  ).length;
  log("run:continue", `thread=${threadId}`);
  await sendMessage(page, prompt);
  const state = await waitForRunCompletion({
    page,
    auth,
    threadId,
    runMonitor,
    baselineStartCount: beforeStart,
    baselineHumanCount: beforeHumanCount,
  });
  log("run:continued", `thread=${threadId}`);
  return { threadId, state };
}

async function createAgentThroughUI({ page, agentName, followupPrompt, auth, runMonitor }) {
  let resolvedAgentName = agentName;
  const initialAvailability = await checkAgentNameAvailability(auth, agentName);
  if (!initialAvailability.available) {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const candidate = `${agentName}-${RETRY_SUFFIX}-${String(attempt).padStart(2, "0")}`;
      const availability = await checkAgentNameAvailability(auth, candidate);
      if (availability.available) {
        resolvedAgentName = candidate;
        break;
      }
    }
  }

  if (resolvedAgentName !== agentName) {
    log("agent:create:renamed", `${agentName} -> ${resolvedAgentName}`);
  }

  log("agent:create:start", resolvedAgentName);
  await page.goto(`${BASE_URL}/workspace/agents/new`, { waitUntil: "domcontentloaded" });
  const nameInput = page.locator("input").first();
  await nameInput.fill(resolvedAgentName);
  const beforeStart = runMonitor.startedCount;
  await nameInput.press("Enter");
  const threadId = await waitForThreadReference({
    page,
    runMonitor,
    baselineStartCount: beforeStart,
  });
  await waitForRunCompletion({
    page,
    auth,
    threadId,
    runMonitor,
    baselineStartCount: beforeStart,
    baselineHumanCount: 0,
  });
  if (followupPrompt) {
    await continueRun({
      page,
      auth,
      prompt: followupPrompt,
      runMonitor,
      threadId,
    });
  }
  log("agent:create:done", `${resolvedAgentName} thread=${threadId}`);
  return { threadId, agentName: resolvedAgentName };
}

async function unzipDemo(zipPath, targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await ensureDir(targetDir);
  const { execFileSync } = await import("node:child_process");
  execFileSync("unzip", ["-o", zipPath, "-d", targetDir], {
    stdio: "inherit",
  });
}

async function main() {
  await Promise.all([
    ensureDir(OUTPUT_ROOT),
    ensureDir(SCREENSHOT_ROOT),
    ensureDir(DOWNLOAD_ROOT),
    ensureDir(DEMO_ROOT),
  ]);

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOW_MO,
  });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();

  const runMonitor = {
    startedCount: 0,
    finishedCount: 0,
    activeRequests: new Set(),
    startedRuns: [],
    stateFailures: [],
  };

  page.on("pageerror", (error) => {
    log("pageerror", error?.stack || error?.message || String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      log(`console:${message.type()}`, message.text());
    }
  });

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

  const finishRunRequest = (request, failed = false) => {
    if (!runMonitor.activeRequests.has(request)) {
      return;
    }
    runMonitor.activeRequests.delete(request);
    runMonitor.finishedCount += 1;
    log(failed ? "stream:failed" : "stream:done", request.url());
  };

  page.on("requestfinished", (request) => finishRunRequest(request, false));
  page.on("requestfailed", (request) => finishRunRequest(request, true));
  page.on("response", async (response) => {
    const url = response.url();
    if (!isThreadStateRequest(url) || response.status() < 400) {
      return;
    }

    const failure = {
      url,
      status: response.status(),
      statusText: response.statusText(),
    };
    runMonitor.stateFailures.push(failure);
    log("state:failure", `${failure.status} ${failure.url}`);
  });

  const results = {
    baseUrl: BASE_URL,
    startedAt: new Date().toISOString(),
    suites: [],
    artifacts: [],
    stateFailures: [],
  };

  try {
    await loginProbe(page);
    const auth = await readAuthState(page);
    if (!auth?.token) {
      throw new Error("Login succeeded in UI but no auth token was found in localStorage.");
    }
    results.authUser = auth.user;
    await captureProbe(page, "after-login");

    if (ONLY_SUITE && !RUN_ARTIFACTS_ONLY && selectedDomainSuites.length === 0) {
      throw new Error(`ONLY_SUITE=${ONLY_SUITE} did not match any configured suite.`);
    }
    if (ARTIFACT_KEYS.length > 0 && selectedArtifactScenarios.length === 0) {
      throw new Error(
        `ARTIFACT_KEYS=${ARTIFACT_KEYS.join(",")} did not match any configured artifact scenario.`,
      );
    }

    for (const suite of RUN_ARTIFACTS_ONLY ? [] : selectedDomainSuites) {
      log("suite:start", suite.label);
      const suiteResult = {
        ...suite,
      };

      const createSkillRun = await startAutosendRun({
        page,
        auth,
        prompt: suite.createSkillPrompt,
        selectionPath: "/workspace/chats/new?agent_status=dev",
        runMonitor,
      });
      suiteResult.skillThreadId = createSkillRun.threadId;
      suiteResult.skillCreateLatestText = latestAssistantText(
        createSkillRun.state?.values?.messages,
      );
      suiteResult.skillCreateToolCalls = extractToolCalls(
        createSkillRun.state?.values?.messages,
      ).map((call) => call.name);
      suiteResult.skillCreateScreenshot = await captureProbe(
        page,
        `${suite.key}-skill-created`,
      );

      const saveSkillRun = await continueRun({
        page,
        auth,
        prompt: `/save-skill-to-store 请保存当前线程里刚创建的 ${suite.skillName} 草稿。`,
        runMonitor,
      });
      suiteResult.skillSaveLatestText = latestAssistantText(
        saveSkillRun.state?.values?.messages,
      );
      suiteResult.skillSaveToolCalls = extractToolCalls(
        saveSkillRun.state?.values?.messages,
      ).map((call) => call.name);
      suiteResult.skillSavedScreenshot = await captureProbe(
        page,
        `${suite.key}-skill-saved`,
      );

      const pushSkillRun = await continueRun({
        page,
        auth,
        prompt: `/push-skill-prod 请把 dev skill ${suite.skillName} 推送到 prod。必要时直接调用 push_skill_prod(skill_name="${suite.skillName}")。`,
        runMonitor,
      });
      suiteResult.skillPushLatestText = latestAssistantText(
        pushSkillRun.state?.values?.messages,
      );
      suiteResult.skillPushToolCalls = extractToolCalls(
        pushSkillRun.state?.values?.messages,
      ).map((call) => call.name);
      suiteResult.skillPushedScreenshot = await captureProbe(
        page,
        `${suite.key}-skill-pushed`,
      );

      const devSkills = await listSkills(auth, "dev");
      const prodSkills = await listSkills(auth, "prod");
      suiteResult.devSkillVisible = (devSkills.skills ?? []).some(
        (skill) => skill.name === suite.skillName,
      );
      suiteResult.prodSkillVisible = (prodSkills.skills ?? []).some(
        (skill) => skill.name === suite.skillName,
      );

      const createdAgent = await createAgentThroughUI({
        page,
        agentName: suite.agentName,
        followupPrompt: suite.createAgentFollowup,
        auth,
        runMonitor,
      });
      const actualAgentName = createdAgent.agentName;
      suiteResult.agentRequestedName = suite.agentName;
      suiteResult.agentName = actualAgentName;
      suiteResult.agentCreateThreadId = createdAgent.threadId;
      suiteResult.agentDev = await getAgent(auth, actualAgentName, "dev");
      suiteResult.agentCreateScreenshot = await captureProbe(
        page,
        `${suite.key}-agent-created`,
      );

      const agentRun = await startAutosendRun({
        page,
        auth,
        prompt: suite.agentTestPrompt,
        selectionPath: `/workspace/agents/${encodeURIComponent(
          actualAgentName,
        )}/chats/new?agent_status=dev`,
        runMonitor,
      });
      suiteResult.agentTestThreadId = agentRun.threadId;
      suiteResult.agentTestLatestText = latestAssistantText(
        agentRun.state?.values?.messages,
      );
      suiteResult.agentTestArtifacts = agentRun.state?.values?.artifacts ?? [];
      suiteResult.agentTestScreenshot = await captureProbe(
        page,
        `${suite.key}-agent-tested`,
      );

      const pushAgentRun = await continueRun({
        page,
        auth,
        prompt: `/push-agent-prod 请把当前 dev agent 推送到 prod。agent_name=${actualAgentName}。必要时直接调用 push_agent_prod(agent_name="${actualAgentName}")。`,
        runMonitor,
      });
      suiteResult.agentPushLatestText = latestAssistantText(
        pushAgentRun.state?.values?.messages,
      );
      suiteResult.agentPushToolCalls = extractToolCalls(
        pushAgentRun.state?.values?.messages,
      ).map((call) => call.name);
      suiteResult.agentPushedScreenshot = await captureProbe(
        page,
        `${suite.key}-agent-pushed`,
      );

      suiteResult.agentProd = await getAgent(auth, actualAgentName, "prod");
      suiteResult.agentExport = await getAgentExport(auth, actualAgentName);

      await page.goto(`${BASE_URL}/workspace/agents`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
      const prodCard = page
        .locator(".group")
        .filter({ has: page.getByText(actualAgentName, { exact: true }) })
        .filter({ has: page.getByText("prod", { exact: true }) })
        .first();
      await prodCard.scrollIntoViewIfNeeded();
      await prodCard.getByTitle("Download React Demo").click();
      const download = await downloadPromise;
      const downloadPath = path.join(DOWNLOAD_ROOT, `${actualAgentName}-react-demo.zip`);
      await download.saveAs(downloadPath);
      suiteResult.demoZip = downloadPath;
      suiteResult.demoScreenshot = await captureProbe(
        page,
        `${suite.key}-demo-downloaded`,
      );
      const demoExtractDir = path.join(DEMO_ROOT, actualAgentName);
      await unzipDemo(downloadPath, demoExtractDir);
      suiteResult.demoExtractDir = demoExtractDir;

      results.suites.push(suiteResult);
      log("suite:done", suite.label);
    }

    if (!SKIP_ARTIFACTS || RUN_ARTIFACTS_ONLY) {
      const artifactResult = {
        threadId: null,
        scenarios: [],
      };
      for (const scenario of selectedArtifactScenarios) {
        const artifactRun = await startAutosendRun({
          page,
          auth,
          prompt: scenario.prompt,
          selectionPath: "/workspace/chats/new?agent_status=dev",
          runMonitor,
        });
        artifactResult.threadId = artifactRun.threadId;
        artifactResult.scenarios.push({
          key: scenario.key,
          latestText: latestAssistantText(artifactRun.state?.values?.messages),
          artifacts: artifactRun.state?.values?.artifacts ?? [],
          screenshot: await captureProbe(page, `artifact-${scenario.key}`),
        });
      }
      results.artifacts.push(artifactResult);
    }
  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    results.errorScreenshot = await captureProbe(page, "failure");
    throw error;
  } finally {
    results.stateFailures = runMonitor.stateFailures;
    results.finishedAt = new Date().toISOString();
    await fs.writeFile(RESULTS_JSON, JSON.stringify(results, null, 2));
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
