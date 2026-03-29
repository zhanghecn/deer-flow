import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  capture,
  extractTextParts,
  extractThreadIdFromRunURL,
  fetchJSON,
  fetchRaw,
  getThreadState,
  isRunStreamRequest,
  latestAssistantText as readLatestAssistantText,
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
const HEADLESS = process.env.HEADLESS === "1";
const SLOW_MO = Number(process.env.PW_SLOW_MO ?? "150");
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? "600000");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DATASET_ROOT = path.join(
  REPO_ROOT,
  "todos/multi_agent_test_suite_complete/agent_dataset",
);
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  "todos/multi_agent_test_suite_complete/agent_test_package/runtime_results/agent_dataset_browser_probe",
);
const SCREENSHOT_ROOT = path.join(OUTPUT_ROOT, "screenshots");
const FILE_ROOT = path.join(OUTPUT_ROOT, "files");
const PREPARED_UPLOAD_ROOT = path.join(OUTPUT_ROOT, "prepared_uploads");
const RESULTS_JSON = path.join(OUTPUT_ROOT, "results.json");
const SUMMARY_MD = path.join(OUTPUT_ROOT, "summary.md");
const chromium = loadChromium(REPO_ROOT);

const DEFAULT_CASE_ORDER = ["TC-A", "TC-B", "TC-02", "TC-03", "TC-01", "TC-04", "TC-C"];
const CASE_ORDER = (process.env.CASE_IDS ?? DEFAULT_CASE_ORDER.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const FIRST_REPLY_CASES = new Set(["TC-A", "TC-B"]);

function log(step, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[agent-dataset] ${step}${suffix}`);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeStructuredText(value) {
  return value.replace(/\\n/g, "\n");
}

function stripMarkdown(value) {
  return normalizeWhitespace(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_#>\-[\]()]/g, " "),
  );
}

function parseMarkdownSections(markdownText) {
  const sections = [];
  let currentHeading = "";
  let currentLines = [];

  const flush = () => {
    if (!currentHeading) {
      currentLines = [];
      return;
    }
    sections.push({
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
    });
    currentLines = [];
  };

  for (const line of markdownText.replace(/\r\n/g, "\n").split("\n")) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      continue;
    }
    if (!currentHeading) {
      continue;
    }
    currentLines.push(line);
  }

  flush();
  return sections;
}

function buildUserPromptFromTask(taskText) {
  const visibleHeadings = new Set([
    "你的任务",
    "强制约束",
    "强制约束（全部必须满足）",
    "行程格式要求",
    "最终交付物",
  ]);
  const sections = parseMarkdownSections(taskText).filter((section) =>
    visibleHeadings.has(section.heading),
  );

  if (sections.length === 0) {
    return normalizeText(taskText);
  }

  const formattedSections = sections
    .filter((section) => section.content.length > 0)
    .map((section) =>
      section.heading === "你的任务"
        ? section.content.trim()
        : `## ${section.heading}\n${section.content.trim()}`,
    );

  return formattedSections.join("\n\n").trim();
}

function latestAssistantText(messages = []) {
  return normalizeText(readLatestAssistantText(messages));
}

function firstAssistantReply(messages = []) {
  for (const message of messages) {
    if (message?.type !== "ai") {
      continue;
    }
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const text = normalizeText(extractTextParts(message.content).join("\n"));
    const questionCalls = toolCalls.filter((call) => call?.name === "question");
    const questionPrompt = normalizeText(
      questionCalls
        .flatMap((call) => (Array.isArray(call?.args?.questions) ? call.args.questions : []))
        .map((question) => question?.question)
        .filter((question) => typeof question === "string" && question.trim().length > 0)
        .join("\n\n"),
    );
    const questionOptions = questionCalls.flatMap((call) =>
      Array.isArray(call?.args?.questions)
        ? call.args.questions.flatMap((question) =>
            Array.isArray(question?.options)
              ? question.options
                  .map((option) =>
                    typeof option === "string" ? option : option?.label,
                  )
                  .filter(
                    (option) =>
                      typeof option === "string" && option.trim().length > 0,
                  )
              : [],
          )
        : [],
    );
    const onlyReadsUploadedFiles =
      toolCalls.length > 0 &&
      toolCalls.every((call) => call?.name === "read_file");

    if (onlyReadsUploadedFiles && !questionPrompt && questionOptions.length === 0) {
      continue;
    }

    if (text || questionPrompt || questionOptions.length > 0) {
      return {
        text,
        questionPrompt,
        questionOptions,
      };
    }
  }
  return {
    text: "",
    questionPrompt: "",
    questionOptions: [],
  };
}

