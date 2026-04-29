import type { Locale } from "@/core/i18n";

export type AgentSettingsPageText = {
  // Nav tabs
  tabIdentity: string;
  tabCapabilities: string;
  tabBehavior: string;
  tabIntegration: string;
  // Header
  backToGallery: string;
  unsavedChanges: string;
  allSaved: string;
  appliesToArchive: (status: string) => string;
  readOnly: string;
  reset: string;
  save: string;
  // Loading / error
  loading: string;
  loadError: string;
  noAgent: string;
  // Management restricted
  restrictedTitle: string;
  restrictedDescription: string;
  // Identity tab
  identityTitle: string;
  identityDescription: string;
  agentName: string;
  modelOverride: string;
  optionalModelId: string;
  description: string;
  descriptionPlaceholder: string;
  overviewTitle: string;
  skillsLabel: string;
  toolsLabel: string;
  subagentsLabel: string;
  mcpLabel: string;
  archiveContextTitle: string;
  archiveContextDescription: string;
  ownerBadge: string;
  leadAgentNote: string;
  noSkillsAttached: string;
  // Capabilities tab
  skillsTitle: string;
  skillsDescriptionProd: string;
  skillsDescriptionDev: string;
  loadingSkills: string;
  loadSkillsFailed: string;
  noSkillsInScope: string;
  searchSkills: string;
  noSkillsMatchSearch: string;
  disabledBadge: string;
  attachedBadge: string;
  duplicateNameHint: (names: string) => string;
  selectedSkills: string;
  noSelectedSkills: string;
  remove: string;
  previousPage: string;
  nextPage: string;
  pageStatus: (from: number, to: number, total: number) => string;
  toolsTitle: string;
  toolsDescription: string;
  editLabel: string;
  collapseLabel: string;
  noToolsSelected: string;
  moreCount: (count: number) => string;
  loadingTools: string;
  loadToolsFailed: string;
  noConfigurableTools: string;
  selectableToolsTitle: string;
  runtimeToolsTitle: string;
  runtimeToolsDescription: string;
  noRuntimeTools: string;
  runtimeInjectedBadge: string;
  filesystemMiddlewareTitle: string;
  filesystemMiddlewareDescription: string;
  subagentsTitle: string;
  subagentsDescription: string;
  generalPurposeTitle: string;
  enabledState: string;
  disabledState: string;
  inheritMainTools: string;
  inheritMainToolsDescription: string;
  customSubagents: string;
  addSubagent: string;
  noCustomSubagents: string;
  subagentExpand: string;
  subagentCollapse: string;
  subagentNameLabel: string;
  subagentNamePlaceholder: string;
  descriptionLabel: string;
  subagentDescriptionPlaceholder: string;
  subagentPromptLabel: string;
  subagentPromptPlaceholder: string;
  mcpTitle: string;
  mcpDescription: string;
  searchMcp: string;
  loadingMcp: string;
  loadMcpFailed: string;
  noMcpProfiles: string;
  mcpSelected: (count: number) => string;
  selectedMcpTitle: string;
  selectedMcpDescription: string;
  scanSelectedMcp: string;
  refreshMcpScan: string;
  scanningMcp: string;
  noSelectedMcp: string;
  mcpReachable: string;
  mcpUnreachable: string;
  mcpLatency: (latencyMs: number) => string;
  mcpToolCount: (count: number) => string;
  mcpNoDiscoveredTools: string;
  mcpAvailableTools: string;
  mcpInputSchema: string;
  mcpUnknownProfile: string;
  mcpProfileMissing: string;
  mcpNoDescription: string;
  mcpViewTools: string;
  mcpRemoveProfile: string;
  mcpDialogDescription: string;
  // Behavior tab
  promptTitle: string;
  promptDescription: string;
  promptHint: string;
  openWorkspace: string;
  editableBadge: string;
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
  injectionTitle: string;
  injectionDescription: string;
  enableInjection: string;
  enableInjectionDescription: string;
  maxInjectionTokens: string;
  archiveAssetsTitle: string;
  archiveAssetsDescription: string;
  agentsMd: string;
  agentsMdDescription: string;
  configYaml: string;
  configYamlDescription: string;
  skillsDirectory: string;
  skillsDirectoryDescription: string;
  structuredBadge: string;
  // Integration tab
  launchTitle: string;
  launchDescription: string;
  launchUrl: string;
  copyUrl: string;
  apiDocTitle: string;
  apiDocDescription: string;
  loadingExportDoc: string;
  loadExportDocFailed: string;
  publishFirst: string;
  publishedSource: string;
  capabilityUploads: string;
  capabilityEvents: string;
  capabilityJson: string;
  devConsoleUrl: string;
  devConsoleDescription: string;
  devConsoleIncludes: string;
  openPlayground: string;
  devConsoleUrlCopied: string;
  devToolsTitle: string;
  devToolsDescription: string;
  apiCapabilities: string;
  environment: string;
  conversations: string;
  tools: string;
  memory: string;
  // Save / toast
  copyFailed: string;
  launchUrlCopied: string;
  saveSuccess: (name: string, status: string) => string;
  saveFailed: string;
  selectModel: string;
  inheritWorkspaceModel: string;
  useMainAgentModel: string;
  unavailableModel: (name: string) => string;
  loadModelsFailed: string;
  memoryModelRequired: string;
  subagentNameRequired: (index: number) => string;
  duplicateSubagentName: (name: string) => string;
  subagentDescriptionRequired: (name: string) => string;
  subagentPromptRequired: (name: string) => string;
  mustBeInteger: (label: string) => string;
  mustBeNumber: (label: string) => string;
};

