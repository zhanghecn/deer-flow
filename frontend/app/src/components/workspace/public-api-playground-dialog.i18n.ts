import type { Locale } from "@/core/i18n";

type PublicAPIPlaygroundText = {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
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
  requestTitle: string;
  requestDescription: string;
  streamLabel: string;
  reasoningLabel: string;
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
  removeFile: string;
  responseMode: string;
  plainText: string;
  jsonObject: string;
  jsonSchema: string;
  schemaName: string;
  schemaBody: string;
  maxOutputTokens: string;
  run: string;
  running: string;
  clear: string;
  traceTitle: string;
  traceDescription: string;
  liveOutput: string;
  noTrace: string;
  resultTitle: string;
  noResponse: string;
  outputTab: string;
  jsonTab: string;
  filesTab: string;
  docsTab: string;
  responseID: string;
  traceID: string;
  totalTokens: string;
  download: string;
  docsTitle: string;
  docsDescription: string;
  curlTab: string;
  openapiTab: string;
  postmanTab: string;
  responsesExample: string;
  chatExample: string;
  filesExample: string;
  modelsExample: string;
  copy: string;
  copied: string;
  downloadSpec: string;
  downloadCollection: string;
  missingKey: string;
  missingInput: string;
  invalidSchema: string;
  requestFailed: string;
  copyFailed: string;
  loadKeysFailed: string;
  keyCreateFailed: string;
  uploadStarted: (filename: string) => string;
  uploadFinished: (filename: string, fileID: string) => string;
  streamStarted: string;
  requestFinished: (responseID: string) => string;
  artifactReady: (filename: string) => string;
  runCompleted: string;
  assistantMessage: string;
  toolCall: string;
  toolResult: string;
  stateSnapshot: string;
  customEvent: string;
};

const enUS: PublicAPIPlaygroundText = {
  heroEyebrow: "OpenAI-Compatible Agent Surface",
  heroTitle: "Developer console for the published agent contract.",
  heroDescription:
    "Use the real `/v1` gateway surface with a user-scoped key, streaming traces, structured JSON, generated files, curl examples, OpenAPI JSON, and a Postman-ready collection.",
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
    "Paste the API key issued for this published agent. The page never creates or lists workspace tokens in public mode.",
  createScopedKey: "Create scoped key",
  creatingKey: "Creating key...",
  recentKeys: "Recent scoped keys",
  noRecentKeys: "No scoped keys have been created for this agent yet.",
  keyReadyTitle: "Scoped key created",
  keyReadyDescription:
    "The plaintext key is shown once and stays in the form so you can test immediately.",
  keyReadyCopy: "Copy key",
  keyReadyCopied: "Key copied",
  requestTitle: "Run setup",
  requestDescription:
    "This page drives the real `/v1/responses` endpoint so the trace matches the public contract.",
  streamLabel: "Use SSE stream",
  reasoningLabel: "Enable thinking",
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
  removeFile: "Remove file",
  responseMode: "Final output",
  plainText: "Plain text",
  jsonObject: "JSON object",
  jsonSchema: "JSON schema",
  schemaName: "Schema name",
  schemaBody: "Schema",
  maxOutputTokens: "Max output tokens",
  run: "Run published agent",
  running: "Running agent...",
  clear: "Clear trace",
  traceTitle: "Execution trace",
  traceDescription:
    "Uploads, tool calls, tool results, snapshots, files, and final completion all land here.",
  liveOutput: "Live output",
  noTrace: "No trace yet.",
  resultTitle: "Final response",
  noResponse: "Run a request to inspect the public response envelope.",
  outputTab: "Output",
  jsonTab: "Response JSON",
  filesTab: "Files",
  docsTab: "Docs",
  responseID: "Response",
  traceID: "Trace",
  totalTokens: "Tokens",
  download: "Download",
  docsTitle: "Developer docs",
  docsDescription:
    "Copy curl, inspect the OpenAPI JSON, or export a Postman collection from the same settings you are testing with.",
  curlTab: "cURL",
  openapiTab: "OpenAPI JSON",
  postmanTab: "Postman",
  responsesExample: "Responses",
  chatExample: "Chat Completions",
  filesExample: "Files",
  modelsExample: "Models",
  copy: "Copy",
  copied: "Copied",
  downloadSpec: "Download spec",
  downloadCollection: "Download collection",
  missingKey: "A user key is required.",
  missingInput: "Add a prompt or at least one file.",
  invalidSchema: "Schema must be valid JSON.",
  requestFailed: "Request failed",
  copyFailed: "Copy failed",
  loadKeysFailed: "Failed to load keys.",
  keyCreateFailed: "Failed to create scoped key.",
  uploadStarted: (filename) => `Uploading ${filename}`,
  uploadFinished: (filename, fileID) => `${filename} uploaded as ${fileID}`,
  streamStarted: "Streaming `/v1/responses`",
  requestFinished: (responseID) => `Response completed: ${responseID}`,
  artifactReady: (filename) => `Generated file: ${filename}`,
  runCompleted: "Run completed",
  assistantMessage: "Assistant message",
  toolCall: "Tool calls",
  toolResult: "Tool result",
  stateSnapshot: "State snapshot",
  customEvent: "Custom event",
};

