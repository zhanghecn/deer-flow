import type { Locale } from "@/core/i18n";

type AgentPublicReferencePageText = {
  eyebrow: string;
  titleSuffix: string;
  description: string;
  stableContract: string;
  baseURL: string;
  modelName: string;
  backDocs: string;
  openPlayground: string;
  rawOpenAPI: string;
  openHome: string;
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
};

const enUS: AgentPublicReferencePageText = {
  eyebrow: "API Reference",
  titleSuffix: "Reference",
  description:
    "Interactive OpenAPI reference for the published agent contract. Use this page for endpoint-level details and try-it requests.",
  stableContract: "OpenAPI source of truth",
  baseURL: "Base URL",
  modelName: "Model",
  backDocs: "Back to docs",
  openPlayground: "Open playground",
  rawOpenAPI: "Raw OpenAPI JSON",
  openHome: "Open workspace",
  loadingTitle: "Loading API reference",
  loadingDescription:
    "Preparing the OpenAPI reference for this published agent.",
  loadFailedTitle: "Reference unavailable",
  loadFailedDescription: "The published OpenAPI reference could not be loaded.",
};

const zhCN: AgentPublicReferencePageText = {
  eyebrow: "API Reference",
  titleSuffix: "接口参考",
  description:
    "这是该已发布 agent 契约的交互式 OpenAPI 参考页，适合查看端点细节并直接发起 try-it 请求。",
  stableContract: "OpenAPI 真正规范源",
  baseURL: "Base URL",
  modelName: "Model",
  backDocs: "返回文档首页",
  openPlayground: "打开 Playground",
  rawOpenAPI: "原始 OpenAPI JSON",
  openHome: "打开工作台",
  loadingTitle: "正在加载接口参考",
  loadingDescription: "正在准备该已发布 agent 的 OpenAPI 参考页。",
  loadFailedTitle: "接口参考暂不可用",
  loadFailedDescription: "当前无法加载这个已发布 agent 的 OpenAPI 参考。",
};

export function getAgentPublicReferencePageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
