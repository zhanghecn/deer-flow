import type { Locale } from "@/core/i18n";

type AgentSettingsDialogText = {
  headerEyebrow: string;
  headerDescription: string;
  remoteCliBadge: string;
  openWorkspace: string;
  copyUrl: string;
  loading: string;
  loadErrorTitle: string;
  loadErrorDescription: string;
  unknownError: string;
  selectArchive: string;
  tabs: {
    profile: string;
    skills: string;
    prompt: string;
    config: string;
    access: string;
  };
  identityTitle: string;
  identityDescription: string;
  capabilitiesTitle: string;
  capabilitiesDescription: string;
  archiveContextTitle: string;
  archiveContextDescription: string;
  copiedSkillsCount: (count: number) => string;
  leadAgentArchiveNote: string;
  noCopiedSkillsAttached: string;
  copiedSkillsTitle: string;
  copiedSkillsDescriptionShared: string;
  copiedSkillsDescriptionProd: string;
  copiedSkillsDescriptionDev: string;
  loadingSkills: string;
  loadSkillsFailed: string;
  noSkillsInScope: string;
  disabledBadge: string;
  attachedBadge: string;
  hiddenDuplicateNames: (names: string) => string;
  selectedSkillsTitle: string;
  selectedSkillsDescription: string;
  remove: string;
  noSelectedSkills: string;
  selectionRulesTitle: string;
  selectionRulesDescription: string;
  selectionRulesLeadAgent: string;
  selectionRulesProd: string;
  selectionRulesDev: string;
  promptTitle: string;
  promptDescription: string;
  promptBody: string;
  promptPlaceholder: string;
  runtimeContract: string;
  runtimeContractIntro: string;
  editingScope: string;
  editingScopeDescription: string;
  memoryTitle: string;
  memoryDescription: string;
  enableMemory: string;
  enableMemoryDescription: string;
  memoryModel: string;
  memoryModelPlaceholder: string;
  debounceSeconds: string;
  maxFacts: string;
  confidenceThreshold: string;
  promptInjectionTitle: string;
  promptInjectionDescription: string;
  enableMemoryInjection: string;
  enableMemoryInjectionDescription: string;
  maxInjectionTokens: string;
  whyNoRawYaml: string;
  whyNoRawYamlDescription: string;
  launchSurfaceTitle: string;
  launchSurfaceDescription: string;
  launchUrl: string;
  openApiExportTitle: string;
  openApiExportDescription: string;
  openApiExportUnavailableDescription: string;
  loadingExportDocument: string;
  loadExportDocumentFailed: string;
  gatewayBase: string;
  copyChatEndpoint: string;
  copyStreamEndpoint: string;
  downloadReactDemo: string;
  demoNotes: string;
  publishArchiveFirst: string;
  archiveAssetsTitle: string;
  archiveAssetsDescription: string;
  agentsMd: string;
  agentsMdDescription: string;
  configYaml: string;
  configYamlDescription: string;
  skillsDirectory: string;
  skillsDirectoryDescription: string;
  editableBadge: string;
  structuredBadge: string;
  exportBehaviorTitle: string;
  exportBehaviorDescription: string;
  exportBehaviorBody: string;
  dirtyState: string;
  cleanState: string;
  saveAppliesTo: (status: string) => string;
  reset: string;
  saveChanges: string;
  agentName: string;
  modelOverride: string;
  description: string;
  toolGroups: string;
  mcpServers: string;
  optionalModelId: string;
  descriptionPlaceholder: string;
  toolGroupsPlaceholder: string;
  toolGroupsHint: string;
  mcpServersPlaceholder: string;
  mcpServersHint: string;
  copyFailed: string;
  launchUrlCopied: string;
  downloadFailed: string;
  downloadSuccess: (filename: string) => string;
  chatEndpointCopied: string;
  streamEndpointCopied: string;
  memoryModelRequired: string;
  saveSuccess: (name: string, status: string) => string;
  saveFailed: string;
  mustBeInteger: (label: string) => string;
  mustBeNumber: (label: string) => string;
};

