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
  readOnlyBadge: string;
  readOnlyTitle: string;
  readOnlyDescription: string;
  readOnlyFooter: string;
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
  copiedSkillsDescriptionProd: string;
  copiedSkillsDescriptionDev: string;
  loadingSkills: string;
  loadSkillsFailed: string;
  noSkillsInScope: string;
  disabledBadge: string;
  attachedBadge: string;
  duplicateNameHint: (names: string) => string;
  selectedSkillsTitle: string;
  selectedSkillsDescription: string;
  remove: string;
  noSelectedSkills: string;
  selectionRulesTitle: string;
  selectionRulesDescription: string;
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
  mainToolsTitle: string;
  mainToolsDescription: string;
  explicitMainTools: string;
  explicitMainToolsDescription: string;
  loadingToolCatalog: string;
  loadToolCatalogFailed: string;
  noConfigurableTools: string;
  mainToolsFallbackHint: string;
  generalPurposeSubagentTitle: string;
  generalPurposeSubagentDescription: string;
  enableGeneralPurposeSubagent: string;
  enableGeneralPurposeSubagentDescription: string;
  inheritMainTools: string;
  inheritMainToolsDescription: string;
  noSubagentTools: string;
  customSubagentsTitle: string;
  customSubagentsDescription: string;
  customSubagentsHint: string;
  addSubagent: string;
  noCustomSubagents: string;
  subagentCardTitle: (index: number) => string;
  subagentCardDescription: string;
  subagentNameLabel: string;
  subagentNamePlaceholder: string;
  subagentDescriptionPlaceholder: string;
  subagentPromptLabel: string;
  subagentPromptPlaceholder: string;
  explicitSubagentTools: string;
  explicitSubagentToolsDescription: string;
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
  openApiPlaygroundDescription: string;
  openApiOpenPlayground: string;
  openApiCapabilityUploads: string;
  openApiCapabilityEvents: string;
  openApiCapabilityJson: string;
  loadingExportDocument: string;
  loadExportDocumentFailed: string;
  developerConsoleUrl: string;
  developerConsoleIncludes: string;
  developerConsoleUrlCopied: string;
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
  memoryModelRequired: string;
  enabledState: string;
  subagentNameRequired: (index: number) => string;
  duplicateSubagentName: (name: string) => string;
  subagentDescriptionRequired: (name: string) => string;
  subagentPromptRequired: (name: string) => string;
  saveSuccess: (name: string, status: string) => string;
  saveFailed: string;
  mustBeInteger: (label: string) => string;
  mustBeNumber: (label: string) => string;
};