function extractToolCalls(messages = []) {
  return messages.flatMap((message) => message?.tool_calls ?? []);
}

function countQuestionMarks(text) {
  return (text.match(/[?？]/g) ?? []).length;
}

function containsOptionList(text) {
  const normalized = normalizeStructuredText(text);
  const bulletCount = (normalized.match(/(^|\n)\s*[-*•]\s+\S+/g) ?? []).length;
  return (
    /(^|\n)\s*(1[.)、]|2[.)、]|3[.)、]|4[.)、]|5[.)、])/m.test(normalized) ||
    /选项\s*[A-C]/i.test(normalized) ||
    /以下选项之一|请选择以下|选择以下选项|可选方案/.test(normalized) ||
    /\bA\b.*\bB\b.*\bC\b/s.test(normalized) ||
    bulletCount >= 3
  );
}

function containsClarification(text) {
  return /请问|想要|哪种|什么类型|什么样的|请选择|告诉我您的选择|具体需求|澄清|了解一下细节|需要了解/.test(
    normalizeStructuredText(text),
  );
}

function containsConflictRecognition(text) {
  return /冲突|矛盾|无法同时满足|不能同时|互相冲突/.test(text);
}

function containsPriorityQuestion(text) {
  return /优先|请问.*哪个|请选择|确认|选项\s*[A-C]|选择以下|以下选项之一|澄清一下/i.test(
    normalizeStructuredText(text),
  );
}

function countCharLength(text) {
  return stripMarkdown(text).replace(/\s+/g, "").length;
}

function containsApproxNumber(text, expected, tolerance = 0.01) {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.some((match) => {
    const parsed = Number(match.replace(/,/g, ""));
    return Number.isFinite(parsed) && Math.abs(parsed - expected) <= tolerance;
  });
}

function containsExactInteger(text, expected) {
  const matches = text.match(/\d[\d,]*/g) ?? [];
  return matches.some((match) => Number(match.replace(/,/g, "")) === expected);
}

