import type { Locale } from "@/core/i18n";

type AgentPublicReferencePageText = {
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
  openHome: string;
  eyebrow: string;
  title: string;
  description: string;
  summaryBaseURL: string;
  summaryVersion: string;
  summarySpec: string;
  summaryAuth: string;
  operationsEyebrow: string;
  operationsTitle: string;
  operationsDescription: string;
  schemasEyebrow: string;
  schemasTitle: string;
  schemasDescription: string;
  parametersEyebrow: string;
  parametersTitle: string;
  requestEyebrow: string;
  requestTitle: string;
  fieldColumn: string;
  typeColumn: string;
  requiredColumn: string;
  detailsColumn: string;
  locationColumn: string;
  requiredYes: string;
  requiredNo: string;
  noFields: string;
  requestTab: string;
  responseTab: string;
  exampleTab: string;
  requestExampleTitle: string;
  copy: string;
  copied: string;
};

const enUS: AgentPublicReferencePageText = {
  loadingTitle: "Loading API reference",
  loadingDescription:
    "Preparing the published OpenAPI contract and operation index for this agent.",
  loadFailedTitle: "API reference unavailable",
  loadFailedDescription: "The published OpenAPI document could not be loaded.",
  openHome: "Open workspace",
  eyebrow: "API Reference",
  title: "Field-level request and response details from the published contract",
  description:
    "This page reads directly from the published OpenAPI document and renders it as a readable developer reference. The goal is fast scanning: routes, fields, response shapes, and example calls all live in one document layout.",
  summaryBaseURL: "Base URL",
  summaryVersion: "Version",
  summarySpec: "Spec",
  summaryAuth: "Authentication",
  operationsEyebrow: "Operations",
  operationsTitle: "Published routes",
  operationsDescription:
    "Each route is rendered as a single documentation section with request fields, response fields, and copyable examples.",
  schemasEyebrow: "Schemas",
  schemasTitle: "Reusable objects",
  schemasDescription:
    "The schema section keeps shared payload objects collapsible so the page stays compact without hiding important fields.",
  parametersEyebrow: "Parameters",
  parametersTitle: "Path and query inputs",
  requestEyebrow: "Request body",
  requestTitle: "Accepted fields",
  fieldColumn: "Field",
  typeColumn: "Type",
  requiredColumn: "Required",
  detailsColumn: "Details",
  locationColumn: "Location",
  requiredYes: "Yes",
  requiredNo: "No",
  noFields: "This schema does not declare explicit fields.",
  requestTab: "Request",
  responseTab: "Responses",
  exampleTab: "Examples",
  requestExampleTitle: "Request Body",
  copy: "Copy",
  copied: "Copied",
};

const zhCN: AgentPublicReferencePageText = {
  loadingTitle: "正在加载 API Reference",
  loadingDescription: "正在准备这个已发布智能体的 OpenAPI 契约和接口索引。",
  loadFailedTitle: "API Reference 暂不可用",
  loadFailedDescription: "当前无法加载已发布 OpenAPI 契约文档。",
  openHome: "打开工作台",
  eyebrow: "API Reference",
  title: "直接基于已发布契约渲染的字段级请求与响应说明",
  description:
    "这个页面直接读取已发布 OpenAPI 文档，并把它压成更易读的开发者参考页。重点是快速扫读：路由、字段、响应结构和示例调用都放在同一个文档布局里。",
  summaryBaseURL: "Base URL",
  summaryVersion: "版本",
  summarySpec: "规范",
  summaryAuth: "鉴权",
  operationsEyebrow: "接口",
  operationsTitle: "已发布路由",
  operationsDescription:
    "每个接口都被渲染成一个独立文档区块，包含请求字段、响应字段和可复制示例。",
  schemasEyebrow: "对象",
  schemasTitle: "可复用对象",
  schemasDescription:
    "对象区采用折叠结构，既保持页面紧凑，又不会把重要字段藏掉。",
  parametersEyebrow: "参数",
  parametersTitle: "路径与查询输入",
  requestEyebrow: "请求体",
  requestTitle: "可接受字段",
  fieldColumn: "字段",
  typeColumn: "类型",
  requiredColumn: "必填",
  detailsColumn: "说明",
  locationColumn: "位置",
  requiredYes: "是",
  requiredNo: "否",
  noFields: "这个 schema 没有声明明确字段。",
  requestTab: "请求",
  responseTab: "响应",
  exampleTab: "示例",
  requestExampleTitle: "请求体",
  copy: "复制",
  copied: "已复制",
};

export function getAgentPublicReferencePageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