const zhCN: PublicAPIPlaygroundText = {
  heroEyebrow: "OpenAI 兼容 Agent 出口",
  heroTitle: "已发布 agent 的开发者调试控制台。",
  heroDescription:
    "直接使用真实 `/v1` 网关能力测试 user-scoped key、流式事件、结构化 JSON、生成文件、curl、OpenAPI JSON 和 Postman collection。",
  credentialsTitle: "凭证配置",
  credentialsDescription:
    "控制台使用浏览器当前地址推导出来的网关地址，以及当前用户自己创建的 API key。",
  publicCredentialsDescription:
    "直接粘贴该已发布 agent 对应的 API key，就可以在这个页面里测试真实 `/v1` 契约。",
  baseURL: "Base URL",
  baseURLHint:
    "默认取当前浏览器来源地址并自动追加 `/v1`。外部接入方也可以直接使用这个地址。",
  userKey: "User Key",
  userKeyHint: "可以粘贴已有 key，也可以为当前已发布 agent 新建一个 scoped key。",
  publicUserKeyHint:
    "请粘贴该已发布 agent 对应的 API key。公开文档页不会创建或列出工作区 token。",
  createScopedKey: "创建 Scoped Key",
  creatingKey: "创建中...",
  recentKeys: "最近的 scoped key",
  noRecentKeys: "当前 agent 还没有创建过 scoped key。",
  keyReadyTitle: "Scoped key 已创建",
  keyReadyDescription: "明文 key 只展示一次，并会直接回填到表单里方便立刻测试。",
  keyReadyCopy: "复制 Key",
  keyReadyCopied: "Key 已复制",
  requestTitle: "运行配置",
  requestDescription:
    "这个页面直接调用真实 `/v1/responses`，所以你看到的过程与外部公共契约一致。",
  streamLabel: "使用 SSE 流式",
  reasoningLabel: "开启思考",
  reasoningEffort: "思考强度",
  previousResponse: "上一轮 response ID",
  previousResponseHint: "复用上一轮 response ID，可以继续同一个 public thread。",
  useLatestResponse: "使用上一轮响应",
  message: "提示词",
  messagePlaceholder: "可以要求报告、流程、转换，也可以要求严格返回 JSON。",
  files: "文件",
  filesHint: "文件会先通过 `/v1/files` 上传，再以 `input_file` block 形式附加到请求里。",
  addFiles: "添加文件",
  noFiles: "暂无待上传文件。",
  removeFile: "移除文件",
  responseMode: "最终输出",
  plainText: "纯文本",
  jsonObject: "JSON 对象",
  jsonSchema: "JSON Schema",
  schemaName: "Schema 名称",
  schemaBody: "Schema",
  maxOutputTokens: "最大输出 Tokens",
  run: "运行已发布 Agent",
  running: "运行中...",
  clear: "清空轨迹",
  traceTitle: "执行轨迹",
  traceDescription: "上传、工具调用、工具结果、状态快照、生成文件和最终完成都会显示在这里。",
  liveOutput: "实时输出",
  noTrace: "还没有轨迹。",
  resultTitle: "最终响应",
  noResponse: "执行一次请求后，这里会展示最终 public response。",
  outputTab: "输出",
  jsonTab: "响应 JSON",
  filesTab: "文件",
  docsTab: "文档",
  responseID: "响应",
  traceID: "Trace",
  totalTokens: "Tokens",
  download: "下载",
  docsTitle: "开发者文档",
  docsDescription: "可以直接复制 curl、查看 OpenAPI JSON，或者导出 Postman collection。",
  curlTab: "cURL",
  openapiTab: "OpenAPI JSON",
  postmanTab: "Postman",
  responsesExample: "Responses",
  chatExample: "Chat Completions",
  filesExample: "Files",
  modelsExample: "Models",
  copy: "复制",
  copied: "已复制",
  downloadSpec: "下载 Spec",
  downloadCollection: "下载 Collection",
  missingKey: "必须先提供 user key。",
  missingInput: "至少填写提示词或添加一个文件。",
  invalidSchema: "Schema 必须是合法 JSON。",
  requestFailed: "请求失败",
  copyFailed: "复制失败",
  loadKeysFailed: "加载 key 失败。",
  keyCreateFailed: "创建 scoped key 失败。",
  uploadStarted: (filename) => `正在上传 ${filename}`,
  uploadFinished: (filename, fileID) => `${filename} 已上传，file_id=${fileID}`,
  streamStarted: "正在流式调用 `/v1/responses`",
  requestFinished: (responseID) => `响应完成：${responseID}`,
  artifactReady: (filename) => `生成文件：${filename}`,
  runCompleted: "运行完成",
  assistantMessage: "助手消息",
  toolCall: "工具调用",
  toolResult: "工具结果",
  stateSnapshot: "状态快照",
  customEvent: "自定义事件",
};

export function getPublicAPIPlaygroundText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