const enUS: AgentSettingsPageText = {
  tabIdentity: "Identity",
  tabCapabilities: "Capabilities",
  tabBehavior: "Behavior",
  tabIntegration: "Integration",
  backToGallery: "Back to agent gallery",
  unsavedChanges: "Unsaved changes",
  allSaved: "All changes saved",
  appliesToArchive: (status) => `Save applies to the ${status} archive only.`,
  readOnly: "Read only",
  reset: "Reset",
  save: "Save",
  loading: "Loading agent settings...",
  loadError: "Failed to load agent.",
  noAgent: "No agent selected.",
  restrictedTitle: "Management restricted",
  restrictedDescription:
    "You can use this agent, but only its creator or an admin can change settings.",
  identityTitle: "Identity",
  identityDescription:
    "Define how this archived agent should be described and targeted.",
  agentName: "Agent name",
  modelOverride: "Model override",
  optionalModelId: "Optional model ID",
  description: "Description",
  descriptionPlaceholder:
    "Summarize what this agent owns and what it should optimize for.",
  overviewTitle: "Overview",
  skillsLabel: "Skills",
  toolsLabel: "Tools",
  subagentsLabel: "Subagents",
  mcpLabel: "MCP",
  archiveContextTitle: "Current version",
  archiveContextDescription:
    "A quick read on the version you are editing right now.",
  ownerBadge: "Owner",
  leadAgentNote:
    "This is the lead agent — its archive is the entry point for the workspace.",
  noSkillsAttached: "No copied skills attached.",
  skillsTitle: "Skills",
  skillsDescriptionProd:
    "Prod archives can attach built-in system skills, custom archived skills, and prod-store skills.",
  skillsDescriptionDev:
    "Dev archives can attach built-in system skills, custom archived skills, and both dev/prod store skills.",
  loadingSkills: "Loading skill catalog...",
  loadSkillsFailed: "Failed to load skills.",
  noSkillsInScope: "No skills available in this scope.",
  searchSkills: "Search skills...",
  noSkillsMatchSearch: "No skills match the current search.",
  disabledBadge: "disabled",
  attachedBadge: "attached",
  duplicateNameHint: (names) =>
    `Duplicate skill names: ${names}. Choose the exact source tab you want.`,
  selectedSkills: "Selected skills",
  noSelectedSkills: "No skills selected.",
  remove: "remove",
  previousPage: "Previous",
  nextPage: "Next",
  pageStatus: (from, to, total) => `${from}-${to} of ${total}`,
  toolsTitle: "Tools",
  toolsDescription: "Main agent tool selection.",
  editLabel: "Edit",
  collapseLabel: "Collapse",
  noToolsSelected: "No tools selected",
  moreCount: (count) => `+${count} more`,
  loadingTools: "Loading tools...",
  loadToolsFailed: "Failed to load tools.",
  noConfigurableTools: "No configurable tools available.",
  selectableToolsTitle: "Archive-selectable tools",
  runtimeToolsTitle: "Runtime-injected tools",
  runtimeToolsDescription:
    "These tools are scanned from the active runtime middleware stack. Enable the owning middleware here; normal tool_names only control archive-selectable tools.",
  noRuntimeTools: "No runtime-injected tools found.",
  runtimeInjectedBadge: "runtime",
  filesystemMiddlewareTitle: "Filesystem middleware",
  filesystemMiddlewareDescription:
    "Injects runtime file tools such as ls, read_file, glob, grep, write_file, edit_file, and execute.",
  subagentsTitle: "Subagents",
  subagentsDescription: "General-purpose and custom subagent configuration.",
  generalPurposeTitle: "General Purpose Subagent",
  enabledState: "Enabled",
  disabledState: "Disabled",
  inheritMainTools: "Inherit Main Tools",
  inheritMainToolsDescription: "Use the same tools as the main agent.",
  customSubagents: "Custom Subagents",
  addSubagent: "Add",
  noCustomSubagents: "No custom subagents configured.",
  subagentExpand: "Expand",
  subagentCollapse: "Collapse",
  subagentNameLabel: "Name",
  subagentNamePlaceholder: "researcher / reviewer / explorer",
  descriptionLabel: "Description",
  subagentDescriptionPlaceholder:
    "Explain when the main agent should delegate work to this subagent.",
  subagentPromptLabel: "System Prompt",
  subagentPromptPlaceholder:
    "Write the subagent-specific instructions for its isolated context.",
  mcpTitle: "MCP Servers",
  mcpDescription: "Bind MCP server profiles to this agent.",
  searchMcp: "Filter MCP profiles...",
  loadingMcp: "Loading MCP profiles...",
  loadMcpFailed: "Failed to load MCP profiles.",
  noMcpProfiles: "No MCP profiles found.",
  mcpSelected: (count) => `${count} server(s) selected`,
  selectedMcpTitle: "Selected MCP servers",
  selectedMcpDescription:
    "The selected profiles are probed through the runtime so you can see the real tool surface before saving.",
  scanSelectedMcp: "Scan selected MCP",
  refreshMcpScan: "Refresh scan",
  scanningMcp: "Scanning selected MCP profiles...",
  noSelectedMcp: "Select at least one MCP profile to inspect its tools.",
  mcpReachable: "reachable",
  mcpUnreachable: "unreachable",
  mcpLatency: (latencyMs) => `${latencyMs.toFixed(0)} ms`,
  mcpToolCount: (count) => `${count} tool(s)`,
  mcpNoDiscoveredTools: "No tools discovered from this MCP profile.",
  mcpAvailableTools: "Available tools",
  mcpInputSchema: "Input schema",
  mcpUnknownProfile: "Unknown profile",
  mcpProfileMissing: "This selected profile was not found in the current MCP library.",
  mcpNoDescription: "No description provided by the MCP server.",
  mcpViewTools: "View tools",
  mcpRemoveProfile: "Remove",
  mcpDialogDescription:
    "Inspect the tools and input schema exposed by this MCP profile without stretching the settings page.",
  promptTitle: "System Prompt",
  promptDescription:
    "Edit the agent's AGENTS.md system prompt in the full workbench.",
  promptHint:
    "AGENTS.md authoring lives in the full-width workbench so the archive tree is not constrained.",
  openWorkspace: "Open workspace",
  editableBadge: "editable",
  runtimeContract: "Runtime path",
  runtimeContractIntro:
    "The system prompt is loaded from this path at runtime.",
  editingScope: "Editing scope",
  editingScopeDescription: `Changes are applied to the current archive. Use the workbench for full editing capabilities.`,
  memoryTitle: "Memory",
  memoryDescription: "Configure long-term memory for this agent.",
  enableMemory: "Enable Memory",
  enableMemoryDescription:
    "Allow the agent to store and recall facts across conversations.",
  memoryModel: "Memory Model",
  memoryModelPlaceholder: "Model ID for memory extraction",
  debounceSeconds: "Debounce Seconds",
  maxFacts: "Max Facts",
  confidenceThreshold: "Confidence Threshold",
  injectionTitle: "Prompt Injection",
  injectionDescription:
    "Control how memory facts are injected into the system prompt.",
  enableInjection: "Enable Memory Injection",
  enableInjectionDescription:
    "Automatically inject recalled memory facts into the agent context.",
  maxInjectionTokens: "Max Injection Tokens",
  archiveAssetsTitle: "Archive Assets",
  archiveAssetsDescription: "Files that make up this agent's archive.",
  agentsMd: "AGENTS.md",
  agentsMdDescription: "System prompt and agent instructions",
  configYaml: "config.yaml",
  configYamlDescription: "Structured agent configuration",
  skillsDirectory: "skills/",
  skillsDirectoryDescription: "Copied skill assets",
  structuredBadge: "structured",
  launchTitle: "Launch",
  launchDescription: "Access this agent's workspace.",
  launchUrl: "Launch URL",
  copyUrl: "Copy URL",
  apiDocTitle: "API Documentation",
  apiDocDescription: "OpenAPI specification for this agent.",
  loadingExportDoc: "Loading API documentation...",
  loadExportDocFailed: "Failed to load API documentation.",
  publishFirst:
    "Publish this agent to a production archive first to generate API documentation.",
  publishedSource:
    "The developer console is backed by the published prod archive.",
  capabilityUploads: "File uploads",
  capabilityEvents: "Streaming events",
  capabilityJson: "JSON responses",
  devConsoleUrl: "Developer Console",
  devConsoleDescription:
    "Interactive API playground for testing and integration.",
  devConsoleIncludes:
    "Base URL, model value, SDK snippets, live `/v1` testing, files, events, and schema browsing.",
  openPlayground: "Open Playground",
  devConsoleUrlCopied: "Console URL copied",
  devToolsTitle: "Developer Tools",
  devToolsDescription: "Quick access to developer resources.",
  apiCapabilities: "API Capabilities",
  environment: "Environment",
  conversations: "Conversations",
  tools: "Tools",
  memory: "Memory",
  copyFailed: "Copy failed",
  launchUrlCopied: "Launch URL copied",
  saveSuccess: (name, status) => `${name} (${status}) saved`,
  saveFailed: "Save failed",
  selectModel: "Select a model",
  inheritWorkspaceModel: "Inherit workspace default model",
  useMainAgentModel: "Use main agent model",
  unavailableModel: (name) => `${name} (currently unavailable)`,
  loadModelsFailed: "Failed to load models.",
  memoryModelRequired: "Memory model is required when memory is enabled.",
  subagentNameRequired: (index) => `Subagent ${index}: name is required`,
  duplicateSubagentName: (name) => `Duplicate subagent name: ${name}`,
  subagentDescriptionRequired: (name) =>
    `Subagent "${name}": description is required`,
  subagentPromptRequired: (name) =>
    `Subagent "${name}": system prompt is required`,
  mustBeInteger: (label) => `${label} must be an integer.`,
  mustBeNumber: (label) => `${label} must be a number.`,
};