const enUS: AgentSettingsDialogText = {
  headerEyebrow: "Agent Settings",
  headerDescription:
    "Adjust how this agent behaves in your workspace, what it can use, and how it can be published. Advanced archive controls live in the last tab.",
  remoteCliBadge: "remote cli",
  openWorkspace: "Open workspace",
  copyUrl: "Copy URL",
  loading: "Loading archived agent settings...",
  loadErrorTitle: "Archive unavailable",
  loadErrorDescription:
    "The selected archived agent could not be loaded from the gateway.",
  readOnlyBadge: "read only",
  readOnlyTitle: "Management restricted",
  readOnlyDescription:
    "You can use this agent, but only its creator or an admin can change archive settings, publish, delete, or export it.",
  readOnlyFooter:
    "Save is disabled because you do not have permission to manage this agent.",
  unknownError: "Unknown error",
  selectArchive: "Select an agent archive to configure.",
  tabs: {
    profile: "Profile",
    skills: "Skills",
    prompt: "Advanced",
    config: "Config",
    access: "Share",
  },
  identityTitle: "Identity",
  identityDescription:
    "Define how this archived agent should be described and targeted.",
  capabilitiesTitle: "Capabilities",
  capabilitiesDescription:
    "Keep everyday integration controls here. Tool access is managed from the picker on the Config tab.",
  archiveContextTitle: "Current version",
  archiveContextDescription:
    "A quick read on the version you are editing right now.",
  copiedSkillsCount: (count) =>
    `${count} copied skill${count === 1 ? "" : "s"}`,
  leadAgentArchiveNote:
    "`lead_agent` stays the built-in orchestration entrypoint. The generic system prompt remains in backend code; this dialog edits only the archived lead-agent-owned prompt and config.",
  noCopiedSkillsAttached: "No copied skills are attached to this archive.",
  copiedSkillsTitle: "Copied skills",
  copiedSkillsDescriptionProd:
    "Prod archives can attach built-in system skills, custom archived skills, and prod-store skills.",
  copiedSkillsDescriptionDev:
    "Dev archives can attach built-in system skills, custom archived skills, and both dev/prod store skills. When the same name exists in multiple sources, choose the exact source you want to copy.",
  loadingSkills: "Loading skill catalog...",
  loadSkillsFailed: "Failed to load skills",
  noSkillsInScope: "No skills are available in this archive scope.",
  disabledBadge: "disabled",
  attachedBadge: "attached",
  duplicateNameHint: (names) =>
    `The same skill name exists in multiple archived sources: ${names}. Choose the exact source tab you want to copy from.`,
  selectedSkillsTitle: "Selected archive skills",
  selectedSkillsDescription:
    "These copied skills are written into the archive's `skills/` directory on save.",
  remove: "remove",
  noSelectedSkills: "No copied skills selected for this archive.",
  selectionRulesTitle: "Selection rules",
  selectionRulesDescription:
    "Skill sources stay in the archived libraries; this dialog only decides what gets copied into this agent.",
  selectionRulesProd:
    "Prod archives may use `system`, `custom`, and `store/prod` skills. If a skill only exists in `store/dev`, publish it to prod before publishing the agent.",
  selectionRulesDev:
    "Dev archives may use `system`, `custom`, `store/dev`, and `store/prod`. The dialog saves the exact `source_path`, so the selected archived source stays stable when names overlap.",
  promptTitle: "Advanced instructions",
  promptDescription:
    "Optional. Use this only when you need to tune deeper agent behavior for this version.",
  promptBody: "Custom instructions",
  promptPlaceholder: "Write deeper guidance for this agent here.",
  runtimeContract: "Runtime path",
  runtimeContractIntro:
    "These instructions are copied into the runtime workspace at:",
  editingScope: "Use this for",
  editingScopeDescription:
    "Keep high-level behavior, decomposition guidance, and special policies here. Everyday tool access and skills belong in the other tabs.",
  memoryTitle: "Memory capture",
  memoryDescription:
    "Structure the archived memory policy instead of editing raw YAML.",
  mainToolsTitle: "Main agent tools",
  mainToolsDescription:
    "Pick the tools this agent can use from a grouped checklist. The dialog saves the selection for you.",
  explicitMainTools: "Use explicit tool selection",
  explicitMainToolsDescription:
    "When enabled, `tool_names` takes precedence over `tool_groups` in the archived manifest.",
  loadingToolCatalog: "Loading tool catalog...",
  loadToolCatalogFailed: "Failed to load tool catalog.",
  noConfigurableTools: "No configurable archive tools are available.",
  mainToolsFallbackHint:
    "Legacy `tool_groups` remain active until you switch this archive to explicit tool selection.",
  generalPurposeSubagentTitle: "General-purpose subagent",
  generalPurposeSubagentDescription:
    "Control the built-in DeepAgents subagent separately from the main archive tool allowlist.",
  enableGeneralPurposeSubagent: "Enable general-purpose subagent",
  enableGeneralPurposeSubagentDescription:
    "Disable this when the archive should never expose the default catch-all subagent.",
  inheritMainTools: "Inherit main-agent tools",
  inheritMainToolsDescription:
    "Keep DeepAgents default inheritance, but still remove main-agent-only tools such as question.",
  noSubagentTools: "No subagent-safe archive tools are available.",
  customSubagentsTitle: "Custom subagents",
  customSubagentsDescription:
    "Each entry becomes a structured record in `subagents.yaml` and is loaded by the runtime task middleware.",
  customSubagentsHint:
    "Custom subagents stay stateless. Give each one a clear name, delegation description, prompt, and optional tool override.",
  addSubagent: "Add subagent",
  noCustomSubagents: "No custom subagents are configured for this archive yet.",
  subagentCardTitle: (index) => `Subagent ${index}`,
  subagentCardDescription:
    "These settings apply only to the selected subagent definition.",
  subagentNameLabel: "Subagent name",
  subagentNamePlaceholder: "researcher / reviewer / explorer",
  subagentDescriptionPlaceholder:
    "Explain when the main agent should delegate work to this subagent.",
  subagentPromptLabel: "System prompt",
  subagentPromptPlaceholder:
    "Write the subagent-specific instructions that should run inside its isolated context.",
  explicitSubagentTools: "Use explicit subagent tools",
  explicitSubagentToolsDescription:
    "If disabled, this subagent inherits the main archive tool set after main-agent-only tools are removed.",
  enableMemory: "Enable memory",
  enableMemoryDescription: "User-scoped memory is stored per agent archive.",
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
  openApiExportTitle: "Developer docs",
  openApiExportDescription:
    "External callers only need `base_url`, `api_key`, and `model=<agent_name>`. Published prod agents expose that shareable OpenAI-compatible developer console here.",
  openApiExportUnavailableDescription:
    "External invocation is only available after publishing this agent to prod.",
  openApiPlaygroundDescription:
    "Open the standalone developer console to create a scoped key, upload files, inspect event flow, and validate structured JSON responses.",
  openApiOpenPlayground: "Open developer console",
  openApiCapabilityUploads: "Real `/v1/files` upload flow",
  openApiCapabilityEvents: "Request timeline and generated artifacts",
  openApiCapabilityJson: "Text, JSON object, and JSON schema testing",
  loadingExportDocument: "Loading export document...",
  loadExportDocumentFailed: "Failed to load export document.",
  developerConsoleUrl: "Developer console URL",
  developerConsoleIncludes:
    "Base URL, model value, SDK snippets, live `/v1` testing, files, events, and schema browsing all live inside this single console.",
  developerConsoleUrlCopied: "Developer console URL copied",
  publishArchiveFirst:
    "Publish this archive first if you want a stable `/v1/responses` contract for external integrations.",
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
  memoryModelRequired: "Memory model is required when memory is enabled.",
  enabledState: "Enabled",
  subagentNameRequired: (index) =>
    `Subagent ${index} requires a name before saving.`,
  duplicateSubagentName: (name) => `Subagent name '${name}' is duplicated.`,
  subagentDescriptionRequired: (name) =>
    `Subagent '${name}' requires a description.`,
  subagentPromptRequired: (name) =>
    `Subagent '${name}' requires a system prompt.`,
  saveSuccess: (name, status) => `${name} (${status}) saved`,
  saveFailed: "Failed to save agent settings",
  mustBeInteger: (label) => `${label} must be an integer.`,
  mustBeNumber: (label) => `${label} must be a number.`,
};

