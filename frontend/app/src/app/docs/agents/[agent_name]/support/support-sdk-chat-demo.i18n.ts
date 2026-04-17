import type { Locale } from "@/core/i18n";

type SupportPrompt = {
  id: string;
  label: string;
  prompt: string;
};

export type SupportHTTPChatDemoText = {
  connectionTitle: string;
  connectionDescription: string;
  baseURLLabel: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  baseURLPlaceholder: string;
  apiKeyHint: string;
  sessionTitle: string;
  agentLabel: string;
  responseIdLabel: string;
  previousResponseIdLabel: string;
  statusLabel: string;
  statusReady: string;
  statusStreaming: string;
  statusFailed: string;
  statusWaiting: string;
  toolsLabel: string;
  reasoningLabel: string;
  reasoningEffortLabel: string;
  reasoningHint: string;
  reasoningSummaryLabel: string;
  reasoningSummaryEmpty: string;
  newSession: string;
  promptsTitle: string;
  promptsDescription: string;
  usePrompt: string;
  securityTitle: string;
  securityDescription: string;
  chatTitle: string;
  chatEmptyTitle: string;
  chatEmptyDescription: string;
  sdkLabel: string;
  userLabel: string;
  assistantLabel: string;
  assistantReplyTitle: string;
  turnStartedTitle: string;
  turnFailedTitle: string;
  toolStartedTitle: string;
  toolFinishedTitle: string;
  toolMethodLabel: string;
  toolArgumentsLabel: string;
  toolOutputLabel: string;
  activityTitle: string;
  activityEmpty: string;
  stepsTitle: string;
  stepsEmpty: string;
  responseMetaLabel: string;
  toolCallsMetaLabel: string;
  composerLabel: string;
  composerPlaceholder: string;
  send: string;
  sending: string;
  stop: string;
  missingToken: string;
  missingPrompt: string;
  requestFailed: string;
  runCompleted: string;
  responseWaiting: string;
  prompts: SupportPrompt[];
};

const enUS: SupportHTTPChatDemoText = {
  connectionTitle: "Connection",
  connectionDescription:
    "Paste the published base URL and a scoped user key. This page keeps the key in memory only.",
  baseURLLabel: "Base URL",
  apiKeyLabel: "User key",
  apiKeyPlaceholder: "df_live_xxx",
  baseURLPlaceholder: "https://gateway.example.com/v1",
  apiKeyHint:
    "Use a key bound to this published agent. For production customer sites, proxy requests from your server instead of exposing the key in the browser.",
  sessionTitle: "Session",
  agentLabel: "Agent",
  responseIdLabel: "Last turn",
  previousResponseIdLabel: "Previous turn",
  statusLabel: "Run state",
  statusReady: "Ready",
  statusStreaming: "Streaming",
  statusFailed: "Failed",
  statusWaiting: "Waiting for input",
  toolsLabel: "Tool calls",
  reasoningLabel: "Enable thinking",
  reasoningEffortLabel: "Reasoning effort",
  reasoningHint:
    "The native turns contract streams reasoning text while the run is active.",
  reasoningSummaryLabel: "Reasoning text",
  reasoningSummaryEmpty: "Reasoning text appears here when the run emits it.",
  newSession: "New session",
  promptsTitle: "Starter prompts",
  promptsDescription:
    "These prompts match the real customer-case acceptance flow and help verify the MCP-backed file operations quickly.",
  usePrompt: "Use prompt",
  securityTitle: "Why this console exists",
  securityDescription:
    "It validates browser-side HTTP integration against the published contract. It is for testing and demos, not for shipping a public site with an exposed key.",
  chatTitle: "Debug console",
  chatEmptyTitle: "No messages yet",
  chatEmptyDescription:
    "Choose one of the starter prompts or write your own question about the private case library.",
  sdkLabel: "Native HTTP -> OpenAgents /v1/turns",
  userLabel: "User",
  assistantLabel: "Assistant",
  assistantReplyTitle: "Assistant reply",
  turnStartedTitle: "Turn started",
  turnFailedTitle: "Turn failed",
  toolStartedTitle: "Tool started",
  toolFinishedTitle: "Tool finished",
  toolMethodLabel: "Method",
  toolArgumentsLabel: "Arguments",
  toolOutputLabel: "Output",
  activityTitle: "Current run timeline",
  activityEmpty:
    "Tool calls and terminal events for the latest run appear here while the turn is streaming.",
  stepsTitle: "Run steps",
  stepsEmpty: "Run steps appear here as the turn streams.",
  responseMetaLabel: "Turn",
  toolCallsMetaLabel: "Tool calls",
  composerLabel: "Run the published agent",
  composerPlaceholder:
    "Ask about file names, read a page, filter with glob, or search with grep.",
  send: "Send",
  sending: "Running",
  stop: "Stop",
  missingToken: "Paste a user key before sending a request.",
  missingPrompt: "Enter a question before sending a request.",
  requestFailed: "Request failed",
  runCompleted: "Run completed",
  responseWaiting: "Response is waiting for user input.",
  prompts: [
    {
      id: "list-files",
      label: "List files",
      prompt: "案例库里有哪些文件？请直接列出文件名，不要编造。",
    },
    {
      id: "read-page",
      label: "Read first page",
      prompt: "请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。",
    },
    {
      id: "glob",
      label: "Filter Final_ files",
      prompt: "请只列出文件名以 Final_ 开头的案例文件。",
    },
    {
      id: "grep",
      label: "Search 夏仲奇",
      prompt: "请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。",
    },
  ],
};

