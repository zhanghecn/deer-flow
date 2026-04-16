import type { Locale } from "@/core/i18n";

type AgentPublicSupportPageText = {
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
  referenceFailedTitle: string;
  referenceFailedDescription: string;
  openHome: string;
  title: string;
  description: string;
  introNav: string;
  consoleNav: string;
  activityNav: string;
};

const enUS: AgentPublicSupportPageText = {
  loadingTitle: "Loading support demo",
  loadingDescription:
    "Preparing the published agent contract and the customer-style SDK surface.",
  loadFailedTitle: "Support demo unavailable",
  loadFailedDescription:
    "The published agent export document could not be loaded.",
  referenceFailedTitle: "OpenAPI contract unavailable",
  referenceFailedDescription:
    "The support demo stays attached to the published contract. If the OpenAPI document cannot be loaded, this page stops instead of guessing.",
  openHome: "Open workspace",
  title: "Customer support demo",
  description:
    "This page is a separate browser-side chat surface that calls the published agent through the official OpenAI-compatible SDK. Use it to validate the exact external integration path before handing the contract to a customer team.",
  introNav: "Intro",
  consoleNav: "Console",
  activityNav: "Activity",
};

const zhCN: AgentPublicSupportPageText = {
  loadingTitle: "正在加载客服演示",
  loadingDescription: "正在准备已发布智能体契约和客户视角的 SDK 页面。",
  loadFailedTitle: "客服演示暂不可用",
  loadFailedDescription: "当前无法加载这个已发布智能体的导出文档。",
  referenceFailedTitle: "OpenAPI 契约暂不可用",
  referenceFailedDescription:
    "客服演示页直接绑定已发布契约；如果 OpenAPI 文档无法加载，这里会直接停止，而不是继续猜测页面行为。",
  openHome: "打开工作台",
  title: "客服演示",
  description:
    "这是一个独立的浏览器侧聊天页，通过官方 OpenAI 兼容 SDK 调用已发布智能体。用它验证真实外部接入链路，再把契约交给客户团队。",
  introNav: "说明",
  consoleNav: "控制台",
  activityNav: "活动",
};

export function getAgentPublicSupportPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
