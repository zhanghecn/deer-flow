import type { Locale } from "@/core/i18n";

type AgentPublicDocsShellText = {
  eyebrow: string;
  homeLabel: string;
  pagesLabel: string;
  currentPageLabel: string;
  tabOverview: string;
  tabPlayground: string;
  tabReference: string;
  rawOpenAPI: string;
  rawExport: string;
};

const enUS: AgentPublicDocsShellText = {
  eyebrow: "Developer Docs",
  homeLabel: "Published agent",
  pagesLabel: "Pages",
  currentPageLabel: "Current",
  tabOverview: "Overview",
  tabPlayground: "Playground",
  tabReference: "API Reference",
  rawOpenAPI: "Raw OpenAPI",
  rawExport: "Export JSON",
};

const zhCN: AgentPublicDocsShellText = {
  eyebrow: "开发者文档",
  homeLabel: "已发布智能体",
  pagesLabel: "页面",
  currentPageLabel: "当前",
  tabOverview: "概览",
  tabPlayground: "调试台",
  tabReference: "API 参考",
  rawOpenAPI: "原始 OpenAPI",
  rawExport: "导出 JSON",
};

export function getAgentPublicDocsShellText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