const enUS: AgentSettingsDialogText = {
  headerEyebrow: "Agent Settings",
  headerDescription:
    "Edit the archived agent profile, its private `AGENTS.md`, and the structured config that becomes `config.yaml`.",
  remoteCliBadge: "remote cli",
  openWorkspace: "Open workspace",
  copyUrl: "Copy URL",
  loading: "Loading archived agent settings...",
  loadErrorTitle: "Archive unavailable",
  loadErrorDescription:
    "The selected archived agent could not be loaded from the gateway.",
  unknownError: "Unknown error",
  selectArchive: "Select an agent archive to configure.",
  tabs: {
    profile: "Profile",
    skills: "Skills",
    prompt: "Prompt",
    config: "Config",
    access: "Access",
  },
  identityTitle: "Identity",
  identityDescription:
    "Define how this archived agent should be described and targeted.",
  capabilitiesTitle: "Capabilities",
  capabilitiesDescription:
    "Keep the fast controls here; skill authoring still belongs to the create-agent flow.",
  archiveContextTitle: "Archive context",
  archiveContextDescription:
    "A quick read on the currently loaded agent archive.",
  copiedSkillsCount: (count) =>
    `${count} copied skill${count === 1 ? "" : "s"}`,
  leadAgentArchiveNote:
    "`lead_agent` stays the built-in orchestration entrypoint. The generic system prompt remains in backend code; this dialog edits only the archived lead-agent-owned prompt and config.",
  noCopiedSkillsAttached: "No copied skills are attached to this archive.",
  copiedSkillsTitle: "Copied skills",
  copiedSkillsDescriptionShared:
    "Attach archived skills from shared, dev, or prod stores to this agent archive.",
  copiedSkillsDescriptionProd:
    "Prod archives can only attach skills from the prod store.",
  copiedSkillsDescriptionDev:
    "Dev archives can attach skills from dev and prod stores, but duplicate names across both stores are blocked.",
  loadingSkills: "Loading skill catalog...",
  loadSkillsFailed: "Failed to load skills",
  noSkillsInScope: "No skills are available in this archive scope.",
  disabledBadge: "disabled",
  attachedBadge: "attached",
  hiddenDuplicateNames: (names) =>
    `Hidden duplicate names across \`store/dev\` and \`store/prod\`: ${names}`,
  selectedSkillsTitle: "Selected archive skills",
  selectedSkillsDescription:
    "These copied skills are written into the archive's `skills/` directory on save.",
  remove: "remove",
  noSelectedSkills: "No copied skills selected for this archive.",
  selectionRulesTitle: "Selection rules",
  selectionRulesDescription:
    "Skill sources stay in the shared archives; this dialog only decides what gets copied into this agent.",
  selectionRulesLeadAgent:
    "`lead_agent` may still use `shared` building blocks. Other archived agents should prefer the dev/prod stores.",
  selectionRulesProd:
    "Prod archives must use `store/prod` skills. If a dev-only skill is still attached, publish that skill to prod before publishing the agent.",
  selectionRulesDev:
    "Dev archives may use both `store/dev` and `store/prod`, but names that exist in both stores are intentionally blocked to avoid ambiguous selection.",
  promptTitle: "Archived AGENTS.md",
  promptDescription:
    "This prompt lives with the agent archive and is materialized into the runtime copy for each thread.",
  promptBody: "Prompt body",
  promptPlaceholder: "Write the agent-owned instructions here.",
  runtimeContract: "Runtime contract",
  runtimeContractIntro: "The archived prompt is copied into:",
  editingScope: "Editing scope",
  editingScopeDescription:
    "Keep the generic orchestrator rules in backend code. Put only agent-owned domain behavior, decomposition guidance, and skill usage policy in this file.",
  memoryTitle: "Memory capture",
  memoryDescription:
    "Structure the archived memory policy instead of editing raw YAML.",
  enableMemory: "Enable memory",
  enableMemoryDescription:
    "User-scoped memory is stored per agent archive.",
  memoryModel: "Memory model",
  memoryModelPlaceholder: "Required when memory is enabled",
  debounceSeconds: "Debounce seconds",
  maxFacts: "Max facts",
  confidenceThreshold: "Confidence threshold",
  promptInjectionTitle: "Prompt injection",
  promptInjectionDescription:
    "These controls map directly onto the archived config manifest.",
  enableMemoryInjection: "Enable memory injection",
  enableMemoryInjectionDescription:
    "Inject retrieved memory back into the runtime prompt.",
  maxInjectionTokens: "Max injection tokens",
  whyNoRawYaml: "Why no raw YAML?",
  whyNoRawYamlDescription:
    "`config.yaml` remains the archived manifest, but this workspace uses structured controls so the common settings stay legible and harder to break.",
  launchSurfaceTitle: "Launch surface",
  launchSurfaceDescription:
    "Use the exact current archive and runtime selection when sharing or testing.",
  launchUrl: "Launch URL",
  openApiExportTitle: "Open API export",
  openApiExportDescription:
    "Published prod agents can be invoked outside the platform and exported as a local React demo.",
  openApiExportUnavailableDescription:
    "External invocation and demo download are only available after publishing this agent to prod.",
  loadingExportDocument: "Loading export document...",
  loadExportDocumentFailed: "Failed to load export document.",
  gatewayBase: "Gateway base",
  copyChatEndpoint: "Copy chat endpoint",
  copyStreamEndpoint: "Copy stream endpoint",
  downloadReactDemo: "Download React demo",
  demoNotes: "Demo notes",
  publishArchiveFirst:
    "Publish this archive first if you want a stable `/open/v1/agents/{agentName}` endpoint or a downloadable React demo bundle for local testing.",
  archiveAssetsTitle: "Archive assets",
  archiveAssetsDescription:
    "A compact map of what this settings dialog can control today.",
  agentsMd: "AGENTS.md",
  agentsMdDescription: "Editable from the Prompt tab.",
  configYaml: "config.yaml",
  configYamlDescription: "Managed from the Config tab.",
  skillsDirectory: "skills/",
  skillsDirectoryDescription: "Current copied skills are shown in Profile.",
  editableBadge: "editable",
  structuredBadge: "structured",
  exportBehaviorTitle: "Export behavior",
  exportBehaviorDescription:
    "What the current export workflow does when you download the React demo.",
  exportBehaviorBody:
    "The download action calls the protected gateway export endpoint, creates a short-lived API token, and writes the resolved base URL, agent name, and token into the generated Vite project so the demo can run outside this platform.",
  dirtyState: "Unsaved archive changes",
  cleanState: "Archive is up to date",
  saveAppliesTo: (status) =>
    `Save applies to the currently selected ${status} archive only.`,
  reset: "Reset",
  saveChanges: "Save changes",
  agentName: "Agent name",
  modelOverride: "Model override",
  description: "Description",
  toolGroups: "Tool groups",
  mcpServers: "MCP servers",
  optionalModelId: "Optional model id",
  descriptionPlaceholder:
    "Summarize what this agent owns and what it should optimize for.",
  toolGroupsPlaceholder: "browser, filesystem, office",
  toolGroupsHint:
    "Comma separated. Leave blank to keep the current unrestricted default.",
  mcpServersPlaceholder: "notion, github, slack",
  mcpServersHint:
    "Comma separated. These values are stored in the archived manifest.",
  copyFailed: "Failed to copy text",
  launchUrlCopied: "Agent launch URL copied",
  downloadFailed: "Failed to download React demo",
  downloadSuccess: (filename) => `${filename} downloaded`,
  chatEndpointCopied: "Chat endpoint copied",
  streamEndpointCopied: "Stream endpoint copied",
  memoryModelRequired: "Memory model is required when memory is enabled.",
  saveSuccess: (name, status) => `${name} (${status}) saved`,
  saveFailed: "Failed to save agent settings",
  mustBeInteger: (label) => `${label} must be an integer.`,
  mustBeNumber: (label) => `${label} must be a number.`,
};

