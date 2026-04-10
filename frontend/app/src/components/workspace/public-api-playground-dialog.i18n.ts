import type { Locale } from "@/core/i18n";

type PublicAPIPlaygroundText = {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  agentLabel: string;
  activeMode: string;
  identityEyebrow: string;
  credentialsTitle: string;
  credentialsDescription: string;
  publicCredentialsDescription: string;
  baseURL: string;
  baseURLHint: string;
  userKey: string;
  userKeyHint: string;
  publicUserKeyHint: string;
  createScopedKey: string;
  creatingKey: string;
  recentKeys: string;
  noRecentKeys: string;
  keyReadyTitle: string;
  keyReadyDescription: string;
  keyReadyCopy: string;
  keyReadyCopied: string;
  runEyebrow: string;
  requestTitle: string;
  requestDescription: string;
  streamLabel: string;
  streamDescription: string;
  reasoningLabel: string;
  reasoningDescription: string;
  reasoningEffort: string;
  previousResponse: string;
  previousResponseHint: string;
  useLatestResponse: string;
  message: string;
  messagePlaceholder: string;
  files: string;
  filesHint: string;
  addFiles: string;
  noFiles: string;
  responseMode: string;
  responseModeHint: string;
  customSchemaHint: string;
  plainText: string;
  jsonObject: string;
  jsonSchema: string;
  schemaName: string;
  schemaBody: string;
  maxOutputTokens: string;
  advancedTitle: string;
  advancedDescription: string;
  run: string;
  running: string;
  clear: string;
  traceEyebrow: string;
  traceTitle: string;
  traceDescription: string;
  liveOutput: string;
  noTrace: string;
  noFilteredTrace: string;
  resultEyebrow: string;
  resultTitle: string;
  resultDescription: string;
  noResponse: string;
  outputTab: string;
  jsonTab: string;
  filesTab: string;
  responseID: string;
  traceID: string;
  finalStatus: string;
  totalTokens: string;
  statusRunning: string;
  statusIdle: string;
  download: string;
  copy: string;
  copied: string;
  missingKey: string;
  missingInput: string;
  invalidSchema: string;
  requestFailed: string;
  copyFailed: string;
  loadKeysFailed: string;
  keyCreateFailed: string;
  uploadStarted: (filename: string) => string;
  uploadFinished: (filename: string, fileID: string) => string;
  requestPrepared: string;
  streamStarted: string;
  requestFinished: (responseID: string) => string;
  artifactReady: (filename: string) => string;
  runCompleted: string;
  assistantMessage: string;
  toolCall: string;
  toolResult: string;
  stateSnapshot: string;
  customEvent: string;
  filterAll: string;
  filterSystem: string;
  filterAssistant: string;
  filterTool: string;
  filterArtifact: string;
  filterError: string;
  stagePrepare: string;
  stageUpload: string;
  stageRun: string;
  stageAssistant: string;
  stageArtifact: string;
  stageComplete: string;
  stageError: string;
  rawPayload: string;
  openReference: string;
  blockingReplayTitle: string;
  blockingReplayDescription: string;
  sseMode: string;
  blockingMode: string;
};

