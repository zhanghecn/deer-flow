import type { Locale } from "@/core/i18n";

type AgentPublicPlaygroundPageText = {
  eyebrow: string;
  titleSuffix: string;
  description: string;
  stableContract: string;
  baseURL: string;
  modelName: string;
  openDocs: string;
  openReference: string;
  openHome: string;
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
};

const enUS: AgentPublicPlaygroundPageText = {
  eyebrow: "Debug Playground",
  titleSuffix: "Playground",
  description:
    "Run the real published `/v1` contract with streaming traces, file uploads, structured output, and generated artifacts.",
  stableContract: "Live `/v1` execution surface",
  baseURL: "Base URL",
  modelName: "Model",
  openDocs: "Docs home",
  openReference: "API reference",
  openHome: "Open workspace",
  loadingTitle: "Loading playground",
  loadingDescription: "Preparing the debug console for this published agent.",
  loadFailedTitle: "Playground unavailable",
  loadFailedDescription:
    "The published agent export document could not be loaded.",
};

const zhCN: AgentPublicPlaygroundPageText = {
  eyebrow: "调试 Playground",
  titleSuffix: "调试台",
  description:
    "直接调用真实已发布 `/v1` 契约，查看流式事件、文件上传、结构化输出和生成文件。",
  stableContract: "真实 `/v1` 执行面",
  baseURL: "Base URL",
  modelName: "Model",
  openDocs: "文档首页",
  openReference: "接口参考",
  openHome: "打开工作台",
  loadingTitle: "正在加载 Playground",
  loadingDescription: "正在准备这个已发布 agent 的调试控制台。",
  loadFailedTitle: "Playground 暂不可用",
  loadFailedDescription: "当前无法加载这个已发布 agent 的导出文档。",
};

export function getAgentPublicPlaygroundPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