const zhCN: AgentSettingsDialogText = {
  headerEyebrow: "智能体设置",
  headerDescription:
    "编辑归档智能体的资料、私有 `AGENTS.md`，以及最终生成 `config.yaml` 的结构化配置。",
  remoteCliBadge: "远程 CLI",
  openWorkspace: "打开工作区",
  copyUrl: "复制链接",
  loading: "正在加载归档智能体设置...",
  loadErrorTitle: "归档不可用",
  loadErrorDescription: "无法从网关加载所选的归档智能体。",
  unknownError: "未知错误",
  selectArchive: "请选择一个要配置的智能体归档。",
  tabs: {
    profile: "资料",
    skills: "技能",
    prompt: "提示词",
    config: "配置",
    access: "访问",
  },
  identityTitle: "身份信息",
  identityDescription: "定义这个归档智能体的定位、描述和目标。",
  capabilitiesTitle: "能力配置",
  capabilitiesDescription:
    "这里保留高频控制项；skill 的编写流程仍应放在 create-agent 流程中完成。",
  archiveContextTitle: "归档上下文",
  archiveContextDescription: "快速查看当前加载的智能体归档信息。",
  copiedSkillsCount: (count) => `已复制 ${count} 个技能`,
  leadAgentArchiveNote:
    "`lead_agent` 仍然是内置编排入口。通用系统提示词继续保留在后端代码中；这里编辑的只是归档里属于 lead_agent 的提示词和配置。",
  noCopiedSkillsAttached: "这个归档当前还没有挂载任何已复制技能。",
  copiedSkillsTitle: "复制技能",
  copiedSkillsDescriptionShared:
    "可将 shared、dev 或 prod 仓库中的归档技能挂到这个智能体归档上。",
  copiedSkillsDescriptionProd: "生产归档只能挂载来自 prod 仓库的技能。",
  copiedSkillsDescriptionDev:
    "开发归档可以挂载 dev 和 prod 仓库技能，但同名技能会被阻止以避免歧义。",
  loadingSkills: "正在加载技能目录...",
  loadSkillsFailed: "加载技能失败",
  noSkillsInScope: "当前归档范围内没有可用技能。",
  disabledBadge: "已禁用",
  attachedBadge: "已挂载",
  hiddenDuplicateNames: (names) =>
    `已隐藏 \`store/dev\` 与 \`store/prod\` 中的重名技能：${names}`,
  selectedSkillsTitle: "已选择的归档技能",
  selectedSkillsDescription:
    "这些已复制技能会在保存时写入归档目录下的 `skills/`。",
  remove: "移除",
  noSelectedSkills: "这个归档当前还没有选中任何复制技能。",
  selectionRulesTitle: "选择规则",
  selectionRulesDescription:
    "技能源仍保留在共享归档中；这个对话框只决定哪些技能会被复制进当前智能体。",
  selectionRulesLeadAgent:
    "`lead_agent` 仍可使用 `shared` 里的基础能力块；其他归档智能体应优先使用 dev/prod 仓库技能。",
  selectionRulesProd:
    "生产归档必须使用 `store/prod` 技能。如果当前仍依赖仅 dev 存在的技能，请先把该技能发布到 prod，再发布智能体。",
  selectionRulesDev:
    "开发归档可以同时使用 `store/dev` 和 `store/prod`，但如果两个仓库里存在同名技能，会被刻意屏蔽以避免选择歧义。",
  promptTitle: "归档 AGENTS.md",
  promptDescription:
    "这份提示词跟随智能体归档保存，并会在每个线程中物化到运行时副本。",
  promptBody: "提示词正文",
  promptPlaceholder: "在这里填写属于该智能体自己的指令。",
  runtimeContract: "运行时约定",
  runtimeContractIntro: "归档提示词会被复制到：",
  editingScope: "编辑范围",
  editingScopeDescription:
    "通用编排规则仍保留在后端代码中。这个文件里只放该智能体自己的领域行为、拆解策略和 skill 使用策略。",
  memoryTitle: "记忆采集",
  memoryDescription: "通过结构化方式管理归档记忆策略，而不是直接编辑原始 YAML。",
  enableMemory: "启用记忆",
  enableMemoryDescription: "用户级记忆会按智能体归档分别存储。",
  memoryModel: "记忆模型",
  memoryModelPlaceholder: "启用记忆后为必填项",
  debounceSeconds: "防抖秒数",
  maxFacts: "最大事实数",
  confidenceThreshold: "置信度阈值",
  promptInjectionTitle: "提示词注入",
  promptInjectionDescription: "这些控制项会直接映射到归档配置清单中。",
  enableMemoryInjection: "启用记忆注入",
  enableMemoryInjectionDescription: "把检索到的记忆重新注入到运行时提示词中。",
  maxInjectionTokens: "注入最大 Token 数",
  whyNoRawYaml: "为什么不直接编辑 YAML？",
  whyNoRawYamlDescription:
    "`config.yaml` 仍然是归档配置清单，但这个工作区改用结构化控件，让常用设置更清晰，也更不容易被改坏。",
  launchSurfaceTitle: "启动入口",
  launchSurfaceDescription: "分享或测试时，直接使用当前归档和运行时选择生成的精确入口。",
  launchUrl: "启动链接",
  openApiExportTitle: "Open API 导出",
  openApiExportDescription:
    "已发布到 prod 的智能体可以在平台外调用，也可以导出为本地 React Demo。",
  openApiExportUnavailableDescription:
    "只有将该智能体发布到 prod 后，才支持外部调用和 Demo 下载。",
  loadingExportDocument: "正在加载导出文档...",
  loadExportDocumentFailed: "加载导出文档失败。",
  gatewayBase: "网关地址",
  copyChatEndpoint: "复制 chat 接口",
  copyStreamEndpoint: "复制 stream 接口",
  downloadReactDemo: "下载 React Demo",
  demoNotes: "Demo 说明",
  publishArchiveFirst:
    "如果你需要稳定的 `/open/v1/agents/{agentName}` 接口，或用于本地测试的可下载 React Demo 包，请先发布这个归档。",
  archiveAssetsTitle: "归档资产",
  archiveAssetsDescription: "概览当前设置对话框今天可以控制的内容。",
  agentsMd: "AGENTS.md",
  agentsMdDescription: "可在“提示词”页签中编辑。",
  configYaml: "config.yaml",
  configYamlDescription: "可在“配置”页签中管理。",
  skillsDirectory: "skills/",
  skillsDirectoryDescription: "当前已复制技能会显示在“资料”页签中。",
  editableBadge: "可编辑",
  structuredBadge: "结构化",
  exportBehaviorTitle: "导出行为",
  exportBehaviorDescription:
    "说明当前下载 React Demo 时，导出流程具体会做什么。",
  exportBehaviorBody:
    "下载操作会调用受保护的网关导出接口，创建一个短期有效的 API Token，并把解析后的基础地址、智能体名称和 Token 写入生成的 Vite 项目中，使该 Demo 能在平台外独立运行。",
  dirtyState: "归档有未保存更改",
  cleanState: "归档已是最新状态",
  saveAppliesTo: (status) => `保存只会应用到当前选中的 ${status} 归档。`,
  reset: "重置",
  saveChanges: "保存更改",
  agentName: "智能体名称",
  modelOverride: "模型覆盖",
  description: "描述",
  toolGroups: "工具组",
  mcpServers: "MCP 服务",
  optionalModelId: "可选模型 ID",
  descriptionPlaceholder: "概括这个智能体负责什么，以及它应该优先优化什么。",
  toolGroupsPlaceholder: "browser, filesystem, office",
  toolGroupsHint: "使用逗号分隔。留空则保留当前默认的无限制行为。",
  mcpServersPlaceholder: "notion, github, slack",
  mcpServersHint: "使用逗号分隔。这些值会存储在归档清单中。",
  copyFailed: "复制文本失败",
  launchUrlCopied: "已复制智能体启动链接",
  downloadFailed: "下载 React Demo 失败",
  downloadSuccess: (filename) => `已下载 ${filename}`,
  chatEndpointCopied: "已复制 chat 接口",
  streamEndpointCopied: "已复制 stream 接口",
  memoryModelRequired: "启用记忆时必须填写记忆模型。",
  saveSuccess: (name, status) => `${name}（${status}）已保存`,
  saveFailed: "保存智能体设置失败",
  mustBeInteger: (label) => `${label}必须是整数。`,
  mustBeNumber: (label) => `${label}必须是数字。`,
};

export function getAgentSettingsDialogText(
  locale: Locale,
): AgentSettingsDialogText {
  return locale === "zh-CN" ? zhCN : enUS;
}