const enUS: PublicAPIPlaygroundText = {
  heroEyebrow: "Published Agent Trace Console",
  heroTitle: "Run the public contract and watch the agent behave in real time.",
  heroDescription:
    "This page is a runtime console, not a second docs hub. Use it to send real `/v1` requests, inspect grouped events, and download generated artifacts.",
  agentLabel: "Agent",
  activeMode: "Current mode",
  identityEyebrow: "Identity",
  credentialsTitle: "Credentials",
  credentialsDescription:
    "The console uses the browser-resolved gateway address and a user-owned API key.",
  publicCredentialsDescription:
    "Bring your own API key from the agent owner and test the real `/v1` contract directly from this page.",
  baseURL: "Base URL",
  baseURLHint:
    "Defaults to the current browser origin and appends `/v1`. External integrators can use the same address directly.",
  userKey: "User Key",
  userKeyHint:
    "Paste an existing key or mint a new key scoped to this published agent.",
  publicUserKeyHint:
    "Paste the API key issued for this published agent. The public page never creates or lists workspace tokens.",
  createScopedKey: "Create scoped key",
  creatingKey: "Creating key...",
  recentKeys: "Recent scoped keys",
  noRecentKeys: "No scoped keys have been created for this agent yet.",
  keyReadyTitle: "Scoped key created",
  keyReadyDescription:
    "The plaintext key is shown once and stays in the form so you can test immediately.",
  keyReadyCopy: "Copy key",
  keyReadyCopied: "Key copied",
  runEyebrow: "Request",
  requestTitle: "Compose a run",
  requestDescription:
    "Keep the first screen focused on the inputs you need most often. Advanced controls stay collapsed until you need them.",
  streamLabel: "Use SSE stream",
  streamDescription:
    "Turn this off when you only need the completed envelope and a replay of the final run timeline.",
  reasoningLabel: "Enable thinking",
  reasoningDescription:
    "Thinking stays opt-in at the control level. The runtime still exposes the resulting events and files.",
  reasoningEffort: "Reasoning effort",
  previousResponse: "Previous response ID",
  previousResponseHint:
    "Reuse the last response ID to continue the same public conversation thread.",
  useLatestResponse: "Use latest response",
  message: "Prompt",
  messagePlaceholder:
    "Ask for a report, workflow, transformation, or strict JSON result.",
  files: "Files",
  filesHint:
    "Files upload to `/v1/files` first and are then attached as `input_file` blocks.",
  addFiles: "Add files",
  noFiles: "No files queued.",
  responseMode: "Final output",
  responseModeHint:
    "Choose text for a normal answer or switch to JSON when the caller needs a structured final result.",
  customSchemaHint:
    "Custom schemas live in Advanced controls so the default composer stays compact.",
  plainText: "Plain text",
  jsonObject: "JSON object",
  jsonSchema: "JSON schema",
  schemaName: "Schema name",
  schemaBody: "Schema body",
  maxOutputTokens: "Max output tokens",
  advancedTitle: "Advanced controls",
  advancedDescription:
    "Reasoning, follow-up turns, token limits, and custom schema settings.",
  run: "Run published agent",
  running: "Running agent...",
  clear: "Clear console",
  traceEyebrow: "Trace",
  traceTitle: "Grouped runtime timeline",
  traceDescription:
    "The console groups preparation, uploads, runtime activity, assistant messages, artifacts, and completion into one readable timeline.",
  liveOutput: "Current output",
  noTrace: "No run has been sent yet.",
  noFilteredTrace: "No events match the current filter.",
  resultEyebrow: "Result",
  resultTitle: "Final response",
  resultDescription:
    "Inspect the final text, the raw response envelope, and any files produced by the published agent.",
  noResponse: "Run a request to inspect the public response envelope.",
  outputTab: "Output",
  jsonTab: "Response JSON",
  filesTab: "Files",
  responseID: "Response",
  traceID: "Trace",
  finalStatus: "Status",
  totalTokens: "Tokens",
  statusRunning: "running",
  statusIdle: "idle",
  download: "Download",
  copy: "Copy",
  copied: "Copied",
  missingKey: "A user key is required.",
  missingInput: "Add a prompt or at least one file.",
  invalidSchema: "Schema must be valid JSON.",
  requestFailed: "Request failed",
  copyFailed: "Copy failed",
  loadKeysFailed: "Failed to load keys.",
  keyCreateFailed: "Failed to create scoped key.",
  uploadStarted: (filename) => `Uploading ${filename}`,
  uploadFinished: (filename, fileID) => `${filename} uploaded as ${fileID}`,
  requestPrepared: "Request prepared",
  streamStarted: "Streaming `/v1/responses`",
  requestFinished: (responseID) => `Response completed: ${responseID}`,
  artifactReady: (filename) => `Generated file: ${filename}`,
  runCompleted: "Run completed",
  assistantMessage: "Assistant message",
  toolCall: "Tool calls",
  toolResult: "Tool result",
  stateSnapshot: "State snapshot",
  customEvent: "Custom event",
  filterAll: "All",
  filterSystem: "System",
  filterAssistant: "Assistant",
  filterTool: "Tools",
  filterArtifact: "Files",
  filterError: "Errors",
  stagePrepare: "Prepared",
  stageUpload: "Uploads",
  stageRun: "Runtime",
  stageAssistant: "Assistant",
  stageArtifact: "Artifacts",
  stageComplete: "Completed",
  stageError: "Failed",
  rawPayload: "Raw payload",
  openReference: "Developer console",
  blockingReplayTitle: "Blocking run replay",
  blockingReplayDescription:
    "This was a blocking request. The timeline below is a replay of the completed run ledger rather than a live SSE stream.",
  sseMode: "SSE stream",
  blockingMode: "Blocking",
};

