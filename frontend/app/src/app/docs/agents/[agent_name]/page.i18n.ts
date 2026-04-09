import type { Locale } from "@/core/i18n";

type AgentPublicDocsPageText = {
  eyebrow: string;
  titleSuffix: string;
  description: string;
  stableContract: string;
  baseURL: string;
  modelName: string;
  apiKeyLabel: string;
  docsHome: string;
  apiReference: string;
  debugPlayground: string;
  rawExport: string;
  rawOpenAPI: string;
  openHome: string;
  quickstartTitle: string;
  quickstartDescription: string;
  stepOneTitle: string;
  stepOneDescription: string;
  stepTwoTitle: string;
  stepTwoDescription: string;
  stepThreeTitle: string;
  stepThreeDescription: string;
  snippetTitle: string;
  snippetDescription: string;
  jsTab: string;
  pythonTab: string;
  curlTab: string;
  copy: string;
  copied: string;
  supportTitle: string;
  supportDescription: string;
  supportStreaming: string;
  supportFiles: string;
  supportStructured: string;
  supportArtifacts: string;
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
};

const enUS: AgentPublicDocsPageText = {
  eyebrow: "Published Agent",
  titleSuffix: "Developer Docs",
  description:
    "External teams only need three inputs to use this agent: the `/v1` base URL, a user-issued API key, and `model=<agent_name>`.",
  stableContract: "OpenAI-style request surface",
  baseURL: "Base URL",
  modelName: "Model",
  apiKeyLabel: "API Key",
  docsHome: "Docs home",
  apiReference: "API reference",
  debugPlayground: "Debug playground",
  rawExport: "Raw export JSON",
  rawOpenAPI: "Raw OpenAPI JSON",
  openHome: "Open workspace",
  quickstartTitle: "Quick start",
  quickstartDescription:
    "Copy the `/v1` address, use the issued API key, and call the published agent name as the model.",
  stepOneTitle: "1. Point your OpenAI SDK to the `/v1` base URL",
  stepOneDescription:
    "No provider-specific model endpoint is exposed. The published gateway address is the only northbound base URL.",
  stepTwoTitle: "2. Set `model=<agent_name>`",
  stepTwoDescription:
    "The `model` field targets this published agent contract, not the underlying provider model.",
  stepThreeTitle: "3. Choose blocking or SSE",
  stepThreeDescription:
    "Use blocking mode for a final envelope, or SSE when your product needs live agent events and text deltas.",
  snippetTitle: "SDK snippets",
  snippetDescription:
    "These examples are the shortest possible path from zero to a working request.",
  jsTab: "JavaScript",
  pythonTab: "Python",
  curlTab: "cURL",
  copy: "Copy",
  copied: "Copied",
  supportTitle: "What you get",
  supportDescription:
    "The published surface stays OpenAI-compatible on input while keeping richer agent execution output available when you need it.",
  supportStreaming: "Blocking and SSE",
  supportFiles: "File upload and downloads",
  supportStructured: "Strict structured output",
  supportArtifacts: "Generated artifacts and events",
  loadingTitle: "Loading published contract",
  loadingDescription:
    "Preparing the public developer entry for this published agent.",
  loadFailedTitle: "Documentation unavailable",
  loadFailedDescription:
    "The published agent export document could not be loaded.",
};

const zhCN: AgentPublicDocsPageText = {
  eyebrow: "已发布 Agent",
  titleSuffix: "开发者文档",
  description:
    "外部团队接入这个 agent 只需要三项输入：`/v1` Base URL、用户创建的 API key，以及 `model=<agent_name>`。",
  stableContract: "OpenAI 风格请求面",
  baseURL: "Base URL",
  modelName: "Model",
  apiKeyLabel: "API Key",
  docsHome: "文档首页",
  apiReference: "接口参考",
  debugPlayground: "调试 Playground",
  rawExport: "原始导出 JSON",
  rawOpenAPI: "原始 OpenAPI JSON",
  openHome: "打开工作台",
  quickstartTitle: "快速接入",
  quickstartDescription:
    "复制 `/v1` 地址，使用发放的 API key，并把已发布 agent 名称作为 model 调用即可。",
  stepOneTitle: "1. 把 OpenAI SDK 指向 `/v1` Base URL",
  stepOneDescription:
    "平台不会暴露任何 provider 专属模型地址。对外唯一入口就是已发布网关的 `/v1` 地址。",
  stepTwoTitle: "2. 设置 `model=<agent_name>`",
  stepTwoDescription:
    "`model` 指向的是这个已发布 agent 契约，而不是底层 provider model。",
  stepThreeTitle: "3. 选择 blocking 或 SSE",
  stepThreeDescription:
    "只要最终结果时用 blocking；需要过程事件和文本增量时用 SSE。",
  snippetTitle: "最短示例",
  snippetDescription: "下面这些示例就是从零到成功发起请求的最短路径。",
  jsTab: "JavaScript",
  pythonTab: "Python",
  curlTab: "cURL",
  copy: "复制",
  copied: "已复制",
  supportTitle: "你能获得什么",
  supportDescription:
    "对外请求面保持 OpenAI 兼容，同时在需要时仍能保留更丰富的 agent 执行输出。",
  supportStreaming: "Blocking 与 SSE",
  supportFiles: "文件上传与下载",
  supportStructured: "严格结构化输出",
  supportArtifacts: "生成文件与执行事件",
  loadingTitle: "正在加载已发布契约",
  loadingDescription: "正在准备这个已发布 agent 的公共接入入口。",
  loadFailedTitle: "文档暂不可用",
  loadFailedDescription: "当前无法加载该已发布 agent 的导出文档。",
};

export function getAgentPublicDocsPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
