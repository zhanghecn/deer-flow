import {
  GITHUB_REPO_URL,
  OFFICIAL_WEBSITE_URL,
  PUBLIC_GITHUB_REPO_AVAILABLE,
} from "@/core/config/site";

import type { Locale } from "@/core/i18n";

const projectLinksSection = {
  "en-US": PUBLIC_GITHUB_REPO_AVAILABLE
    ? `## GitHub Repository

![Star History Chart](https://api.star-history.com/svg?repos=bytedance/openagents&type=Date)

Explore OpenAgents on GitHub: [github.com/bytedance/openagents](${GITHUB_REPO_URL})

## Official Website

Visit the official website of OpenAgents: [openagents.dev](${OFFICIAL_WEBSITE_URL})`
    : `## Official Website

Visit the official website of OpenAgents: [openagents.dev](${OFFICIAL_WEBSITE_URL})`,
  "zh-CN": PUBLIC_GITHUB_REPO_AVAILABLE
    ? `## GitHub 仓库

![Star History Chart](https://api.star-history.com/svg?repos=bytedance/openagents&type=Date)

在 GitHub 上查看 OpenAgents：[github.com/bytedance/openagents](${GITHUB_REPO_URL})

## 官方网站

访问 OpenAgents 官方网站：[openagents.dev](${OFFICIAL_WEBSITE_URL})`
    : `## 官方网站

访问 OpenAgents 官方网站：[openagents.dev](${OFFICIAL_WEBSITE_URL})`,
} as const;

const aboutMarkdown = {
  "en-US": `# [About OpenAgents](${OFFICIAL_WEBSITE_URL})

OpenAgents is an open-source **super agent harness** that orchestrates **sub-agents**, **memory**, and **sandboxes** to do almost anything — powered by **extensible skills**.

---

## Core Features

* **Skills & Tools**: With built-in and extensible skills and tools, OpenAgents can do almost anything.
* **Sub-Agents**: Sub-Agents help the main agent to do the tasks that are too complex to be done by the main agent.
* **Sandbox & File System**: Safely execute code and manipulate files in the sandbox.
* **Context Engineering**: Isolated sub-agent context, summarization to keep the context window sharp.
* **Long-Term Memory**: Keep recording the user's profile, top of mind, and conversation history.

---

${projectLinksSection["en-US"]}

---

## License

OpenAgents is proudly open source and distributed under the **MIT License**.

---

## Acknowledgments

We extend our heartfelt gratitude to the open source projects and contributors who have made OpenAgents a reality. We truly stand on the shoulders of giants.

### Core Frameworks
- **[LangChain](https://github.com/langchain-ai/langchain)**: A phenomenal framework that powers our LLM interactions and chains.
- **[LangGraph](https://github.com/langchain-ai/langgraph)**: Enabling sophisticated multi-agent orchestration.
- **[Vite](https://vite.dev/)**: A fast, modern frontend build tool powering the web application.

### UI Libraries
- **[Shadcn](https://ui.shadcn.com/)**: Minimalistic components that power our UI.
- **[SToneX](https://github.com/stonexer)**: For his invaluable contribution to token-by-token visual effects.

These outstanding projects form the backbone of OpenAgents and exemplify the transformative power of open source collaboration.

### Special Thanks
Finally, we want to express our heartfelt gratitude to the core authors of OpenAgents:

- **[Daniel Walnut](https://github.com/hetaoBackend/)**
- **[Henry Li](https://github.com/magiccube/)**

Without their vision, passion and dedication, \`OpenAgents\` would not be what it is today.
`,
  "zh-CN": `# [关于 OpenAgents](${OFFICIAL_WEBSITE_URL})

> **源于开源，回归开源**

OpenAgents 是一个开源的 **超级智能体运行框架**，通过编排 **子智能体**、**长期记忆** 与 **沙盒环境** 来完成复杂任务，并由可扩展的 **技能系统** 提供能力支撑。

---

## 核心能力

* **技能与工具**：借助内置与可扩展的技能和工具，OpenAgents 可以覆盖大量真实工作场景。
* **子智能体**：子智能体可以分担复杂任务，让主智能体更稳定地完成执行。
* **沙盒与文件系统**：在隔离环境中安全执行代码并操作文件。
* **上下文工程**：通过隔离子任务上下文与摘要机制，保持上下文窗口清晰高效。
* **长期记忆**：持续记录用户画像、重要事项与对话历史。

---

${projectLinksSection["zh-CN"]}

---

## 许可证

OpenAgents 以 **MIT License** 开源发布。

---

## 致谢

感谢所有让 OpenAgents 成为现实的开源项目与贡献者，我们始终站在巨人的肩膀上前进。

### 核心框架
- **[LangChain](https://github.com/langchain-ai/langchain)**：为我们的 LLM 交互与链式能力提供基础。
- **[LangGraph](https://github.com/langchain-ai/langgraph)**：支撑复杂的多智能体编排流程。
- **[Vite](https://vite.dev/)**：驱动前端应用的现代化构建工具。

### UI 库
- **[Shadcn](https://ui.shadcn.com/)**：为我们的界面提供简洁高效的组件基础。
- **[SToneX](https://github.com/stonexer)**：感谢他对逐 token 视觉效果的宝贵贡献。

这些优秀项目共同构成了 OpenAgents 的基础，也体现了开源协作的力量。

### 特别感谢
最后，特别感谢 OpenAgents 的核心作者：

- **[Daniel Walnut](https://github.com/hetaoBackend/)**
- **[Henry Li](https://github.com/magiccube/)**

没有他们的愿景、热情与投入，\`OpenAgents\` 不会成为今天的样子。
`,
} as const;

export function getAboutMarkdown(locale: Locale) {
  return aboutMarkdown[locale];
}