const zhCN: AgentSettingsDialogText = {
  headerEyebrow: "智能体设置",
  headerDescription:
    "调整这个智能体在工作区里的行为、可用能力和发布方式。更底层的归档控制统一收在最后的高级页。",
  remoteCliBadge: "远程 CLI",
  openWorkspace: "打开工作区",
  copyUrl: "复制链接",
  loading: "正在加载归档智能体设置...",
  loadErrorTitle: "归档不可用",
  loadErrorDescription: "无法从网关加载所选的归档智能体。",
  readOnlyBadge: "只读",
  readOnlyTitle: "管理受限",
  readOnlyDescription:
    "你仍然可以使用这个智能体，但只有创建者或管理员可以修改归档设置、发布、删除或导出它。",
  readOnlyFooter: "你没有管理这个智能体的权限，因此保存已被禁用。",
  unknownError: "未知错误",
  selectArchive: "请选择一个要配置的智能体归档。",
  tabs: {
    profile: "资料",
    skills: "技能",
    prompt: "高级",
    config: "配置",
    access: "分享",
  },
  identityTitle: "身份信息",
  identityDescription: "定义这个归档智能体的定位、描述和目标。",
  capabilitiesTitle: "能力配置",
  capabilitiesDescription:
    "这里保留日常集成控制项；工具权限请直接在“配置”页用勾选列表管理。",
  archiveContextTitle: "当前版本",
  archiveContextDescription: "快速查看你当前正在编辑的这个版本。",
  copiedSkillsCount: (count) => `已复制 ${count} 个技能`,
  leadAgentArchiveNote:
    "`lead_agent` 仍然是内置编排入口。通用系统提示词继续保留在后端代码中；这里编辑的只是归档里属于 lead_agent 的提示词和配置。",
  noCopiedSkillsAttached: "这个归档当前还没有挂载任何已复制技能。",
  copiedSkillsTitle: "复制技能",
  copiedSkillsDescriptionProd:
    "生产归档可以挂载内置 system 技能、自定义归档技能，以及 prod 仓库技能。",
  copiedSkillsDescriptionDev:
    "开发归档可以挂载内置 system 技能、自定义归档技能，以及 dev/prod 仓库技能；如果多个来源里有同名技能，请选择你要复制的具体来源。",
  loadingSkills: "正在加载技能目录...",
  loadSkillsFailed: "加载技能失败",
  noSkillsInScope: "当前归档范围内没有可用技能。",
  disabledBadge: "已禁用",
  attachedBadge: "已挂载",
  duplicateNameHint: (names) =>
    `多个归档来源中存在同名技能：${names}。请通过上方来源标签选择具体版本。`,
  selectedSkillsTitle: "已选择的归档技能",
  selectedSkillsDescription:
    "这些已复制技能会在保存时写入归档目录下的 `skills/`。",
  remove: "移除",
  noSelectedSkills: "这个归档当前还没有选中任何复制技能。",
  selectionRulesTitle: "选择规则",
  selectionRulesDescription:
    "技能源仍保留在归档技能库中；这个对话框只决定哪些技能会被复制进当前智能体。",
  selectionRulesProd:
    "生产归档可以使用 `system`、`custom` 和 `store/prod` 技能。如果某个技能只存在于 `store/dev`，请先发布到 prod 再发布智能体。",
  selectionRulesDev:
    "开发归档可以同时使用 `system`、`custom`、`store/dev` 和 `store/prod`。系统会保存精确的 `source_path`，所以同名技能也能稳定指向你当前选中的来源版本。",
  promptTitle: "高级指令",
  promptDescription:
    "可选。只有在你确实需要微调这个版本的深层行为时再修改这里。",
  promptBody: "自定义指令",
  promptPlaceholder: "在这里填写更深层的智能体行为指导。",
  runtimeContract: "运行时路径",
  runtimeContractIntro: "这些指令会被复制到运行时工作区中的：",
  editingScope: "适合放什么",
  editingScopeDescription:
    "这里更适合放高层行为、任务拆解方式和特殊策略。日常工具权限与技能选择请在其他标签页里处理。",
  memoryTitle: "记忆采集",
  memoryDescription:
    "通过结构化方式管理归档记忆策略，而不是直接编辑原始 YAML。",
  mainToolsTitle: "主智能体工具",
  mainToolsDescription:
    "直接从分组工具列表里勾选这个智能体能使用的工具，保存时会自动写入对应配置。",
  explicitMainTools: "使用显式工具选择",
  explicitMainToolsDescription:
    "开启后，归档中的 `tool_names` 会优先于 `tool_groups` 生效。",
  loadingToolCatalog: "正在加载工具目录...",
  loadToolCatalogFailed: "加载工具目录失败。",
  noConfigurableTools: "当前没有可配置的归档工具。",
  mainToolsFallbackHint:
    "在你切换到显式工具选择之前，旧的 `tool_groups` 仍然会继续生效。",
  generalPurposeSubagentTitle: "通用 subagent",
  generalPurposeSubagentDescription:
    "把内置 DeepAgents 通用子智能体和主归档工具白名单分开控制。",
  enableGeneralPurposeSubagent: "启用通用 subagent",
  enableGeneralPurposeSubagentDescription:
    "如果这个归档不应该暴露默认兜底 subagent，可以在这里关闭。",
  inheritMainTools: "继承主智能体工具",
  inheritMainToolsDescription:
    "保持 DeepAgents 默认继承语义，但仍会去掉只能主 agent 使用的工具。",
  noSubagentTools: "当前没有可供 subagent 使用的安全归档工具。",
  customSubagentsTitle: "自定义 subagent",
  customSubagentsDescription:
    "这里的每一项都会写入 `subagents.yaml`，并由运行时 task middleware 加载。",
  customSubagentsHint:
    "自定义 subagent 是无状态的。请为它提供明确的名称、委派描述、提示词，以及可选的工具覆盖。",
  addSubagent: "新增 subagent",
  noCustomSubagents: "当前归档还没有自定义 subagent。",
  subagentCardTitle: (index) => `子智能体 ${index}`,
  subagentCardDescription: "这些设置只作用于当前这条 subagent 定义。",
  subagentNameLabel: "子智能体名称",
  subagentNamePlaceholder: "researcher / reviewer / explorer",
  subagentDescriptionPlaceholder:
    "说明主智能体应该在什么场景下把工作委派给它。",
  subagentPromptLabel: "系统提示词",
  subagentPromptPlaceholder:
    "填写这个 subagent 在隔离上下文里执行时应遵循的指令。",
  explicitSubagentTools: "使用显式 subagent 工具",
  explicitSubagentToolsDescription:
    "关闭后，这个 subagent 会继承主归档工具集，并自动移除主 agent 专属工具。",
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
  launchSurfaceDescription:
    "分享或测试时，直接使用当前归档和运行时选择生成的精确入口。",
  launchUrl: "启动链接",
  openApiExportTitle: "开发者文档",
  openApiExportDescription:
    "外部调用方只需要 `base_url`、`api_key` 和 `model=<agent_name>`。已发布到 prod 的智能体会在这里暴露可直接分享的 OpenAI 兼容开发者控制台。",
  openApiExportUnavailableDescription:
    "只有将该智能体发布到 prod 后，才支持外部调用。",
  openApiPlaygroundDescription:
    "打开独立开发者控制台，创建 scoped key、上传文件、查看事件流，并验证结构化 JSON 返回。",
  openApiOpenPlayground: "打开开发者控制台",
  openApiCapabilityUploads: "真实 `/v1/files` 上传链路",
  openApiCapabilityEvents: "请求时间线与生成文件",
  openApiCapabilityJson: "纯文本、JSON 对象、JSON Schema 测试",
  loadingExportDocument: "正在加载导出文档...",
  loadExportDocumentFailed: "加载导出文档失败。",
  developerConsoleUrl: "开发者控制台地址",
  developerConsoleIncludes:
    "Base URL、model 取值、SDK 示例、真实 `/v1` 测试、文件、事件和 schema 浏览，全部统一在这个控制台里。",
  developerConsoleUrlCopied: "已复制开发者控制台地址",
  publishArchiveFirst:
    "如果你需要用于企业接入的稳定 `/v1/responses` 契约，请先发布这个归档。",
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
  memoryModelRequired: "启用记忆时必须填写记忆模型。",
  enabledState: "已启用",
  subagentNameRequired: (index) =>
    `保存前必须填写第 ${index} 个子智能体的名称。`,
  duplicateSubagentName: (name) => `子智能体名称“${name}”重复了。`,
  subagentDescriptionRequired: (name) => `子智能体“${name}”必须填写描述。`,
  subagentPromptRequired: (name) => `子智能体“${name}”必须填写系统提示词。`,
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
