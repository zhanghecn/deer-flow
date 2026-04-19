import type { Locale } from "@/core/i18n";

type AgentPublicDocsPageText = {
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
  referenceFailedTitle: string;
  referenceFailedDescription: string;
  openHome: string;
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  heroFactOneLabel: string;
  heroFactOneValue: string;
  heroFactTwoLabel: string;
  heroFactTwoValue: string;
  heroFactThreeLabel: string;
  heroFactThreeValue: string;
  connectionEyebrow: string;
  baseURL: string;
  baseURLNoteTitle: string;
  baseURLNote: string;
  modelName: string;
  apiKeyLabel: string;
  apiKeyExample: string;
  modesLabel: string;
  modesValue: string;
  quickstartEyebrow: string;
  quickstartTitle: string;
  quickstartDescription: string;
  jsTab: string;
  pythonTab: string;
  curlTab: string;
  copy: string;
  copied: string;
  routesEyebrow: string;
  routesTitle: string;
  routesDescription: string;
  routeMethodColumn: string;
  routePathColumn: string;
  routeSummaryColumn: string;
  routeDocsColumn: string;
  openReference: string;
  authEyebrow: string;
  authTitle: string;
  authDescription: string;
  authHeaderLabel: string;
  authValueLabel: string;
  authScopeLabel: string;
  authScopeValue: string;
  nextEyebrow: string;
  nextTitle: string;
  nextDescription: string;
  playgroundEyebrow: string;
  playgroundTitle: string;
  playgroundDescription: string;
  openPlayground: string;
  referenceEyebrow: string;
  referenceTitle: string;
  referenceDescription: string;
  openReferencePage: string;
  navOverview: string;
  navQuickstart: string;
  navAuth: string;
  navErrors: string;
  navRoutes: string;
  navNext: string;
  errorsEyebrow: string;
  errorsTitle: string;
  errorsDescription: string;
  prerequisitesLabel: string;
  prerequisiteNode: string;
  prerequisitePython: string;
  prerequisiteCurl: string;
  versionLabel: string;
};

const enUS: AgentPublicDocsPageText = {
  loadingTitle: "Loading developer docs",
  loadingDescription:
    "Preparing the published agent overview and the canonical OpenAPI contract.",
  loadFailedTitle: "Developer docs unavailable",
  loadFailedDescription:
    "The published agent export document could not be loaded.",
  referenceFailedTitle: "OpenAPI contract unavailable",
  referenceFailedDescription:
    "The overview now reads directly from the published OpenAPI contract, and that document could not be loaded.",
  openHome: "Open workspace",
  heroEyebrow: "Overview",
  heroTitle: "A published agent with one public contract and one live console",
  heroDescription:
    "External callers use `base_url`, `api_key`, and `agent=<agent_name>` to call the native `/v1/turns` contract. Use this page to copy the exact connection values, confirm the public routes, and then move into the live console or field-level reference.",
  heroFactOneLabel: "Client shape",
  heroFactOneValue: "Raw HTTP, QA scripts, and customer-side integrations can all start from the same published contract.",
  heroFactTwoLabel: "Response modes",
  heroFactTwoValue: "Blocking, SSE, file upload, and structured JSON stay on the same published agent surface.",
  heroFactThreeLabel: "Public routes",
  heroFactThreeValue: "published routes",
  connectionEyebrow: "Connection",
  baseURL: "Base URL",
  baseURLNoteTitle: "Environment note",
  baseURLNote:
    "This page shows the gateway that served the current docs. When you hand the contract to an external team, replace any local hostname with the deployed gateway you expect them to call.",
  modelName: "Model",
  apiKeyLabel: "API Key",
  apiKeyExample: "<user_created_key>",
  modesLabel: "Modes",
  modesValue: "Blocking / SSE / Files / JSON",
  quickstartEyebrow: "Quickstart",
  quickstartTitle: "Start with one successful request",
  quickstartDescription:
    "Start with one simple blocking turn against the published contract. After that works, move to the playground for live timelines, file upload, and generated artifacts.",
  jsTab: "JavaScript",
  pythonTab: "Python",
  curlTab: "cURL",
  copy: "Copy",
  copied: "Copied",
  routesEyebrow: "Routes",
  routesTitle: "Public API surface",
  routesDescription:
    "These are the routes external developers should integrate against. `/v1/turns` is the native first-party path; field-level request and response details live on the dedicated API reference page.",
  routeMethodColumn: "Method",
  routePathColumn: "Path",
  routeSummaryColumn: "Summary",
  routeDocsColumn: "Docs",
  openReference: "View details",
  authEyebrow: "Authentication",
  authTitle: "Send the published-agent key on every request",
  authDescription:
    "Every public route uses the same bearer key. There is no separate compatibility credential for `models`, `turns`, `responses`, `chat/completions`, or `files`.",
  authHeaderLabel: "Header",
  authValueLabel: "Value",
  authScopeLabel: "Scope",
  authScopeValue:
    "Applies to `/v1/models`, `/v1/turns`, `/v1/responses`, `/v1/chat/completions`, and `/v1/files`.",
  nextEyebrow: "Next",
  nextTitle: "Choose the right surface for the next job",
  nextDescription:
    "The docs homepage stays compact on purpose. Use the playground for real execution and the API reference for field-level schema work. The external customer acceptance console now lives outside the app.",
  playgroundEyebrow: "Playground",
  playgroundTitle: "Run the contract end to end",
  playgroundDescription:
    "Send blocking or SSE requests, inspect the normalized run timeline, and download generated artifacts.",
  openPlayground: "Open playground",
  referenceEyebrow: "API reference",
  referenceTitle: "Inspect request and response fields",
  referenceDescription:
    "Read the published OpenAPI contract as documentation instead of parsing the raw schema by hand.",
  openReferencePage: "Open API reference",
  navOverview: "Overview",
  navQuickstart: "Quickstart",
  navAuth: "Auth",
  navErrors: "Errors",
  navRoutes: "Routes",
  navNext: "Next",
  errorsEyebrow: "Errors",
  errorsTitle: "Common error responses",
  errorsDescription:
    "These are the most common error codes returned by the published API. All error responses follow a consistent JSON shape.",
  prerequisitesLabel: "Prerequisites",
  prerequisiteNode: "Node.js 18+",
  prerequisitePython: "Python 3.8+",
  prerequisiteCurl: "curl 7.68+",
  versionLabel: "Version",
};