const zhCN: AgentSettingsPageText = {
  tabIdentity: "身份",
  tabCapabilities: "能力",
  tabBehavior: "行为",
  tabIntegration: "接入",
  backToGallery: "返回智能体列表",
  unsavedChanges: "有未保存的更改",
  allSaved: "所有更改已保存",
  appliesToArchive: (status) => `保存只会应用到 ${status} 归档。`,
  readOnly: "只读",
  reset: "重置",
  save: "保存",
  loading: "正在加载智能体设置...",
  loadError: "加载智能体失败。",
  noAgent: "未选择智能体。",
  restrictedTitle: "管理受限",
  restrictedDescription:
    "你可以使用这个智能体，但只有创建者或管理员可以修改设置。",
  identityTitle: "身份信息",
  identityDescription: "定义这个归档智能体的定位、描述和目标。",
  agentName: "智能体名称",
  modelOverride: "模型覆盖",
  optionalModelId: "可选模型 ID",
  description: "描述",
  descriptionPlaceholder: "概括这个智能体负责什么，以及它应该优先优化什么。",
  overviewTitle: "概览",
  skillsLabel: "技能",
  toolsLabel: "工具",
  subagentsLabel: "子代理",
  mcpLabel: "MCP",
  archiveContextTitle: "当前版本",
  archiveContextDescription: "快速查看你当前正在编辑的这个版本。",
  ownerBadge: "所有者",
  leadAgentNote: "这是主控智能体 — 它的归档是工作区的入口点。",
  noSkillsAttached: "当前没有挂载任何已复制技能。",
  skillsTitle: "技能",
  skillsDescriptionProd:
    "生产归档可以挂载内置 system 技能、自定义归档技能，以及 prod 仓库技能。",
  skillsDescriptionDev:
    "开发归档可以挂载内置 system 技能、自定义归档技能，以及 dev/prod 仓库技能。",
  loadingSkills: "正在加载技能目录...",
  loadSkillsFailed: "加载技能失败。",
  noSkillsInScope: "当前范围内没有可用技能。",
  searchSkills: "搜索技能...",
  noSkillsMatchSearch: "没有技能匹配当前搜索条件。",
  disabledBadge: "已禁用",
  attachedBadge: "已挂载",
  duplicateNameHint: (names) =>
    `多个来源中存在同名技能：${names}。请选择具体版本。`,
  selectedSkills: "已选技能",
  noSelectedSkills: "未选择任何技能。",
  remove: "移除",
  previousPage: "上一页",
  nextPage: "下一页",
  pageStatus: (from, to, total) => `第 ${from}-${to} 项，共 ${total} 项`,
  toolsTitle: "工具",
  toolsDescription: "主智能体工具选择。",
  editLabel: "编辑",
  collapseLabel: "收起",
  noToolsSelected: "未选择工具",
  moreCount: (count) => `+${count} 更多`,
  loadingTools: "正在加载工具...",
  loadToolsFailed: "加载工具失败。",
  noConfigurableTools: "当前没有可配置的工具。",
  selectableToolsTitle: "可配置工具",
  runtimeToolsTitle: "运行时注入工具",
  runtimeToolsDescription:
    "这些工具来自运行时 middleware。这里配置是否启用对应 middleware；普通 tool_names 只控制可配置工具。",
  noRuntimeTools: "当前未发现运行时注入工具。",
  runtimeInjectedBadge: "运行时",
  filesystemMiddlewareTitle: "文件系统 middleware",
  filesystemMiddlewareDescription:
    "注入 ls、read_file、glob、grep、write_file、edit_file、execute 等运行时文件工具。",
  subagentsTitle: "子代理",
  subagentsDescription: "通用子代理和自定义子代理配置。",
  generalPurposeTitle: "通用子代理",
  enabledState: "已启用",
  disabledState: "已禁用",
  inheritMainTools: "继承主智能体工具",
  inheritMainToolsDescription: "使用与主智能体相同的工具。",
  customSubagents: "自定义子代理",
  addSubagent: "新增",
  noCustomSubagents: "暂无自定义子代理。",
  subagentExpand: "展开",
  subagentCollapse: "收起",
  subagentNameLabel: "名称",
  subagentNamePlaceholder: "researcher / reviewer / explorer",
  descriptionLabel: "描述",
  subagentDescriptionPlaceholder:
    "说明主智能体应该在什么场景下把工作委派给它。",
  subagentPromptLabel: "系统提示词",
  subagentPromptPlaceholder: "填写这个子代理在隔离上下文里执行时应遵循的指令。",
  mcpTitle: "MCP 服务器",
  mcpDescription: "为这个智能体绑定 MCP 服务器配置文件。",
  searchMcp: "搜索 MCP 配置...",
  loadingMcp: "正在加载 MCP 配置...",
  loadMcpFailed: "加载 MCP 配置失败。",
  noMcpProfiles: "未找到 MCP 配置。",
  mcpSelected: (count) => `已选择 ${count} 个服务器`,
  selectedMcpTitle: "已选 MCP 服务器",
  selectedMcpDescription:
    "这里会通过运行时真实探测已选 profile，方便你在保存前确认 MCP 实际暴露了哪些工具。",
  scanSelectedMcp: "扫描已选 MCP",
  refreshMcpScan: "重新扫描",
  scanningMcp: "正在扫描已选 MCP 配置...",
  noSelectedMcp: "请至少选择一个 MCP 配置后再查看工具。",
  mcpReachable: "可连接",
  mcpUnreachable: "不可连接",
  mcpLatency: (latencyMs) => `${latencyMs.toFixed(0)} 毫秒`,
  mcpToolCount: (count) => `${count} 个工具`,
  mcpNoDiscoveredTools: "当前 MCP 配置未发现任何工具。",
  mcpAvailableTools: "可用工具",
  mcpInputSchema: "输入 Schema",
  mcpUnknownProfile: "未知配置",
  mcpProfileMissing: "当前选中的 profile 不在 MCP 配置库中。",
  mcpNoDescription: "MCP 服务器未提供描述。",
  mcpViewTools: "查看工具",
  mcpRemoveProfile: "移除",
  mcpDialogDescription:
    "在独立面板里查看这个 MCP profile 暴露的工具和输入 schema，避免设置页被内容撑长。",
  promptTitle: "系统提示词",
  promptDescription: "在完整工作区中编辑智能体的 AGENTS.md 系统提示词。",
  promptHint:
    "AGENTS.md 编辑已移至全宽工作区，这样归档目录树不会被此布局限制。",
  openWorkspace: "打开工作区",
  editableBadge: "可编辑",
  runtimeContract: "运行时路径",
  runtimeContractIntro: "系统提示词在运行时从此路径加载。",
  editingScope: "编辑范围",
  editingScopeDescription: "更改会应用到当前归档。请使用工作区进行完整编辑。",
  memoryTitle: "记忆",
  memoryDescription: "配置智能体的长期记忆。",
  enableMemory: "启用记忆",
  enableMemoryDescription: "允许智能体跨对话存储和回忆事实。",
  memoryModel: "记忆模型",
  memoryModelPlaceholder: "用于记忆提取的模型 ID",
  debounceSeconds: "防抖秒数",
  maxFacts: "最大事实数",
  confidenceThreshold: "置信度阈值",
  injectionTitle: "提示词注入",
  injectionDescription: "控制记忆事实如何注入到系统提示词中。",
  enableInjection: "启用记忆注入",
  enableInjectionDescription: "自动将检索到的记忆事实注入到智能体上下文中。",
  maxInjectionTokens: "注入最大 Token 数",
  archiveAssetsTitle: "归档资产",
  archiveAssetsDescription: "组成此智能体归档的文件。",
  agentsMd: "AGENTS.md",
  agentsMdDescription: "系统提示词和智能体指令",
  configYaml: "config.yaml",
  configYamlDescription: "结构化智能体配置",
  skillsDirectory: "skills/",
  skillsDirectoryDescription: "已复制的技能资产",
  structuredBadge: "结构化",
  launchTitle: "启动",
  launchDescription: "访问此智能体的工作区。",
  launchUrl: "启动链接",
  copyUrl: "复制链接",
  apiDocTitle: "API 文档",
  apiDocDescription: "此智能体的 OpenAPI 规范。",
  loadingExportDoc: "正在加载 API 文档...",
  loadExportDocFailed: "加载 API 文档失败。",
  publishFirst: "请先将此智能体发布到生产归档以生成 API 文档。",
  publishedSource: "开发者控制台基于已发布的生产归档。",
  capabilityUploads: "文件上传",
  capabilityEvents: "流式事件",
  capabilityJson: "JSON 响应",
  devConsoleUrl: "开发者控制台",
  devConsoleDescription: "用于测试和集成的交互式 API 游乐场。",
  devConsoleIncludes:
    "Base URL、model 取值、SDK 示例、真实 `/v1` 测试、文件、事件和 schema 浏览。",
  openPlayground: "打开控制台",
  devConsoleUrlCopied: "已复制控制台地址",
  devToolsTitle: "开发者工具",
  devToolsDescription: "快速访问开发者资源。",
  apiCapabilities: "API 能力",
  environment: "环境",
  conversations: "对话",
  tools: "工具",
  memory: "记忆",
  copyFailed: "复制失败",
  launchUrlCopied: "已复制启动链接",
  saveSuccess: (name, status) => `${name}（${status}）已保存`,
  saveFailed: "保存失败",
  selectModel: "选择模型",
  inheritWorkspaceModel: "继承工作区默认模型",
  useMainAgentModel: "使用主智能体模型",
  unavailableModel: (name) => `${name}（当前不可用）`,
  loadModelsFailed: "加载模型失败。",
  memoryModelRequired: "启用记忆时必须填写记忆模型。",
  subagentNameRequired: (index) => `第 ${index} 个子代理：名称为必填项`,
  duplicateSubagentName: (name) => `子代理名称"${name}"重复`,
  subagentDescriptionRequired: (name) => `子代理"${name}"：描述为必填项`,
  subagentPromptRequired: (name) => `子代理"${name}"：系统提示词为必填项`,
  mustBeInteger: (label) => `${label}必须是整数。`,
  mustBeNumber: (label) => `${label}必须是数字。`,
};

export function getAgentSettingsPageText(
  locale: Locale,
): AgentSettingsPageText {
  return locale === "zh-CN" ? zhCN : enUS;
}