const zhCN: SupportHTTPChatDemoText = {
  connectionTitle: "连接信息",
  connectionDescription:
    "填入已发布智能体的 Base URL 和作用域用户 Key。这个页面只在内存里保存 Key。",
  baseURLLabel: "Base URL",
  apiKeyLabel: "用户 Key",
  apiKeyPlaceholder: "df_live_xxx",
  baseURLPlaceholder: "https://gateway.example.com/v1",
  apiKeyHint:
    "请使用绑定到当前已发布智能体的 Key。真正上线到客户站点时，应该由客户服务端代理请求，而不是把 Key 直接暴露在浏览器里。",
  sessionTitle: "会话状态",
  agentLabel: "Agent",
  responseIdLabel: "最近 Turn",
  previousResponseIdLabel: "上一个 Turn",
  statusLabel: "运行状态",
  statusReady: "就绪",
  statusStreaming: "流式输出中",
  statusFailed: "失败",
  statusWaiting: "等待用户输入",
  toolsLabel: "工具调用数",
  reasoningLabel: "开启思考",
  reasoningEffortLabel: "思考强度",
  reasoningHint: "开启后，会在 turn 流式执行期间持续显示思考文本。",
  reasoningSummaryLabel: "思考内容",
  reasoningSummaryEmpty: "当 turn 输出思考文本时，会在这里持续累积显示。",
  newSession: "新会话",
  promptsTitle: "起手问题",
  promptsDescription:
    "这些问题直接对应真实客户案例验收流程，可以快速验证 MCP 支撑的文件操作能力。",
  usePrompt: "使用这个问题",
  securityTitle: "这个调试台的用途",
  securityDescription:
    "它用来验证浏览器侧 HTTP 接入与已发布契约的兼容性，并观察真实运行步骤。适合验收和调试，不适合把带密钥的调用直接公开上线。",
  chatTitle: "调试台",
  chatEmptyTitle: "还没有消息",
  chatEmptyDescription: "从左侧选择一个起手问题，或者直接输入你自己的案例库问题。",
  sdkLabel: "Native HTTP -> OpenAgents /v1/turns",
  userLabel: "用户",
  assistantLabel: "助手",
  assistantReplyTitle: "助手回复",
  turnStartedTitle: "Turn 开始",
  turnFailedTitle: "Turn 失败",
  toolStartedTitle: "工具开始",
  toolFinishedTitle: "工具结束",
  toolMethodLabel: "方法",
  toolArgumentsLabel: "参数",
  toolOutputLabel: "返回",
  activityTitle: "当前运行时间线",
  activityEmpty: "turn 流式执行期间，这里会实时展示最近一次运行的工具调用与结束事件。",
  stepsTitle: "运行步骤",
  stepsEmpty: "这条回复流式输出时，会在这里持续显示对应的运行步骤。",
  responseMetaLabel: "Turn",
  toolCallsMetaLabel: "工具调用",
  composerLabel: "直接运行已发布 Agent",
  composerPlaceholder: "你可以问文件列表、分页读文件、glob 过滤或 grep 搜索。",
  send: "发送",
  sending: "执行中",
  stop: "停止",
  missingToken: "发送前请先填入用户 Key。",
  missingPrompt: "发送前请先输入问题。",
  requestFailed: "请求失败",
  runCompleted: "运行完成",
  responseWaiting: "响应正在等待用户输入。",
  prompts: [
    {
      id: "list-files",
      label: "列出文件",
      prompt: "案例库里有哪些文件？请直接列出文件名，不要编造。",
    },
    {
      id: "read-page",
      label: "读取第一页",
      prompt: "请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。",
    },
    {
      id: "glob",
      label: "筛选 Final_ 文件",
      prompt: "请只列出文件名以 Final_ 开头的案例文件。",
    },
    {
      id: "grep",
      label: "搜索 夏仲奇",
      prompt: "请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。",
    },
  ],
};

export function getSupportHTTPChatDemoText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
