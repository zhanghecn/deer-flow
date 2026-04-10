import type { Locale } from "@/core/i18n";

type AgentPublicDocsPageText = {
  eyebrow: string;
  heroTitle: string;
  heroDescription: string;
  baseURL: string;
  modelName: string;
  apiKeyLabel: string;
  navQuickstart: string;
  navConsole: string;
  navContract: string;
  navSchema: string;
  workflowEyebrow: string;
  workflowTitle: string;
  workflowStepBaseURL: string;
  workflowStepModel: string;
  workflowStepMode: string;
  snippetEyebrow: string;
  snippetTitle: string;
  snippetDescription: string;
  jsTab: string;
  pythonTab: string;
  curlTab: string;
  copy: string;
  copied: string;
  consoleEyebrow: string;
  consoleTitle: string;
  consoleDescription: string;
  contractEyebrow: string;
  contractTitle: string;
  contractDescription: string;
  versionLabel: string;
  routesLabel: string;
  modesLabel: string;
  modesValue: string;
  authTitle: string;
  authDescription: string;
  authHeaderLabel: string;
  authValueLabel: string;
  authScopeLabel: string;
  authHeaderValue: string;
  authValueExample: string;
  authScopeValue: string;
  endpointsTitle: string;
  endpointsDescription: string;
  openInSchema: string;
  schemaEyebrow: string;
  schemaTitle: string;
  schemaDescription: string;
  openSchema: string;
  hideSchema: string;
  rawOpenAPI: string;
  rawExport: string;
  loadingSchema: string;
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
  openHome: string;
};

const enUS: AgentPublicDocsPageText = {
  eyebrow: "Developer Console",
  heroTitle: "One surface for docs, testing, and contract inspection.",
  heroDescription:
    "External callers only need `base_url`, `api_key`, and `model=<agent_name>`. This console keeps quickstart snippets, live `/v1` calls, files, events, and schema browsing in one place.",
  baseURL: "Base URL",
  modelName: "Model",
  apiKeyLabel: "API Key",
  navQuickstart: "Quickstart",
  navConsole: "Live console",
  navContract: "Contract",
  navSchema: "Schema",
  workflowEyebrow: "Ship the first call",
  workflowTitle: "Use the published agent like a normal OpenAI-compatible product surface.",
  workflowStepBaseURL:
    "Point your client at the published `/v1` base URL, not the private provider endpoint.",
  workflowStepModel:
    "Set `model=<agent_name>` so the caller targets the published contract rather than the underlying model.",
  workflowStepMode:
    "Pick blocking or SSE based on UX. The same surface also supports files and strict JSON output.",
  snippetEyebrow: "SDK snippet",
  snippetTitle: "Start with one successful request",
  snippetDescription:
    "Use the standard OpenAI client first. After that works, move on to streaming, files, and structured output.",
  jsTab: "JavaScript",
  pythonTab: "Python",
  curlTab: "cURL",
  copy: "Copy",
  copied: "Copied",
  consoleEyebrow: "Live console",
  consoleTitle: "Run the real public contract",
  consoleDescription:
    "Compose a request, switch between blocking and SSE, upload files, inspect runtime events, and download generated artifacts without leaving the page.",
  contractEyebrow: "Contract map",
  contractTitle: "Authentication and route summary",
  contractDescription:
    "Scan the public surface first. Open the schema browser only when you need request or response fields.",
  versionLabel: "Version",
  routesLabel: "Routes",
  modesLabel: "Modes",
  modesValue: "Blocking / SSE / Files / JSON",
  authTitle: "Bearer authentication",
  authDescription:
    "Every northbound request uses a published-agent API key created by the platform. Contact the agent owner when you need a scoped key for this console.",
  authHeaderLabel: "Header",
  authValueLabel: "Value",
  authScopeLabel: "Scope",
  authHeaderValue: "Authorization",
  authValueExample: "Bearer <user_created_key>",
  authScopeValue:
    "Applies to `/v1/models`, `/v1/responses`, `/v1/chat/completions`, and `/v1/files`.",
  endpointsTitle: "Public routes",
  endpointsDescription:
    "These operations are the only public northbound surface external developers should integrate against.",
  openInSchema: "Open in schema",
  schemaEyebrow: "Schema browser",
  schemaTitle: "Browse the full OpenAPI contract on demand",
  schemaDescription:
    "The detailed request and response schema stays on the same page, but remains collapsed until someone actually needs field-level detail.",
  openSchema: "Open schema browser",
  hideSchema: "Hide schema browser",
  rawOpenAPI: "Raw OpenAPI",
  rawExport: "Export JSON",
  loadingSchema: "Loading OpenAPI schema...",
  loadingTitle: "Loading developer console",
  loadingDescription:
    "Preparing the published agent console and live contract metadata.",
  loadFailedTitle: "Developer console unavailable",
  loadFailedDescription:
    "The published agent export document could not be loaded.",
  openHome: "Open workspace",
};