const zhCN: PublicAPIPlaygroundText = {
  heroEyebrow: "已发布 Agent Trace 控制台",
  heroTitle: "直接运行公开契约，并实时观察 agent 的执行过程。",
  heroDescription:
    "这个页面是运行态调试台，不再兼任第二个文档中心。它只负责真实 `/v1` 调用、事件分组观察和生成文件下载。",
  agentLabel: "Agent",
  activeMode: "当前模式",
  identityEyebrow: "身份",
  credentialsTitle: "凭证配置",
  credentialsDescription:
    "控制台使用浏览器当前地址推导出来的网关地址，以及当前用户自己创建的 API key。",
  publicCredentialsDescription:
    "直接粘贴该已发布 agent 对应的 API key，就可以在这个页面里测试真实 `/v1` 契约。",
  baseURL: "Base URL",
  baseURLHint:
    "默认取当前浏览器来源地址并自动追加 `/v1`。外部接入方也可以直接使用这个地址。",
  userKey: "User Key",
  userKeyHint:
    "可以粘贴已有 key，也可以为当前已发布 agent 新建一个 scoped key。",
  publicUserKeyHint:
    "请粘贴该已发布 agent 对应的 API key。公开页面不会创建或列出工作区 token。",
  createScopedKey: "创建 Scoped Key",
  creatingKey: "创建中...",
  recentKeys: "最近的 Scoped Key",
  noRecentKeys: "当前 agent 还没有创建过 scoped key。",
  keyReadyTitle: "Scoped key 已创建",
  keyReadyDescription:
    "明文 key 只展示一次，并会直接回填到表单里方便立刻测试。",
  keyReadyCopy: "复制 Key",
  keyReadyCopied: "Key 已复制",
  runEyebrow: "请求",
  requestTitle: "配置一次运行",
  requestDescription:
    "首屏只保留最常用输入项，高级参数折叠起来，避免第一次调试就被大量选项淹没。",
  streamLabel: "使用 SSE 流式",
  streamDescription:
    "关闭后将返回完整最终 envelope，并在下方回放本次运行的事件时间线。",
  reasoningLabel: "开启思考",
  reasoningDescription:
    "思考能力仍然是显式选项，但最终产生的事件和文件会继续完整暴露。",
  reasoningEffort: "思考强度",
  previousResponse: "上一轮 response ID",
  previousResponseHint:
    "复用上一轮 response ID，可以继续同一个 public thread。",
  useLatestResponse: "使用上一轮响应",
  message: "提示词",
  messagePlaceholder: "可以要求报告、流程、转换，也可以要求严格返回 JSON。",
  files: "文件",
  filesHint:
    "文件会先通过 `/v1/files` 上传，再以 `input_file` block 形式附加到请求里。",
  addFiles: "添加文件",
  noFiles: "暂无待上传文件。",
  responseMode: "最终输出",
  responseModeHint:
    "普通回答用文本；如果你的调用方需要结构化最终结果，就切换到 JSON。",
  customSchemaHint:
    "自定义 schema 放在高级控制区里，默认编排区只保留最必要字段。",
  plainText: "纯文本",
  jsonObject: "JSON 对象",
  jsonSchema: "JSON Schema",
  schemaName: "Schema 名称",
  schemaBody: "Schema 内容",
  maxOutputTokens: "最大输出 Tokens",
  advancedTitle: "高级控制",
  advancedDescription: "思考、follow-up、输出 token 限制，以及自定义 schema。",
  run: "运行已发布 Agent",
  running: "运行中...",
  clear: "清空控制台",
  traceEyebrow: "Trace",
  traceTitle: "分组后的运行时间线",
  traceDescription:
    "请求准备、文件上传、运行时活动、助手消息、生成文件和完成状态都会按阶段汇总在一条时间线上。",
  liveOutput: "当前输出",
  noTrace: "还没有发出任何请求。",
  noFilteredTrace: "当前筛选条件下没有事件。",
  resultEyebrow: "结果",
  resultTitle: "最终响应",
  resultDescription:
    "这里集中查看最终文本、原始响应 envelope，以及运行期间生成的文件。",
  noResponse: "执行一次请求后，这里会展示最终 public response。",
  outputTab: "输出",
  jsonTab: "响应 JSON",
  filesTab: "文件",
  responseID: "响应",
  traceID: "Trace",
  finalStatus: "状态",
  totalTokens: "Tokens",
  statusRunning: "运行中",
  statusIdle: "空闲",
  download: "下载",
  copy: "复制",
  copied: "已复制",
  missingKey: "必须先提供 user key。",
  missingInput: "至少填写提示词或添加一个文件。",
  invalidSchema: "Schema 必须是合法 JSON。",
  requestFailed: "请求失败",
  copyFailed: "复制失败",
  loadKeysFailed: "加载 key 失败。",
  keyCreateFailed: "创建 scoped key 失败。",
  uploadStarted: (filename) => `正在上传 ${filename}`,
  uploadFinished: (filename, fileID) => `${filename} 已上传，file_id=${fileID}`,
  requestPrepared: "请求已准备",
  streamStarted: "正在流式调用 `/v1/responses`",
  requestFinished: (responseID) => `响应完成：${responseID}`,
  artifactReady: (filename) => `生成文件：${filename}`,
  runCompleted: "运行完成",
  assistantMessage: "助手消息",
  toolCall: "工具调用",
  toolResult: "工具结果",
  stateSnapshot: "状态快照",
  customEvent: "自定义事件",
  filterAll: "全部",
  filterSystem: "系统",
  filterAssistant: "助手",
  filterTool: "工具",
  filterArtifact: "文件",
  filterError: "错误",
  stagePrepare: "准备",
  stageUpload: "上传",
  stageRun: "运行",
  stageAssistant: "助手",
  stageArtifact: "产物",
  stageComplete: "完成",
  stageError: "失败",
  rawPayload: "原始 Payload",
  openReference: "开发者控制台",
  blockingReplayTitle: "Blocking 运行回放",
  blockingReplayDescription:
    "这次调用不是实时 SSE，而是基于已完成运行的事件账本做回放展示。",
  sseMode: "SSE 流式",
  blockingMode: "Blocking",
};

export function getPublicAPIPlaygroundText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
