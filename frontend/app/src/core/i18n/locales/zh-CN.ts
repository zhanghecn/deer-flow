import {
  CompassIcon,
  GraduationCapIcon,
  ImageIcon,
  MicroscopeIcon,
  PenLineIcon,
  ShapesIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import type { Translations } from "./types";

export const zhCN: Translations = {
  // Locale meta
  locale: {
    localName: "中文",
  },

  // Common
  common: {
    home: "首页",
    settings: "设置",
    delete: "删除",
    rename: "重命名",
    share: "分享",
    openInNewWindow: "在新窗口打开",
    close: "关闭",
    more: "更多",
    search: "搜索",
    download: "下载",
    thinking: "思考",
    artifacts: "文件",
    public: "公共",
    custom: "自定义",
    notAvailableInDemoMode: "在演示模式下不可用",
    loading: "加载中...",
    version: "版本",
    lastUpdated: "最后更新",
    logout: "退出登录",
    code: "代码",
    preview: "预览",
    previewUnavailable: "暂不支持预览",
    inlinePreviewUnsupported:
      "当前工作区暂不支持此类文件的内联预览，请使用“在新窗口打开”或“下载”。",
    cancel: "取消",
    save: "保存",
    install: "安装",
    create: "创建",
    clearAll: "清空全部",
  },

  // Commands
  commands: {
    knowledgeAdd: "把本次上传文件建立为当前线程知识库并允许 agent 检索",
    createAgent: "在当前工作区中新建一个智能体",
    createSkill: "在当前工作区中新建一个技能",
    saveAgentToStore: "将当前草稿智能体保存到开发仓库",
    saveSkillToStore: "将当前草稿技能保存到开发仓库",
    pushAgentProd: "将当前开发智能体发布到生产环境",
    pushSkillProd: "将当前开发技能发布到生产环境",
  },

  // Welcome
  welcome: {
    greeting: "你好，欢迎回来！",
    description:
      "欢迎使用 OpenAgents，一个完全开源的超级智能体。通过内置和自定义的 Skills，\nOpenAgents 可以帮你搜索网络、分析数据，还能为你生成幻灯片、\n图片、视频、播客及网页等，几乎可以做任何事情。",

    createYourOwnSkill: "创建你自己的 Agent SKill",
    createYourOwnSkillDescription:
      "创建你的 Agent Skill 来释放 OpenAgents 的潜力。通过自定义技能，OpenAgents\n可以帮你搜索网络、分析数据，还能为你生成幻灯片、\n网页等作品，几乎可以做任何事情。",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "复制到剪贴板",
    copiedToClipboard: "已复制到剪贴板",
    failedToCopyToClipboard: "复制到剪贴板失败",
    linkCopied: "链接已复制到剪贴板",
  },

  // Input Box
  inputBox: {
    placeholder: "今天我能为你做些什么？",
    submit: "提交",
    stop: "停止",
    createSkillPrompt:
      "我们一起用 skill-creator 技能来创建一个技能吧。先问问我希望这个技能能做什么。",
    addAttachments: "添加附件",
    mode: "模式",
    flashMode: "闪速",
    flashModeDescription: "快速且高效的完成任务，但可能不够精准",
    proMode: "Pro",
    proModeDescription: "思考、计划再执行，获得更精准的结果，可能需要更多时间",
    subagentToggle: "子任务",
    subagentToggleDescription:
      "允许 agent 在合适的时候使用 task 工具，把工作委派给通用或自定义 subagent。",
    searchModels: "搜索模型...",
    surpriseMe: "小惊喜",
    surpriseMePrompt: "给我一个小惊喜吧",
    quickInsertCommandBadge: "命令",
    quickInsertCommandsLabel: "命令",
    quickInsertSkillsLabel: "技能",
    retryingModel: (current, max, time) =>
      `模型重试 ${current}/${max} · ${time}`,
    retryingTool: (toolName, current, max, time) =>
      `工具 ${toolName} 重试 ${current}/${max} · ${time}`,
    retryingToolGeneric: (current, max, time) =>
      `工具重试 ${current}/${max} · ${time}`,
    retryDelay: (seconds) => `${seconds} 秒后再次尝试`,
    executionThinking: (elapsed) => `思考中${elapsed ? ` ${elapsed}` : ""}`,
    executionRunningTool: (toolName, elapsed) =>
      `${toolName ? `执行 ${toolName}` : "执行工具"}${elapsed ? ` ${elapsed}` : ""}`,
    executionFinalizing: (elapsed) =>
      `收尾处理中${elapsed ? ` ${elapsed}` : ""}`,
    executionRetryCompleted: "重试完成",
    executionRetryFailed: "重试失败",
    executionCompleted: (elapsed) =>
      elapsed ? `${elapsed} 内完成` : "已完成",
    executionFailed: (elapsed) => (elapsed ? `${elapsed} 后失败` : "执行失败"),
    executionStopped: (elapsed) => (elapsed ? `${elapsed} 后停止` : "已停止"),
    suggestions: [
      {
        suggestion: "写作",
        prompt: "撰写一篇关于[主题]的博客文章",
        icon: PenLineIcon,
      },
      {
        suggestion: "研究",
        prompt: "深入浅出的研究一下[主题]，并总结发现。",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "收集",
        prompt: "从[来源]收集数据并创建报告。",
        icon: ShapesIcon,
      },
      {
        suggestion: "学习",
        prompt: "学习关于[主题]并创建教程。",
        icon: GraduationCapIcon,
      },
    ],
    suggestionsCreate: [
      {
        suggestion: "网页",
        prompt: "生成一个关于[主题]的网页",
        icon: CompassIcon,
      },
      {
        suggestion: "图片",
        prompt: "生成一个关于[主题]的图片",
        icon: ImageIcon,
      },
      {
        suggestion: "视频",
        prompt: "生成一个关于[主题]的视频",
        icon: VideoIcon,
      },
      {
        type: "separator",
      },
      {
        suggestion: "技能",
        prompt:
          "我们一起用 skill-creator 技能来创建一个技能吧。先问问我希望这个技能能做什么。",
        icon: SparklesIcon,
      },
    ],
  },

  // Sidebar
  sidebar: {
    newChat: "新对话",
    workspaceDock: "工作台",
    runtimeWorkspace: "运行空间",
    designBoard: "设计画板",
    chats: "对话",
    recentChats: "最近的对话",
    demoChats: "演示对话",
    agents: "智能体",
  },

  // Agents
  agents: {
    title: "智能体",
    description: "创建和管理具有专属 Prompt 与能力的自定义智能体。",
    newAgent: "新建智能体",
    emptyTitle: "还没有自定义智能体",
    emptyDescription: "创建你的第一个自定义智能体，设置专属系统提示词。",
    gallerySummary: (total, published, draft) =>
      `${total} 个智能体 · ${published} 个已发布 · ${draft} 个草稿`,
    galleryEmptySearchDescription: "试试其他名称或关键词。",
    chat: "对话",
    copyUrl: "复制链接",
    delete: "删除",
    deleteConfirm: "确定要删除该智能体吗？此操作不可撤销。",
    deleteSuccess: "智能体已删除",
    deleteArchiveTitle: (agentName: string) => `删除“${agentName}”归档`,
    deleteArchiveDescription: (agentName: string) =>
      `请选择要删除“${agentName}”的哪个归档版本。删除全部归档会同时移除草稿版和已发布版。`,
    deleteDraft: "删除草稿版",
    deletePublished: "删除已发布版",
    deleteAllArchives: "删除全部归档",
    deleteDraftSuccess: (agentName: string) =>
      `已删除“${agentName}”的草稿归档`,
    deletePublishedSuccess: (agentName: string) =>
      `已删除“${agentName}”的已发布归档`,
    deleteAllArchivesSuccess: (agentName: string) =>
      `已删除“${agentName}”的全部归档`,
    publish: "发布",
    publishSuccess: (agentName: string) => `智能体“${agentName}”已发布`,
    ownerBadge: "归属",
    ownedByYou: "由你管理",
    ownedBy: (ownerName: string) => `归属：${ownerName}`,
    legacyOwnerless: "历史未认领智能体",
    readOnlyBadge: "只读",
    memoryOff: "记忆已关闭",
    memoryOn: "记忆已启用",
    memoryWithModel: (modelName: string) => `记忆 · ${modelName}`,
    coreBadge: "内置",
    currentBadge: "当前",
    draftBadge: "草稿",
    publishedBadge: "已发布",
    defaultDraft: "默认进草稿",
    defaultPublished: "默认进已发布",
    draftOnly: "仅草稿",
    publishedReady: "已有已发布版",
    publishedOnly: "仅已发布",
    publishToProd: "发布到生产",
    newChat: "新对话",
    createPageTitle: "设计你的智能体",
    createPageSubtitle: "描述你想要的智能体，我来帮你通过对话创建。",
    nameStepTitle: "给新智能体起个名字",
    nameStepHint:
      "只允许字母、数字和连字符，存储时自动转为小写（例如 code-reviewer）",
    nameStepPlaceholder: "例如 code-reviewer",
    nameStepContinue: "继续",
    nameStepInvalidError: "名称无效，只允许字母、数字和连字符",
    nameStepAlreadyExistsError: "已存在同名智能体",
    nameStepCheckError: "无法验证名称可用性，请稍后重试",
    nameStepBootstrapMessage:
      "新智能体的名称是 {name}，现在开始为它生成 **AGENTS.md**。",
    agentCreated: "智能体已创建！",
    startChatting: "开始对话",
    backToGallery: "返回 Gallery",
    switcher: {
      title: "切换智能体",
      description:
        "选择当前对话背后的智能体。更细的版本配置和归档管理请进入设置页。",
      currentAgent: "当前智能体",
      currentAgentDescription: "这里保持轻量切换，优先让你快速换 agent。",
      builtinDescription: "内置编排智能体",
      version: "版本",
      versionDescription:
        "日常迭代优先用草稿；需要验证已发布副本时再切到已发布。",
      draftVersion: "草稿",
      publishedVersion: "已发布",
      chooseAnotherTitle: "切换到其他智能体",
      chooseAnotherDescription: "按名称或描述搜索，一键切换当前对话。",
      total: (count: number) => `共 ${count} 个`,
      searchPlaceholder: "搜索智能体",
      loading: "正在加载智能体...",
      loadError: "加载智能体失败",
      empty: "没有匹配当前搜索的智能体。",
      availableIn: (statuses: string) => `可用版本：${statuses}`,
    },
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "工作区",
    chats: "对话",
  },

  // Workspace
  workspace: {
    settingsAndMore: "设置和更多",
    apiKeys: "API Key",
    userRoleFallback: "用户",
    toggleSidebar: "切换侧边栏",
    artifactsPanelTitle: "文件",
    filesSurfaceTitle: "文件",
    designSurfaceTitle: "设计",
    runtimeSurfaceTitle: "运行",
    closeWorkspaceDock: "关闭工作台",
    noArtifactSelectedTitle: "尚未选择文件",
    noArtifactSelectedDescription: "请选择一个文件以查看详情",
    noPreviewSelectedTitle: "尚未选择预览",
    noPreviewSelectedDescription:
      "先在文件列表里选中文件，或通过引用打开预览。",
    noDesignSurfaceTitle: "还没有设计会话",
    noDesignSurfaceDescription:
      "打开设计编辑器后，这里会持续显示当前设计稿、选区和同步状态。",
    noRuntimeSurfaceTitle: "还没有运行会话",
    noRuntimeSurfaceDescription:
      "打开运行空间后，这里会持续显示当前运行状态和目标环境。",
    noTargetFile: "还没有目标文件",
    designSurfaceDescription:
      "完整设计编辑仍在新的 OpenPencil 标签页中进行；这里保留目标文件、选区和同步状态，方便边聊边改。",
    runtimeSurfaceDescription:
      "完整运行空间仍在新标签页中打开；这里保留会话状态，避免聊天与运行环境脱节。",
    openDesignEditor: "打开设计编辑器",
    reopenDesignEditor: "重新打开设计标签",
    openRuntimeSurface: "打开运行空间",
    reopenRuntimeSurface: "重新打开运行标签",
    selectedNodesLabel: "已选节点",
    designStatusIdle: "空闲",
    designStatusLoading: "加载中",
    designStatusReady: "已就绪",
    designStatusDirty: "未保存",
    designStatusSaving: "保存中",
    designStatusSynced: "已同步",
    designStatusConflict: "冲突",
    designStatusError: "错误",
    designPopupBlockedDescription:
      "浏览器拦截了自动打开设计标签页，请使用下方按钮手动打开设计编辑器。",
    designSessionExpiredDescription:
      "设计会话已过期，请重新打开编辑器以继续和 Deer Flow 同步。",
    designOpenFailedDescription:
      "这次重新打开设计编辑器失败了，请在当前面板中再次尝试。",
    designSyncFailedDescription:
      "当前设计标签页在保存或同步时失败了，请保留编辑器并根据上方错误信息重试。",
    designRevisionLabel: "修订版本",
    designRevisionUnavailable: "等待首次同步",
    designLastActivityLabel: "最近活动",
    designLastActivityUnavailable: "还没有活动",
    runtimeStatusIdle: "空闲",
    runtimeStatusOpening: "打开中",
    runtimeStatusActive: "运行中",
    runtimeStatusFailed: "失败",
    eventDesignSaved: "设计稿已保存",
    eventRuntimeOpened: "运行空间已打开",
    eventPreviewUpdated: "预览已更新",
    eventSelectedNodesCount: (count: number) => `已选 ${count} 个节点`,
    officePreviewDialogDescription: "预览并编辑当前选中的 Office 文档。",
    todoListTitle: "待办事项",
  },

  knowledge: {
    sectionTitle: "知识库",
    manageButton: "知识库",
    loadingAttached: "正在加载已挂载知识库...",
    emptyAttached: "当前线程还没有挂载知识库。",
    chooseAtLeastOneFile: "请至少选择一个文件。",
    invalidSelectedModel: "创建知识库前请先选择一个有效模型。",
    defaultBaseName: "知识库",
    indexQueued: "知识库索引任务已加入队列。",
    createError: "创建知识库失败。",
    uploadButton: "上传知识库",
    newTitle: "新建知识库",
    newDescription:
      "上传 PDF、Word 或 Markdown 文件，并为当前线程构建可持久化的文档树索引。",
    newDescriptionGlobal:
      "上传 PDF、Word 或 Markdown 文件，并为共享知识库构建可持久化的文档树索引。",
    modelLabel: "索引模型",
    modelPlaceholder: "选择一个模型",
    namePlaceholder: "知识库名称",
    descriptionPlaceholder: "给 agent 的可选描述",
    supportedFormatsHint: "支持的格式：PDF、DOC、DOCX、MD、Markdown。",
    unsupportedFilesSelected: (count: number) =>
      `${count} 个已选文件不支持知识库索引。`,
    selectedFileCount: (count: number) => `${count} 个文件待上传`,
    rejectedFileCount: (count: number) => `${count} 个文件已拒绝`,
    uploadNextStepThread:
      "上传后，可在聊天里的已挂载知识区打开详情并持续查看索引进度。",
    uploadNextStepLibrary:
      "上传后，可在知识库列表中打开对应条目，查看索引进度和解析结果。",
    managerTitle: "知识库管理",
    managerDescription:
      "按用户浏览共享知识库，查看构建进度，并审查持久化的 PageTree 索引和 canonical 原文。",
    managerTitleGlobal: "共享知识库",
    managerDescriptionGlobal:
      "按用户文件夹浏览共享知识库，查看索引进度，并对照持久化的 PageTree 与 canonical 原文排查问题。",
    libraryTitle: "共享知识库",
    libraryDescription:
      "知识库按所属用户分组。将知识库挂载到当前线程后，agent 工具才能直接检索它。",
    libraryDescriptionGlobal:
      "知识库按所属用户分组，方便直接检查共享文档、预览源文件，并审查持久化索引结果。",
    searchPlaceholder: "搜索用户、知识库或文档",
    loadingLibrary: "正在加载知识库...",
    emptyLibrary: "当前搜索条件下没有匹配的共享知识库。",
    noDocumentSelectedTitle: "尚未选择文档",
    noDocumentSelectedDescription:
      "从左侧选择一个文档，以查看构建状态、树结构和持久化调试信息。",
    baseCount: (count: number) => `${count} 个知识库`,
    documentCount: (count: number) => `${count} 个文档`,
    readyCount: (count: number) => `${count} 个可用`,
    activeCount: (count: number) => `${count} 个构建中`,
    attachedBaseCount: (count: number) => `${count} 个已挂载知识库`,
    viewDetails: "查看详情",
    backToChat: "返回对话",
    backToAgents: "返回智能体",
    visibilityShared: "共享",
    visibilityPrivate: "私有",
    previewEnabled: "允许预览",
    previewDisabled: "禁止预览",
    previewSetting: "预览权限",
    previewSettingHint: "允许其他用户打开树结构、调试信息和原文预览。",
    previewUpdateEnabled: (name: string) => `已允许“${name}”的预览访问。`,
    previewUpdateDisabled: (name: string) => `已关闭“${name}”的预览访问。`,
    previewUpdateError: "更新预览权限失败。",
    attach: "挂载",
    detach: "取消挂载",
    attached: "已挂载",
    attachedSuccess: (name: string) => `已将“${name}”挂载到当前线程。`,
    detachedSuccess: (name: string) => `已将“${name}”从当前线程取消挂载。`,
    bindingError: "更新知识库挂载状态失败。",
    deleteTitle: "删除知识库",
    deleteDescription: (name: string) =>
      `确定删除“${name}”及其全部索引文档吗？此操作不可撤销。`,
    deleteSuccess: (name: string) => `已删除“${name}”。`,
    deleteError: "删除知识库失败。",
    clearAllTitle: "清空知识库",
    clearAllSelfDescription: (count: number) =>
      `确定清空你自己的全部 ${count} 个知识库吗？其索引、原文和预览文件都会被删除，此操作不可撤销。`,
    clearAllOwnerDescription: (ownerName: string, count: number) =>
      `确定清空“${ownerName}”名下的全部 ${count} 个知识库吗？其索引、原文和预览文件都会被删除，此操作不可撤销。`,
    clearAllSuccess: (count: number) => `已清空 ${count} 个知识库。`,
    clearAllOwnerSuccess: (ownerName: string, count: number) =>
      `已清空“${ownerName}”名下的 ${count} 个知识库。`,
    clearAllError: "清空知识库失败。",
    buildProgressTitle: "构建进度",
    buildProgressDescription: "查看选中文档的索引阶段、耗时和最新任务状态。",
    stageLabel: "阶段",
    progressLabel: "进度",
    elapsedLabel: "耗时",
    updatedAtLabel: "更新时间",
    messageLabel: "消息",
    noBuildMessage: "暂时没有构建消息。",
    notAvailable: "暂无",
    overviewTab: "概览",
    treeTab: "树结构",
    eventsTab: "构建事件",
    indexTab: "索引 JSON",
    canonicalTab: "Canonical 原文",
    treePending: "索引完成后会显示文档树。",
    loadingTree: "正在加载文档树...",
    emptyTree: "这个文档没有返回树节点。",
    loadingEvents: "正在加载构建事件...",
    emptyEvents: "暂时没有构建事件。",
    loadingDebug: "正在加载调试信息...",
    emptyCanonical: "这个文档还没有保存 canonical 原文。",
    pageLabel: "页",
    lineLabel: "行",
    pageCount: (count: number) => `${count} 页`,
    nodeCount: (count: number) => `${count} 个节点`,
    childCount: (count: number) => `${count} 个子节点`,
    status: {
      queued: "排队中",
      ready: "可用",
      processing: "索引中",
      error: "错误",
    },
    selector: {
      button: "知识库",
      title: "选择知识库",
      description:
        "搜索共享知识库，并直接更新当前线程的挂载状态。刷新页面后，agent 仍会按这里的挂载结果继续使用知识库。",
      searchPlaceholder: "搜索知识库、文档或所属用户",
      results: "知识库",
      empty: "没有匹配当前搜索的知识库。",
      apply: "更新线程知识库",
      applied: "线程知识库挂载已更新。",
      appliedCount: (count: number) => `当前线程已挂载 ${count} 个知识库。`,
      attachError: "更新所选知识库挂载失败。",
      readyLabel: "当前线程已挂载知识库",
      selectedCount: (count: number) => `${count} 个知识库`,
    },
  },

  // Conversation
  conversation: {
    noMessages: "还没有消息",
    startConversation: "开始新的对话以查看消息",
  },

  // Chats
  chats: {
    searchChats: "搜索对话",
    clearAll: "清空全部对话",
    clearAllConfirm: "确定要删除当前账号下的全部对话吗？此操作不可撤销。",
    clearAllSuccess: "已清空全部对话",
    emptyTitle: "还没有对话",
    emptyDescription: "从一个新对话开始，之后这里会沉淀你的历史记录。",
    emptyAction: "开始新对话",
    emptyPageTitle: "这一页没有对话",
    emptyPageDescription: "你已经翻到了没有记录的页码，可以返回更新的一页继续查看。",
    noResultsTitle: "没有匹配的对话",
    noResultsDescription: "试试其他标题关键词，或清空当前筛选条件。",
    pageLabel: (page: number, totalPages: number, totalThreads: number) =>
      `第 ${page} / ${totalPages} 页 · 共 ${totalThreads} 个对话`,
    newerPage: "更新的",
    olderPage: "更早的",
  },

  // Auth
  auth: {
    heroTitle: "在一个智能体工作区内完成研究、构建与交付。",
    heroDescription:
      "登录后可继续使用你的对话线程、工具、技能与沙盒。如果你是新用户，可以立即注册并开始使用同一工作区。",
    heroFeatureThreads: "对话历史与上下文持续同步。",
    heroFeatureSkills: "智能体技能与工具配置开箱即用。",
    heroFeatureJwt: "基于 JWT 的工作区与 API 认证。",
    panelSubtitle: "几秒内进入你的工作区。",
    badge: "v2.0 认证",
    signInTab: "登录",
    registerTab: "注册",
    accountLabel: "账号或邮箱",
    emailLabel: "邮箱",
    passwordLabel: "密码",
    nameLabel: "名称",
    confirmPasswordLabel: "确认密码",
    loginEmailPlaceholder: "you@example.com",
    loginPasswordPlaceholder: "请输入你的密码",
    registerNamePlaceholder: "你的名称",
    registerEmailPlaceholder: "you@example.com",
    registerPasswordPlaceholder: "至少 8 个字符",
    confirmPasswordPlaceholder: "再次输入密码",
    signingIn: "登录中...",
    signInAction: "登录",
    creatingAccount: "创建账号中...",
    createAccountAction: "创建账号",
    newHere: "第一次使用？",
    createAccountLink: "立即注册",
    alreadyHaveAccount: "已有账号？",
    signInLink: "去登录",
    restoringSession: "正在恢复你的工作区...",
    passwordMismatchError: "两次输入的密码不一致。",
    passwordTooShortError: "密码至少需要 8 个字符。",
    loginFailed: "登录失败",
    registrationFailed: "注册失败",
  },

  // Page titles (document title)
  pages: {
    appName: "OpenAgents",
    chats: "对话",
    newChat: "新对话",
    untitled: "未命名",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `查看其他 ${count} 个步骤`,
    lessSteps: "隐藏步骤",
    executeCommand: "执行命令",
    presentFiles: "展示文件",
    needYourHelp: "需要你的协助",
    questionTitle: "需要你的回答",
    questionContext: "为什么需要这一步",
    questionOptions: "推荐答案",
    questionProgress: (current: number, total: number) =>
      `问题 ${current} / ${total}`,
    questionHintSingle: "选择一个选项，或直接输入你的答案。",
    questionHintMultiple: "可多选，也可以补充你自己的答案。",
    questionCustomAnswer: "自定义回答",
    questionReplyPlaceholder: "输入你的回答",
    questionReplyAction: "发送回答",
    questionDismissAction: "暂不回答",
    questionBackAction: "上一步",
    questionNextAction: "下一步",
    questionSubmitAction: "提交",
    questionResumeError: "继续问题流程失败。",
    questionDismissError: "关闭问题请求失败。",
    useTool: (toolName: string) => `使用 “${toolName}” 工具`,
    searchFor: (query: string) => `搜索 “${query}”`,
    searchForRelatedInfo: "搜索相关信息",
    searchForRelatedImages: "搜索相关图片",
    searchForRelatedImagesFor: (query: string) => `搜索相关图片 “${query}”`,
    searchOnWebFor: (query: string) => `在网络上搜索 “${query}”`,
    viewWebPage: "查看网页",
    listFolder: "列出文件夹",
    readFile: "读取文件",
    writeFile: "写入文件",
    clickToViewContent: "点击查看文件内容",
    writeTodos: "更新 To-do 列表",
    skillInstallTooltip: "安装技能并使其可在 OpenAgents 中使用",
  },

  uploads: {
    uploading: "上传中...",
    uploadingFiles: "文件上传中，请稍候...",
  },

  subtasks: {
    subtask: "子任务",
    executing: (count: number) =>
      `${count > 1 ? "并行" : ""}执行 ${count} 个子任务`,
    completedGroup: (count: number) => `已完成 ${count} 个子任务`,
    failedGroup: (count: number) => `${count} 个子任务执行失败`,
    in_progress: "子任务运行中",
    completed: "子任务已完成",
    failed: "子任务失败",
  },

  // Settings
  settings: {
    title: "设置",
    description: "根据你的偏好调整 OpenAgents 的界面和行为。",
    sections: {
      appearance: "外观",
      tools: "MCP",
      skills: "技能",
      notification: "通知",
      about: "关于",
    },
    appearance: {
      themeTitle: "主题",
      themeDescription: "跟随系统或选择固定的界面模式。",
      system: "系统",
      light: "浅色",
      dark: "深色",
      systemDescription: "自动跟随系统主题。",
      lightDescription: "更明亮的配色，适合日间使用。",
      darkDescription: "更暗的配色，减少眩光方便专注。",
      languageTitle: "语言",
      languageDescription: "在不同语言之间切换。",
    },
    tools: {
      title: "工具",
      description: "管理可供智能体绑定的全局 MCP Library。",
      loadError: (message: string) =>
        message ? `加载工具失败：${message}` : "加载工具失败",
      emptyState: "当前还没有配置 MCP Profile。",
      createProfile: "新建 MCP",
      editProfile: "编辑 MCP",
      profileCreated: "MCP Profile 已创建",
      profileUpdated: "MCP Profile 已更新",
      profileDeleted: "MCP Profile 已删除",
      profileName: "Profile 名称",
      profileConfig: "标准 mcpServers JSON",
      useDemoTemplate: "使用 demo 模板",
      profileTemplateHint:
        "HTTP MCP Profile 应使用 type: \"http\" 和容器可访问的 URL。本地 demo 模板指向当前 Docker 网络内的 mcp-file-service。",
      saveProfile: "保存 MCP Profile",
      saveError: "保存 MCP Profile 失败",
    },
    skills: {
      title: "技能",
      description: "管理 Agent Skill 配置和启用状态。",
      loadError: (message: string) =>
        message ? `加载技能失败：${message}` : "加载技能失败",
      createSkill: "新建技能",
      downloadSkill: "下载 .skill",
      downloadSuccess: (filename: string) => `已下载 ${filename}`,
      downloadFailed: (message: string) =>
        message ? `下载技能失败：${message}` : "下载技能失败",
      emptyTitle: "还没有技能",
      emptyDescription:
        "将新的 skill 创建在 `.openagents/custom/skills`，在工作台里迭代完成后再导出或挂载使用。",
      emptyButton: "创建你的第一个技能",
    },
    notification: {
      title: "通知",
      description:
        "OpenAgents 只会在窗口不活跃时发送完成通知，特别适合长时间任务：你可以先去做别的事，完成后会收到提醒。",
      requestPermission: "请求通知权限",
      deniedHint:
        "通知权限已被拒绝。可在浏览器的网站设置中重新开启，以接收完成提醒。",
      testButton: "发送测试通知",
      testTitle: "OpenAgents",
      testBody: "这是一条测试通知。",
      notSupported: "当前浏览器不支持通知功能。",
      disableNotification: "关闭通知",
    },
    acknowledge: {
      emptyTitle: "致谢",
      emptyDescription: "相关的致谢信息会展示在这里。",
    },
  },
};
