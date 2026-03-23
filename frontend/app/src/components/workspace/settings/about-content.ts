import {
  GITHUB_REPO_URL,
  OFFICIAL_WEBSITE_URL,
  PUBLIC_GITHUB_REPO_AVAILABLE,
} from "@/core/config/site";

const projectLinksSection = PUBLIC_GITHUB_REPO_AVAILABLE
  ? `## 🌟 GitHub Repository

![Star History Chart](https://api.star-history.com/svg?repos=bytedance/openagents&type=Date)

Explore OpenAgents on GitHub: [github.com/bytedance/openagents](${GITHUB_REPO_URL})

## 🌐 Official Website

Visit the official website of OpenAgents: [openagents.dev](${OFFICIAL_WEBSITE_URL})`
  : `## 🌐 Official Website

Visit the official website of OpenAgents: [openagents.dev](${OFFICIAL_WEBSITE_URL})`;

export const aboutMarkdown = `# [About OpenAgents](${OFFICIAL_WEBSITE_URL})

> **From Open Source, Back to Open Source**

OpenAgents is an open-source **super agent harness** that orchestrates **sub-agents**, **memory**, and **sandboxes** to do almost anything — powered by **extensible skills**.

---

## 🚀 Core Features

* **Skills & Tools**: With built-in and extensible skills and tools, OpenAgents can do almost anything.
* **Sub-Agents**: Sub-Agents help the main agent to do the tasks that are too complex to be done by the main agent.
* **Sandbox & File System**: Safely execute code and manipulate files in the sandbox.
* **Context Engineering**: Isolated sub-agent context, summarization to keep the context window sharp.
* **Long-Term Memory**: Keep recording the user's profile, top of mind, and conversation history.

---

${projectLinksSection}

---

## 📜 License

OpenAgents is proudly open source and distributed under the **MIT License**.

---

## 🙌 Acknowledgments

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
`;
