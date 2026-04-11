import type { Locale } from "@/core/i18n";

type AgentPlaygroundPageText = {
  eyebrow: string;
  titleSuffix: string;
  description: string;
  backToSettings: string;
  openAgent: string;
  openDocs: string;
  publishedAgent: string;
  currentArchive: string;
  gatewayBase: string;
  contracts: string;
  contractsValue: string;
  referenceTitle: string;
  referenceDescription: string;
  documentation: string;
  documentationDescription: string;
  endpointsTitle: string;
  endpointsDescription: string;
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
  productionOnlyTitle: string;
  productionOnlyDescription: string;
  returnToSettings: string;
};

const enUS: AgentPlaygroundPageText = {
  eyebrow: "Standalone Playground",
  titleSuffix: "Public API Playground",
  description:
    "Use the full workspace width to test the published `/v1` contract with a key from the API keys page, uploads, event flow, and generated files.",
  backToSettings: "Back to settings",
  openAgent: "Open agent",
  openDocs: "Open developer docs",
  publishedAgent: "Published agent",
  currentArchive: "Current archive",
  gatewayBase: "Gateway base",
  contracts: "Contracts",
  contractsValue: "responses, files, artifacts, structured JSON",
  referenceTitle: "Reference",
  referenceDescription:
    "Share this stable gateway base and documentation URL with external integrators.",
  documentation: "Documentation",
  documentationDescription:
    "Open the generated export document in a separate tab for endpoint-level details.",
  endpointsTitle: "Published endpoints",
  endpointsDescription:
    "These URLs are the current public entrypoints for this prod archive.",
  loadingTitle: "Loading export document",
  loadingDescription: "Preparing the published public API contract.",
  loadFailedTitle: "Export document unavailable",
  loadFailedDescription:
    "The published agent could not load its public API document.",
  productionOnlyTitle: "Publish this agent first",
  productionOnlyDescription:
    "The standalone playground is only available for prod archives with a stable `/v1` contract.",
  returnToSettings: "Return to settings",
};

const zhCN: AgentPlaygroundPageText = {
  eyebrow: "独立 Playground",
  titleSuffix: "公共 API Playground",
  description:
    "使用完整页面宽度测试已发布的 `/v1` 契约，包括独立 API Key 页面签发的 key、文件上传、事件流和生成文件下载。",
  backToSettings: "返回设置",
  openAgent: "打开 Agent",
  openDocs: "打开开发者文档",
  publishedAgent: "已发布 Agent",
  currentArchive: "当前归档",
  gatewayBase: "网关地址",
  contracts: "能力契约",
  contractsValue: "responses、files、artifacts、结构化 JSON",
  referenceTitle: "接口参考",
  referenceDescription:
    "这里提供稳定的网关地址和文档入口，方便直接发给外部接入方。",
  documentation: "接口文档",
  documentationDescription:
    "在新标签页打开导出的文档，查看当前 prod 归档的端点细节。",
  endpointsTitle: "已发布端点",
  endpointsDescription: "这些 URL 就是当前 prod 归档对外暴露的公共入口。",
  loadingTitle: "正在加载导出文档",
  loadingDescription: "正在准备该智能体对外可调用的 public API 契约。",
  loadFailedTitle: "导出文档不可用",
  loadFailedDescription: "当前无法加载这个已发布智能体的 public API 文档。",
  productionOnlyTitle: "请先发布到 prod",
  productionOnlyDescription:
    "只有 prod 归档具备稳定的 `/v1` 契约，因此独立 Playground 只对 prod 开放。",
  returnToSettings: "返回设置页",
};

export function getAgentPlaygroundPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