const zhCN: AgentPublicDocsPageText = {
  loadingTitle: "正在加载开发者文档",
  loadingDescription: "正在准备已发布智能体概览页和其唯一 OpenAPI 契约源。",
  loadFailedTitle: "开发者文档暂不可用",
  loadFailedDescription: "当前无法加载这个已发布智能体的导出文档。",
  referenceFailedTitle: "OpenAPI 契约暂不可用",
  referenceFailedDescription:
    "概览页现在直接读取已发布 OpenAPI 契约，如果该契约无法加载，页面不会再退回到旧的兜底展示。",
  openHome: "打开工作台",
  heroEyebrow: "概览",
  heroTitle: "一个同时提供公开契约和实时控制台的已发布智能体",
  heroDescription:
    "外部调用方使用 `base_url`、`api_key` 和 `agent=<agent_name>` 即可直接接入原生 `/v1/turns`。这里负责给出准确接入值、确认公开路由，然后再进入实时控制台或字段级 API Reference。",
  heroFactOneLabel: "接入形态",
  heroFactOneValue: "原始 HTTP、测试脚本和客户侧接入实现都可以从同一份已发布契约开始接入。",
  heroFactTwoLabel: "响应模式",
  heroFactTwoValue: "Blocking、SSE、文件上传和结构化 JSON 都在同一个已发布智能体接口面上完成。",
  heroFactThreeLabel: "公开路由",
  heroFactThreeValue: "个公开路由",
  connectionEyebrow: "接入参数",
  baseURL: "Base URL",
  baseURLNoteTitle: "环境说明",
  baseURLNote:
    "这里显示的是当前这份文档所在环境的网关地址。对外交付时，如果这里还是本地地址，请替换成外部团队实际应调用的部署网关。",
  modelName: "Model",
  apiKeyLabel: "API Key",
  apiKeyExample: "<user_created_key>",
  modesLabel: "支持模式",
  modesValue: "Blocking / SSE / Files / JSON",
  quickstartEyebrow: "快速开始",
  quickstartTitle: "先跑通一条成功请求",
  quickstartDescription:
    "先用已发布契约跑通一条最简单的 blocking turn。确认成功后，再去 Playground 验证实时时间线、文件上传和生成产物。",
  jsTab: "JavaScript",
  pythonTab: "Python",
  curlTab: "cURL",
  copy: "复制",
  copied: "已复制",
  routesEyebrow: "路由",
  routesTitle: "公开 API 面",
  routesDescription:
    "这些就是外部开发者应直接集成的公开路由。其中 `/v1/turns` 是原生一等路径；字段级 request / response 细节放在独立的 API Reference 页面。",
  routeMethodColumn: "方法",
  routePathColumn: "路径",
  routeSummaryColumn: "说明",
  routeDocsColumn: "文档",
  openReference: "查看详情",
  authEyebrow: "鉴权",
  authTitle: "所有公开请求都使用同一把已发布 Key",
  authDescription:
    "所有公开路由都使用同一把 Bearer Key，不存在针对 `models`、`turns`、`responses`、`chat/completions` 或 `files` 的另一套兼容层凭证。",
  authHeaderLabel: "Header",
  authValueLabel: "取值",
  authScopeLabel: "范围",
  authScopeValue:
    "适用于 `/v1/models`、`/v1/turns`、`/v1/responses`、`/v1/chat/completions` 和 `/v1/files`。",
  nextEyebrow: "下一步",
  nextTitle: "按任务进入正确页面",
  nextDescription:
    "概览页故意保持精简。真实跑契约去 Playground，看字段细节去 API Reference。外部客户侧验收台已统一放到 app 外部的独立 demo。",
  playgroundEyebrow: "Playground",
  playgroundTitle: "把契约真实跑起来",
  playgroundDescription:
    "直接发送 blocking 或 SSE 请求，查看归一化后的运行时间线，并下载执行过程中生成的产物。",
  openPlayground: "打开 Playground",
  referenceEyebrow: "API Reference",
  referenceTitle: "查看请求和响应字段",
  referenceDescription:
    "把已发布 OpenAPI 契约当作文档阅读，而不是让用户自己去啃原始 Schema。",
  openReferencePage: "打开 API Reference",
  navOverview: "概览",
  navQuickstart: "快速开始",
  navAuth: "鉴权",
  navErrors: "错误",
  navRoutes: "路由",
  navNext: "下一步",
  errorsEyebrow: "错误码",
  errorsTitle: "常见错误响应",
  errorsDescription:
    "这些是已发布 API 最常见的错误码。所有错误响应都遵循统一的 JSON 格式。",
  prerequisitesLabel: "环境要求",
  prerequisiteNode: "Node.js 18+",
  prerequisitePython: "Python 3.8+",
  prerequisiteCurl: "curl 7.68+",
  versionLabel: "版本",
};

export function getAgentPublicDocsPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
