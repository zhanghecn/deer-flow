import type { Locale } from "@/core/i18n";

type AgentPublicPlaygroundPageText = {
  loadingTitle: string;
  loadingDescription: string;
  loadFailedTitle: string;
  loadFailedDescription: string;
  referenceFailedTitle: string;
  referenceFailedDescription: string;
  openHome: string;
  eyebrow: string;
  title: string;
  description: string;
  heroFactOneLabel: string;
  heroFactOneValue: string;
  heroFactTwoLabel: string;
  heroFactTwoValue: string;
  heroFactThreeLabel: string;
  heroFactThreeValue: string;
  stepsEyebrow: string;
  stepsTitle: string;
  stepsDescription: string;
  stepOneTitle: string;
  stepOneDescription: string;
  stepTwoTitle: string;
  stepTwoDescription: string;
  stepThreeTitle: string;
  stepThreeDescription: string;
  introNav: string;
  connectNav: string;
  runNav: string;
  workflowNav: string;
};

const enUS: AgentPublicPlaygroundPageText = {
  loadingTitle: "Loading playground",
  loadingDescription:
    "Preparing the standalone execution surface for this published agent.",
  loadFailedTitle: "Playground unavailable",
  loadFailedDescription:
    "The published agent export document could not be loaded.",
  referenceFailedTitle: "OpenAPI contract unavailable",
  referenceFailedDescription:
    "The playground keeps the published OpenAPI contract available alongside the runtime surface, and that document could not be loaded.",
  openHome: "Open workspace",
  eyebrow: "Playground",
  title: "Run real public-agent calls on a full-width execution surface",
  description:
    "Use this page only for live execution: blocking requests, SSE, file upload, normalized run timelines, and generated artifact download. The overview and API reference stay separate so this page can focus on exercising the contract.",
  heroFactOneLabel: "What you can verify",
  heroFactOneValue: "Blocking and SSE behavior, uploaded inputs, generated files, and the normalized run timeline.",
  heroFactTwoLabel: "Who this is for",
  heroFactTwoValue: "External integrators, solution engineers, and internal QA validating the published agent before customer rollout.",
  heroFactThreeLabel: "Why it is separate",
  heroFactThreeValue: "The runtime panel gets the width it needs instead of being squeezed into a mixed docs page.",
  stepsEyebrow: "Workflow",
  stepsTitle: "How to use this page",
  stepsDescription:
    "Treat this as the last-mile debugger for the published contract, not as the place where external developers first learn the API.",
  stepOneTitle: "Paste the exact base URL and user key",
  stepOneDescription:
    "The panel defaults to the current gateway, but you can still point it at the customer-facing deployment you want to validate.",
  stepTwoTitle: "Run the request in the response mode you actually ship",
  stepTwoDescription:
    "Switch between text and JSON output, attach files, enable reasoning, and choose blocking or streaming to match the real integration path.",
  stepThreeTitle: "Inspect the full trace before handing the contract out",
  stepThreeDescription:
    "Use the run timeline and artifact download area to confirm the external developer will see the behavior you expect.",
  introNav: "Intro",
  connectNav: "Connect",
  runNav: "Run",
  workflowNav: "Workflow",
};

const zhCN: AgentPublicPlaygroundPageText = {
  loadingTitle: "正在加载 Playground",
  loadingDescription: "正在准备这个已发布智能体的独立执行调试页面。",
  loadFailedTitle: "Playground 暂不可用",
  loadFailedDescription: "当前无法加载这个已发布智能体的导出文档。",
  referenceFailedTitle: "OpenAPI 契约暂不可用",
  referenceFailedDescription:
    "调试页会同时保留已发布 OpenAPI 契约入口，如果该契约无法加载，这里会直接报错而不是继续隐藏问题。",
  openHome: "打开工作台",
  eyebrow: "Playground",
  title: "在完整执行面上真实运行公开智能体调用",
  description:
    "这个页面只用于真实执行：blocking 请求、SSE、文件上传、归一化运行时间线和产物下载。概览和 API Reference 独立存在，这里只做运行契约这一件事。",
  heroFactOneLabel: "可验证内容",
  heroFactOneValue: "Blocking 与 SSE 行为、上传输入、生成文件，以及归一化后的运行时间线。",
  heroFactTwoLabel: "适用对象",
  heroFactTwoValue: "对接方开发者、解决方案工程师，以及在客户接入前做最终验收的内部测试人员。",
  heroFactThreeLabel: "为什么独立",
  heroFactThreeValue: "执行面终于可以获得足够宽度，而不是再被硬塞进混合文档页里。",
  stepsEyebrow: "使用流程",
  stepsTitle: "如何使用这个页面",
  stepsDescription:
    "把它当成已发布契约的最后一公里调试面，而不是第一次教外部开发者理解 API 的地方。",
  stepOneTitle: "填入准确的网关地址和用户 Key",
  stepOneDescription:
    "面板默认使用当前文档所在网关，但你仍然可以改成真正给客户提供的部署地址做验证。",
  stepTwoTitle: "按你真实交付的响应模式去跑请求",
  stepTwoDescription:
    "可以切换文本和 JSON 输出、上传文件、启用思考，并选择 blocking 或 streaming，让测试路径与真实接入保持一致。",
  stepThreeTitle: "交付前先检查完整事件过程",
  stepThreeDescription:
    "通过运行时间线和产物下载区确认外部开发者最终看到的行为符合预期，再把契约给出去。",
  introNav: "简介",
  connectNav: "连接",
  runNav: "运行",
  workflowNav: "流程",
};

export function getAgentPublicPlaygroundPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