const zhCN: AgentPublicDocsPageText = {
  eyebrow: "开发者控制台",
  heroTitle: "文档、调试与契约检查统一在一个页面里。",
  heroDescription:
    "外部调用方只需要 `base_url`、`api_key` 和 `model=<agent_name>`。这个页面把 quickstart、真实 `/v1` 调用、文件、事件和 schema 浏览统一收进一个 developer console。",
  baseURL: "Base URL",
  modelName: "Model",
  apiKeyLabel: "API Key",
  navQuickstart: "快速接入",
  navConsole: "实时控制台",
  navContract: "契约",
  navSchema: "Schema",
  workflowEyebrow: "第一次接通",
  workflowTitle: "把已发布 agent 当成标准 OpenAI-compatible 产品面来接入。",
  workflowStepBaseURL:
    "客户端应指向公开 `/v1` base URL，而不是底层私有 provider 地址。",
  workflowStepModel:
    "设置 `model=<agent_name>`，让调用命中已发布契约，而不是底层模型。",
  workflowStepMode:
    "根据体验选择 blocking 或 SSE。同一接口面同时支持文件和严格 JSON 输出。",
  snippetEyebrow: "SDK 示例",
  snippetTitle: "先跑通第一条成功请求",
  snippetDescription:
    "先用标准 OpenAI 客户端接通。确认成功后，再继续接入流式、文件和结构化输出。",
  jsTab: "JavaScript",
  pythonTab: "Python",
  curlTab: "cURL",
  copy: "复制",
  copied: "已复制",
  consoleEyebrow: "实时控制台",
  consoleTitle: "直接运行公开契约",
  consoleDescription:
    "在同一页里组织请求、切换 blocking 和 SSE、上传文件、观察运行事件，并下载生成产物。",
  contractEyebrow: "契约地图",
  contractTitle: "认证方式与路由总览",
  contractDescription:
    "先看公开接口面，再在确实需要字段级细节时打开 schema 浏览器。",
  versionLabel: "版本",
  routesLabel: "路由数",
  modesLabel: "支持模式",
  modesValue: "Blocking / SSE / Files / JSON",
  authTitle: "Bearer 鉴权",
  authDescription:
    "所有北向请求都使用平台创建的已发布 agent API Key。若需要这个控制台可用的 scoped key，请联系 agent 拥有者。",
  authHeaderLabel: "Header",
  authValueLabel: "取值",
  authScopeLabel: "范围",
  authHeaderValue: "Authorization",
  authValueExample: "Bearer <user_created_key>",
  authScopeValue:
    "适用于 `/v1/models`、`/v1/responses`、`/v1/chat/completions` 和 `/v1/files`。",
  endpointsTitle: "公开路由",
  endpointsDescription:
    "这些操作就是外部开发者应该集成的唯一北向公共接口面。",
  openInSchema: "打开 Schema",
  schemaEyebrow: "Schema 浏览器",
  schemaTitle: "按需查看完整 OpenAPI 契约",
  schemaDescription:
    "字段级 request / response schema 仍在同一页中，但默认折叠，只有真正需要时再展开。",
  openSchema: "打开 Schema 浏览器",
  hideSchema: "收起 Schema 浏览器",
  rawOpenAPI: "原始 OpenAPI",
  rawExport: "导出 JSON",
  loadingSchema: "正在加载 OpenAPI Schema...",
  loadingTitle: "正在加载开发者控制台",
  loadingDescription: "正在准备已发布 agent 的控制台和实时契约元数据。",
  loadFailedTitle: "开发者控制台暂不可用",
  loadFailedDescription: "当前无法加载这个已发布 agent 的导出文档。",
  openHome: "打开工作台",
};

export function getAgentPublicDocsPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
