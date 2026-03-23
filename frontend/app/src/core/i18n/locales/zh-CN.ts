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
    createAgent: "在当前工作区中新建一个智能体",
    createSkill: "在当前工作区中新建一个技能",
    saveAgentToStore: "将当前草稿智能体保存到开发仓库",
    saveSkillToStore: "将当前草稿技能保存到开发仓库",
    pushAgentProd: "将当前开发智能体发布到生产环境",
    pushSkillProd: "将当前开发技能发布到生产环境",
    promoteSkillShared: "将当前技能推广到共享技能归档",
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
    createSkillPrompt:
      "我们一起用 skill-creator 技能来创建一个技能吧。先问问我希望这个技能能做什么。",
    addAttachments: "添加附件",
    mode: "模式",
    flashMode: "闪速",
    flashModeDescription: "快速且高效的完成任务，但可能不够精准",
    proMode: "Pro",
    proModeDescription: "思考、计划再执行，获得更精准的结果，可能需要更多时间",
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
    chat: "对话",
    copyUrl: "复制链接",
    delete: "删除",
    deleteConfirm: "确定要删除该智能体吗？此操作不可撤销。",
    deleteSuccess: "智能体已删除",
    publish: "发布",
    publishSuccess: (agentName: string) => `智能体“${agentName}”已发布`,
    downloadDemo: "下载 Demo",
    downloadSuccess: (filename: string) => `已下载 ${filename}`,
    memoryOff: "记忆已关闭",
    memoryOn: "记忆已启用",
    memoryWithModel: (modelName: string) => `记忆 · ${modelName}`,
    coreBadge: "内置",
    currentBadge: "当前",
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
        "切换当前对话背后的智能体。更深入的管理、发布和导出请前往智能体中心。",
      currentAgent: "当前智能体",
      currentAgentDescription: "选择负责当前对话的智能体和版本。",
      builtinDescription: "内置编排智能体",
      execution: "执行方式",
      remoteSession: "远程会话",
      defaultRuntime: "默认",
      remoteRuntime: "远程",
      remoteSessionPlaceholder: "输入远程会话 ID",
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
    officialWebsite: "访问 OpenAgents 官方网站",
    githubTooltip: "访问 OpenAgents 的 Github 仓库",
    settingsAndMore: "设置和更多",
    userRoleFallback: "用户",
    visitGithub: "在 Github 上查看 OpenAgents",
    reportIssue: "报告问题",
    contactUs: "联系我们",
    about: "关于 OpenAgents",
    adminConsole: "管理控制台",
    toggleSidebar: "切换侧边栏",
    artifactsPanelTitle: "文件",
    noArtifactSelectedTitle: "尚未选择文件",
    noArtifactSelectedDescription: "请选择一个文件以查看详情",
    officePreviewDialogDescription: "预览并编辑当前选中的 Office 文档。",
    todoListTitle: "待办事项",
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
    accountLabel: "账号",
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
    clarificationQuestion: "需要澄清",
    clarificationContext: "为什么需要这一步",
    clarificationOptions: "可选项",
    clarificationReplyPlaceholder: "输入你的回答",
    clarificationReplyAction: "发送回答",
    clarificationResumeError: "继续澄清流程失败。",
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
      tools: "工具",
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
      description: "管理 MCP 工具的配置和启用状态。",
      loadError: (message: string) =>
        message ? `加载工具失败：${message}` : "加载工具失败",
      emptyState: "当前还没有配置 MCP 工具。",
    },
    skills: {
      title: "技能",
      description: "管理 Agent Skill 配置和启用状态。",
      loadError: (message: string) =>
        message ? `加载技能失败：${message}` : "加载技能失败",
      createSkill: "新建技能",
      emptyTitle: "还没有技能",
      emptyDescription:
        "将新的 skill 创建或保存到 `.openagents/skills/store/dev`，验证后再继续推送和共享。",
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