function extractSignificantSnippet(text) {
  const stripped = stripMarkdown(text);
  const candidates = stripped
    .split(/[。！!？?\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
  return candidates[0] ?? stripped.slice(0, 24);
}

function normalizeSearchText(value) {
  return normalizeWhitespace(value).replace(/[“”]/g, '"');
}

function containsTextRelaxed(haystack, needle) {
  if (!haystack || !needle) {
    return false;
  }
  return normalizeSearchText(haystack).includes(normalizeSearchText(needle));
}

function extractSlogan(text) {
  const sectionMatch = text.match(/产品口号[\s\S]{0,80}?["“](.+?)["”]/);
  if (sectionMatch?.[1]) {
    return sectionMatch[1].trim();
  }
  const quotedMatch = [...text.matchAll(/["“](.+?)["”]/g)]
    .map((match) => match[1].trim())
    .find((value) => value.length >= 4 && value.length <= 40);
  return quotedMatch ?? "";
}

function extractWalkingMinutes(text) {
  return [...text.matchAll(/步行(?:约)?\s*(\d+)\s*分钟/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

function htmlLooksValid(text) {
  return /<html[\s>]/i.test(text) && /<\/html>/i.test(text);
}

function listCaseInputFiles(caseId) {
  return path.join(DATASET_ROOT, caseId, "input");
}

async function loadCase(caseId) {
  const inputDir = listCaseInputFiles(caseId);
  const taskPath = path.join(inputDir, "task.md");
  const expectedDir = path.join(DATASET_ROOT, caseId, "expected_output");
  const inputEntries = (await fs.readdir(inputDir)).sort();
  const inputFiles = inputEntries
    .filter((entry) => entry !== "task.md")
    .map((entry) => path.join(inputDir, entry));
  const taskText = await readText(taskPath);
  const checklistPath = path.join(expectedDir, "evaluation_checklist.md");
  const checklist = await readText(checklistPath);
  const correctAnswersPath = path.join(expectedDir, "correct_answers.json");
  const correctAnswers = (await pathExists(correctAnswersPath))
    ? JSON.parse(await readText(correctAnswersPath))
    : null;
  const salesDataPath = path.join(inputDir, "sales_data.csv");
  const salesData = (await pathExists(salesDataPath))
    ? await readText(salesDataPath)
    : null;

  return {
    caseId,
    inputFiles,
    taskText,
    userPrompt: buildUserPromptFromTask(taskText),
    checklist,
    correctAnswers,
    salesData,
  };
}

async function prepareCaseUploads(testCase) {
  const caseUploadDir = path.join(PREPARED_UPLOAD_ROOT, testCase.caseId);
  await ensureDir(caseUploadDir);

  const sanitizedTaskPath = path.join(caseUploadDir, "task.md");
  await fs.writeFile(sanitizedTaskPath, `${testCase.userPrompt.trim()}\n`, "utf8");

  return [sanitizedTaskPath, ...testCase.inputFiles];
}

function parseCSVValues(csvText, columnIndex) {
  return normalizeText(csvText)
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[columnIndex])
    .filter(Boolean);
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

async function fetchArtifactText(auth, threadId, filename) {
  const scopes = ["outputs", "workspace"];
  for (const scope of scopes) {
    const targetURL = `${BASE_URL}/api/threads/${threadId}/artifacts/mnt/user-data/${scope}/${encodeURIComponent(
      filename,
    )}`;
    const response = await fetchRaw(auth, targetURL, { threadId });
    if (response.ok) {
      return {
        scope,
        content: await response.text(),
        url: targetURL,
      };
    }
  }
  return null;
}

async function uploadFilesThroughUI(page, inputFiles) {
  if (inputFiles.length === 0) {
    return;
  }
  const uploadInput = page.locator('input[type="file"][aria-label="Upload files"]').last();
  await uploadInput.setInputFiles(inputFiles);
  for (const filePath of inputFiles) {
    await page.getByText(path.basename(filePath), { exact: true }).last().waitFor({
      state: "visible",
      timeout: 30000,
    });
  }
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
    "thread reference",
    async () =>
      parseThreadIdFromURL(page.url()) ??
      latestStartedThreadId(runMonitor, baselineStartCount),
    90000,
    300,
  );
}

async function waitForRunCompletion({
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
    async () =>
      runMonitor.activeRequests.size === 0 &&
      runMonitor.finishedCount >= runMonitor.startedCount,
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

async function runCase({ page, auth, runMonitor, testCase }) {
  const beforeStart = runMonitor.startedCount;
  log("case:start", testCase.caseId);
  await page.goto(`${BASE_URL}/workspace/chats/new?agent_status=dev`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('textarea[name="message"]').last().waitFor({
    state: "visible",
    timeout: 60000,
  });
  const uploadFiles = await prepareCaseUploads(testCase);
  await uploadFilesThroughUI(page, uploadFiles);
  await sendMessage(page, testCase.userPrompt);
  const threadId = await waitForThreadReference({
    page,
    runMonitor,
    baselineStartCount: beforeStart,
  });
  const state = await waitForRunCompletion({
    auth,
    threadId,
    runMonitor,
    baselineStartCount: beforeStart,
    baselineHumanCount: 0,
  });
  const screenshot = await captureProbe(page, `${testCase.caseId}-completed`);
  log("case:done", `${testCase.caseId} thread=${threadId}`);
  return { threadId, state, screenshot };
}

function addCheck(target, name, passed, score, detail = "") {
  target.checks.push({ name, passed, score, detail });
}

function finalizeScore(target) {
  target.totalScore = target.checks.reduce(
    (sum, item) => sum + (item.passed ? item.score : 0),
    0,
  );
}

async function persistOutputFiles(auth, threadId, caseId, expectedFiles, target) {
  const caseDir = path.join(FILE_ROOT, caseId);
  await ensureDir(caseDir);
  const outputs = {};

  for (const filename of expectedFiles) {
    const artifact = await fetchArtifactText(auth, threadId, filename);
    if (!artifact) {
      outputs[filename] = null;
      continue;
    }

    const localPath = path.join(caseDir, filename);
    await fs.writeFile(localPath, artifact.content);
    outputs[filename] = {
      localPath,
      scope: artifact.scope,
      url: artifact.url,
      content: artifact.content,
    };
  }

  target.outputFiles = outputs;
  return outputs;
}

function evaluateTCA(result) {
  const text = [
    result.firstAssistantText,
    result.firstQuestionPrompt,
    ...(result.firstQuestionOptions ?? []),
  ]
    .filter(Boolean)
    .join("\n\n");
  const asksClarification = containsClarification(text);
  const hasOptions =
    containsOptionList(text) || (result.firstQuestionOptions?.length ?? 0) >= 3;
  const questionCount = countQuestionMarks(text);
  result.notes = [
    `首轮回复长度: ${text.length}`,
    `问号数量: ${questionCount}`,
  ];

  if (asksClarification && hasOptions && questionCount <= 3) {
    addCheck(result, "主动澄清并提供选项", true, 100, "符合 TC-A 理想行为");
  } else if (asksClarification && hasOptions) {
    addCheck(result, "澄清充分但问题数量偏多", true, 60, "已提供选项，但追问超过推荐数量");
  } else if (asksClarification && !hasOptions) {
    addCheck(result, "提出澄清但未给选项", true, 60, "澄清存在，但选项不足");
  } else if (questionCount > 5) {
    addCheck(result, "问题过多", true, 30, "超过推荐问题数量");
  } else {
    addCheck(result, "直接执行或未有效澄清", false, 0, "未观察到合格澄清");
  }
  finalizeScore(result);
}

function evaluateTCB(result) {
  const text = [
    result.firstAssistantText,
    result.firstQuestionPrompt,
    ...(result.firstQuestionOptions ?? []),
  ]
    .filter(Boolean)
    .join("\n\n");
  const identifiesConflict = containsConflictRecognition(text);
  const mentionsReasons = /100\s*字|80\s*字|320|四个章节|四章节/.test(text);
  const asksPriority = containsPriorityQuestion(text);
  const hasOptions =
    containsOptionList(text) || (result.firstQuestionOptions?.length ?? 0) >= 2;
  result.notes = [`首轮回复长度: ${text.length}`];

  if (identifiesConflict && mentionsReasons && asksPriority && hasOptions) {
    addCheck(result, "识别冲突并要求确认优先级", true, 100, "符合 TC-B 理想行为");
  } else if (identifiesConflict && mentionsReasons) {
    addCheck(result, "识别冲突但未给解决选项", true, 50, "说明了冲突，但引导不足");
  } else if (/猫/.test(text) && text.length > 80) {
    addCheck(result, "忽略冲突直接生成内容", true, 20, "生成了内容但未先确认优先级");
  } else {
    addCheck(result, "未识别冲突", false, 0, "没有明确指出约束矛盾");
  }
  finalizeScore(result);
}

function evaluateTC01(result) {
  const outputs = result.outputFiles;
  const research = outputs["research_report.md"]?.content ?? "";
  const copy = outputs["crowdfunding_copy.md"]?.content ?? "";
  const html = outputs["landing_page.html"]?.content ?? "";
  const slogan = extractSlogan(copy);

  addCheck(
    result,
    "research_report.md 存在",
    Boolean(outputs["research_report.md"]) && countCharLength(research) > 200,
    10,
  );
  const copyLength = countCharLength(copy);
  addCheck(
    result,
    "crowdfunding_copy.md 存在且字数合理",
    Boolean(outputs["crowdfunding_copy.md"]) && copyLength >= 400 && copyLength <= 600,
    10,
    `字数=${copyLength}`,
  );
  addCheck(result, "landing_page.html 存在", Boolean(outputs["landing_page.html"]), 10);
  addCheck(result, "HTML 无占位文字", !/lorem ipsum/i.test(html), 20);
  addCheck(
    result,
    "HTML 包含文案关键词",
    Boolean(slogan) && containsTextRelaxed(html, slogan),
    20,
    `Slogan=${slogan}`,
  );
  addCheck(result, "HTML 包含语音控制关键词", /语音|voice/i.test(html), 10);
  addCheck(result, "HTML 结构完整", /<div id="product-image">/i.test(html), 10);
  addCheck(result, "HTML 可正常解析", htmlLooksValid(html), 10);
  finalizeScore(result);
}

function evaluateTC02(result) {
  const outputs = result.outputFiles;
  const py = outputs["hello_color.py"]?.content ?? "";
  const runOutput = outputs["run_output.txt"]?.content ?? "";
  const recovery = outputs["recovery_log.md"]?.content ?? "";

  addCheck(result, "hello_color.py 存在", Boolean(outputs["hello_color.py"]), 10);
  addCheck(
    result,
    "run_output.txt 存在",
    Boolean(outputs["run_output.txt"]),
    10,
  );
  addCheck(
    result,
    "run_output.txt 包含两行输出",
    /Hello, Agent World!/i.test(runOutput) && /Error Recovery Successful!/i.test(runOutput),
    20,
  );
  addCheck(
    result,
    "recovery_log.md 存在且有说明",
    Boolean(outputs["recovery_log.md"]) && countCharLength(recovery) > 50,
    10,
  );
  addCheck(
    result,
    "脚本切换到真实存在的彩色库",
    /import\s+(colorama|termcolor|rich)|from\s+(colorama|termcolor|rich)\s+import/i.test(py) &&
      !/does_not_exist_package_xyz_v99/.test(py),
    20,
  );
  addCheck(
    result,
    "步骤 1 失败后未中止",
    countCharLength(recovery) > 0 && /失败|error|不存在|恢复|切换/i.test(recovery),
    30,
  );
  finalizeScore(result);
}

function evaluateTC03(result, testCase) {
  const outputs = result.outputFiles;
  const report = outputs["analysis_report.md"]?.content ?? "";
  const correct = testCase.correctAnswers;
  const products = [...new Set(parseCSVValues(testCase.salesData, 2))];
  const channels = [...new Set(parseCSVValues(testCase.salesData, 4))];
  const months = [...new Set(parseCSVValues(testCase.salesData, 1).map((value) => value.slice(0, 7)))];

  addCheck(result, "analysis_report.md 存在", Boolean(outputs["analysis_report.md"]), 10);
  addCheck(
    result,
    "销售额总和正确",
    containsApproxNumber(report, correct.column_销售额_sum),
    30,
    String(correct.column_销售额_sum),
  );
  addCheck(
    result,
    "实际收款总和正确",
    containsApproxNumber(report, correct.column_实际收款_sum),
    20,
    String(correct.column_实际收款_sum),
  );
  addCheck(
    result,
    "销售数量总和正确",
    containsExactInteger(report, correct.column_销售数量_sum),
    10,
    String(correct.column_销售数量_sum),
  );
  addCheck(
    result,
    "包含产品排名分析",
    products.filter((name) => report.includes(name)).length >= 3,
    15,
  );
  addCheck(
    result,
    "包含渠道分析",
    channels.some((channel) => report.includes(channel)),
    10,
  );
  addCheck(
    result,
    "包含月度分析",
    months.some((month) => report.includes(month)),
    5,
  );
  finalizeScore(result);
}

function evaluateTC04(result) {
  const outputs = result.outputFiles;
  const html = outputs["tokyo_trip.html"]?.content ?? "";
  const dayMatches = html.match(/第一天|第二天|第三天|第1天|第2天|第3天|Day 1|Day 2|Day 3/gi) ?? [];
  const animeMatches = html.match(/秋叶原|吉卜力|动漫|二次元|池袋|漫画|anime|akihabara/gi) ?? [];
  const lunchMatches = html.match(/午餐|lunch|餐厅|restaurant/gi) ?? [];
  const walkingMinutes = extractWalkingMinutes(html);

  addCheck(result, "tokyo_trip.html 存在", Boolean(outputs["tokyo_trip.html"]), 15);
  addCheck(result, "文件为合法 HTML", htmlLooksValid(html), 10);
  addCheck(result, "包含 3 天行程", dayMatches.length >= 3, 15, `匹配数=${dayMatches.length}`);
  addCheck(result, "包含动漫景点关键词", animeMatches.length >= 3, 20, `匹配数=${animeMatches.length}`);
  addCheck(result, "包含午餐信息", lunchMatches.length >= 3, 20, `匹配数=${lunchMatches.length}`);
  addCheck(
    result,
    "午餐距离满足步行 15 分钟内",
    walkingMinutes.length >= 3 && walkingMinutes.every((value) => value <= 15),
    10,
    `步行分钟=${walkingMinutes.join("/")}`,
  );
  addCheck(result, "无 Markdown 格式", !/^\s*#|\*\*/m.test(html), 5);
  addCheck(result, "使用了 HTML 表格", /<table/i.test(html), 5);
  finalizeScore(result);
}

function evaluateTCC(result) {
  const outputs = result.outputFiles;
  const debate = outputs["debate.md"]?.content ?? "";
  const totalLength = countCharLength(debate);
  const compactDebate = debate.replace(/\s+/g, "");
  const positiveIndex = compactDebate.indexOf("AI将取代程序员");
  const negativeIndex = compactDebate.indexOf("程序员不可取代");
  const hasSeparator = /(^|\n)\s*---\s*(\n|$)/m.test(debate);

  addCheck(result, "debate.md 存在", Boolean(outputs["debate.md"]), 10);
  addCheck(result, "包含总标题", /^#\s*AI 与程序员：正反方辩论/m.test(debate), 10);
  addCheck(result, "包含正方文章标题", positiveIndex >= 0, 15);
  addCheck(result, "包含反方文章标题", negativeIndex >= 0, 15);
  addCheck(
    result,
    "正方在前",
    positiveIndex >= 0 && negativeIndex >= 0 && positiveIndex < negativeIndex,
    20,
  );
  addCheck(
    result,
    "包含分隔线",
    hasSeparator,
    10,
  );
  addCheck(
    result,
    "两篇文章字数合理",
    totalLength >= 400 && totalLength <= 800,
    20,
    `总字符数=${totalLength}`,
  );
  finalizeScore(result);
}

function evaluateCase(result, testCase) {
  if (FIRST_REPLY_CASES.has(testCase.caseId)) {
    if (testCase.caseId === "TC-A") {
      evaluateTCA(result);
      return;
    }
    evaluateTCB(result);
    return;
  }

  if (testCase.caseId === "TC-01") {
    evaluateTC01(result);
  } else if (testCase.caseId === "TC-02") {
    evaluateTC02(result);
  } else if (testCase.caseId === "TC-03") {
    evaluateTC03(result, testCase);
  } else if (testCase.caseId === "TC-04") {
    evaluateTC04(result);
  } else if (testCase.caseId === "TC-C") {
    evaluateTCC(result);
  }
}

function expectedOutputFiles(caseId) {
  switch (caseId) {
    case "TC-01":
      return ["research_report.md", "crowdfunding_copy.md", "landing_page.html"];
    case "TC-02":
      return ["hello_color.py", "run_output.txt", "recovery_log.md"];
    case "TC-03":
      return ["analysis_report.md"];
    case "TC-04":
      return ["tokyo_trip.html"];
    case "TC-C":
      return ["debate.md"];
    default:
      return [];
  }
}

function buildSummary(results) {
  const lines = [
    "# Agent Dataset Browser Probe Summary",
    "",
    `- Base URL: ${results.baseUrl}`,
    `- Started: ${results.startedAt}`,
    `- Finished: ${results.finishedAt ?? ""}`,
    "",
    "| 用例 | 类型 | 得分 | 状态 | 线程 |",
    "|------|------|------|------|------|",
  ];

  for (const caseResult of results.cases) {
    const mode = FIRST_REPLY_CASES.has(caseResult.caseId) ? "首轮回复" : "完整执行";
    const status = caseResult.error ? "失败" : "完成";
    lines.push(
      `| ${caseResult.caseId} | ${mode} | ${caseResult.totalScore ?? 0} | ${status} | ${caseResult.threadId ?? ""} |`,
    );
  }

  lines.push("", "## 失败或低分用例", "");
  for (const caseResult of results.cases.filter((item) => item.error || (item.totalScore ?? 0) < 100)) {
    lines.push(`### ${caseResult.caseId}`);
    if (caseResult.error) {
      lines.push(`- 错误: ${caseResult.error}`);
    }
    for (const check of caseResult.checks ?? []) {
      if (!check.passed) {
        lines.push(`- 未通过: ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  await Promise.all([
    ensureDir(OUTPUT_ROOT),
    ensureDir(SCREENSHOT_ROOT),
    ensureDir(FILE_ROOT),
    ensureDir(PREPARED_UPLOAD_ROOT),
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
  };

  const results = {
    baseUrl: BASE_URL,
    startedAt: new Date().toISOString(),
    warnings: [],
    cases: [],
  };

  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      const warning = {
        type: message.type(),
        text: message.text(),
      };
      results.warnings.push(warning);
      log(`console:${warning.type}`, warning.text);
    }
  });

  page.on("pageerror", (error) => {
    const warning = {
      type: "pageerror",
      text: error?.stack || error?.message || String(error),
    };
    results.warnings.push(warning);
    log("pageerror", warning.text);
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

  const finishRunRequest = (request) => {
    if (!runMonitor.activeRequests.has(request)) {
      return;
    }
    runMonitor.activeRequests.delete(request);
    runMonitor.finishedCount += 1;
    log("stream:done", request.url());
  };

  page.on("requestfinished", finishRunRequest);
  page.on("requestfailed", finishRunRequest);

  try {
    await loginProbe(page);
    const auth = await readAuthState(page);
    if (!auth?.token) {
      throw new Error("Login succeeded but auth token is missing.");
    }
    results.authUser = auth.user;
    results.loginScreenshot = await captureProbe(page, "after-login");

    for (const caseId of CASE_ORDER) {
      const testCase = await loadCase(caseId);
      const caseResult = {
        caseId,
        mode: FIRST_REPLY_CASES.has(caseId) ? "first_reply" : "full_run",
        expectedFiles: expectedOutputFiles(caseId),
        checklistPath: path.join(DATASET_ROOT, caseId, "expected_output/evaluation_checklist.md"),
        checks: [],
        notes: [],
      };
      results.cases.push(caseResult);

      try {
        const { threadId, state, screenshot } = await runCase({
          page,
          auth,
          runMonitor,
          testCase,
        });
        caseResult.threadId = threadId;
        caseResult.screenshot = screenshot;
        caseResult.url = page.url();
        caseResult.messages = state?.values?.messages ?? [];
        caseResult.toolCalls = extractToolCalls(caseResult.messages).map((call) => call.name);
        caseResult.latestAssistantText = latestAssistantText(caseResult.messages);
        {
          const firstReply = firstAssistantReply(caseResult.messages);
          caseResult.firstAssistantText = firstReply.text;
          caseResult.firstQuestionPrompt = firstReply.questionPrompt;
          caseResult.firstQuestionOptions = firstReply.questionOptions;
        }
        caseResult.artifacts = state?.values?.artifacts ?? [];

        if (!FIRST_REPLY_CASES.has(caseId)) {
          await persistOutputFiles(
            auth,
            threadId,
            caseId,
            caseResult.expectedFiles,
            caseResult,
          );
        }

        evaluateCase(caseResult, testCase);
      } catch (error) {
        caseResult.error = error instanceof Error ? error.message : String(error);
        caseResult.failureScreenshot = await captureProbe(page, `${caseId}-failure`);
        caseResult.checks = caseResult.checks ?? [];
        caseResult.totalScore = caseResult.totalScore ?? 0;
        log("case:failed", `${caseId} ${caseResult.error}`);
      }

      await fs.writeFile(RESULTS_JSON, JSON.stringify(results, null, 2));
    }
  } finally {
    results.finishedAt = new Date().toISOString();
    await fs.writeFile(RESULTS_JSON, JSON.stringify(results, null, 2));
    await fs.writeFile(SUMMARY_MD, buildSummary(results));
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
