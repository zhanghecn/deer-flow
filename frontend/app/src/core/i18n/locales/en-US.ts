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

export const enUS: Translations = {
  // Locale meta
  locale: {
    localName: "English",
  },

  // Common
  common: {
    home: "Home",
    settings: "Settings",
    delete: "Delete",
    rename: "Rename",
    share: "Share",
    openInNewWindow: "Open in new window",
    close: "Close",
    more: "More",
    search: "Search",
    download: "Download",
    thinking: "Thinking",
    artifacts: "Artifacts",
    public: "Public",
    custom: "Custom",
    notAvailableInDemoMode: "Not available in demo mode",
    loading: "Loading...",
    version: "Version",
    lastUpdated: "Last updated",
    logout: "Log out",
    code: "Code",
    preview: "Preview",
    previewUnavailable: "Preview unavailable",
    inlinePreviewUnsupported:
      "This file type can't be previewed inline yet. Use Open in new window or Download.",
    cancel: "Cancel",
    save: "Save",
    install: "Install",
    create: "Create",
    clearAll: "Clear all",
  },

  // Commands
  commands: {
    knowledgeAdd:
      "Index the uploaded files into the current thread knowledge base",
    createAgent: "Create a new agent in the current workspace",
    createSkill: "Create a new skill in the current workspace",
    saveAgentToStore: "Save the current draft agent to the dev store",
    saveSkillToStore: "Save the current draft skill to the dev store",
    pushAgentProd: "Publish the current dev agent to prod",
    pushSkillProd: "Publish the current dev skill to prod",
  },

  // Welcome
  welcome: {
    greeting: "Hello, again!",
    description:
      "Welcome to OpenAgents, an open source super agent. With built-in and custom skills, OpenAgents helps you search on the web, analyze data, and generate artifacts like slides, web pages and do almost anything.",

    createYourOwnSkill: "Create Your Own Skill",
    createYourOwnSkillDescription:
      "Create your own skill to release the power of OpenAgents. With customized skills,\nOpenAgents can help you search on the web, analyze data, and generate\n artifacts like slides, web pages and do almost anything.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copy to clipboard",
    copiedToClipboard: "Copied to clipboard",
    failedToCopyToClipboard: "Failed to copy to clipboard",
    linkCopied: "Link copied to clipboard",
  },

  // Input Box
  inputBox: {
    placeholder: "How can I assist you today?",
    submit: "Submit",
    stop: "Stop",
    createSkillPrompt:
      "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
    addAttachments: "Add attachments",
    mode: "Mode",
    flashMode: "Flash",
    flashModeDescription: "Fast and efficient, but may not be accurate",
    proMode: "Pro",
    proModeDescription:
      "Reasoning, planning and executing, get more accurate results, may take more time",
    subagentToggle: "Subtasks",
    subagentToggleDescription:
      "Allow the agent to delegate work with the task tool and configured subagents when useful.",
    searchModels: "Search models...",
    surpriseMe: "Surprise",
    surpriseMePrompt: "Surprise me",
    quickInsertCommandBadge: "Command",
    quickInsertCommandsLabel: "Commands",
    quickInsertSkillsLabel: "Skills",
    retryingModel: (current, max, time) =>
      `Retrying model ${current}/${max} at ${time}`,
    retryingTool: (toolName, current, max, time) =>
      `Retrying ${toolName} ${current}/${max} at ${time}`,
    retryingToolGeneric: (current, max, time) =>
      `Retrying tool ${current}/${max} at ${time}`,
    retryDelay: (seconds) => `Next retry in ${seconds}s`,
    suggestions: [
      {
        suggestion: "Write",
        prompt: "Write a blog post about the latest trends on [topic]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Research",
        prompt:
          "Conduct a deep dive research on [topic], and summarize the findings.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Collect",
        prompt: "Collect data from [source] and create a report.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Learn",
        prompt: "Learn about [topic] and create a tutorial.",
        icon: GraduationCapIcon,
      },
    ],
    suggestionsCreate: [
      {
        suggestion: "Webpage",
        prompt: "Create a webpage about [topic]",
        icon: CompassIcon,
      },
      {
        suggestion: "Image",
        prompt: "Create an image about [topic]",
        icon: ImageIcon,
      },
      {
        suggestion: "Video",
        prompt: "Create a video about [topic]",
        icon: VideoIcon,
      },
      {
        type: "separator",
      },
      {
        suggestion: "Skill",
        prompt:
          "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
        icon: SparklesIcon,
      },
    ],
  },

  // Sidebar
  sidebar: {
    newChat: "New chat",
    workspaceDock: "Workspace",
    runtimeWorkspace: "Runtime workspace",
    designBoard: "Design board",
    chats: "Chats",
    recentChats: "Recent chats",
    demoChats: "Demo chats",
    agents: "Agents",
  },

  // Agents
  agents: {
    title: "Agents",
    description:
      "Create and manage custom agents with specialized prompts and capabilities.",
    newAgent: "New Agent",
    emptyTitle: "No custom agents yet",
    emptyDescription:
      "Create your first custom agent with a specialized system prompt.",
    chat: "Chat",
    copyUrl: "Copy URL",
    delete: "Delete",
    deleteConfirm:
      "Are you sure you want to delete this agent? This action cannot be undone.",
    deleteSuccess: "Agent deleted",
    publish: "Publish",
    publishSuccess: (agentName: string) => `Agent "${agentName}" published`,
    ownerBadge: "owner",
    ownedByYou: "Owned by you",
    ownedBy: (ownerName: string) => `Owned by ${ownerName}`,
    legacyOwnerless: "Unclaimed legacy agent",
    readOnlyBadge: "read only",
    memoryOff: "Memory off",
    memoryOn: "Memory on",
    memoryWithModel: (modelName: string) => `Memory · ${modelName}`,
    coreBadge: "core",
    currentBadge: "current",
    draftBadge: "draft",
    publishedBadge: "published",
    defaultDraft: "Draft default",
    defaultPublished: "Published default",
    draftOnly: "Draft only",
    publishedReady: "Published ready",
    publishedOnly: "Published only",
    publishToProd: "Publish to prod",
    newChat: "New chat",
    createPageTitle: "Design your Agent",
    createPageSubtitle:
      "Describe the agent you want — I'll help you create it through conversation.",
    nameStepTitle: "Name your new Agent",
    nameStepHint:
      "Letters, digits, and hyphens only — stored lowercase (e.g. code-reviewer)",
    nameStepPlaceholder: "e.g. code-reviewer",
    nameStepContinue: "Continue",
    nameStepInvalidError:
      "Invalid name — use only letters, digits, and hyphens",
    nameStepAlreadyExistsError: "An agent with this name already exists",
    nameStepCheckError: "Could not verify name availability — please try again",
    nameStepBootstrapMessage:
      "The new custom agent name is {name}. Let's bootstrap its **AGENTS.md**.",
    agentCreated: "Agent created!",
    startChatting: "Start chatting",
    backToGallery: "Back to Gallery",
    switcher: {
      title: "Switch agent",
      description:
        "Choose the agent behind this conversation. Use Settings for version-specific changes and deeper archive management.",
      currentAgent: "Current agent",
      currentAgentDescription:
        "Version switching stays lightweight here so picking another agent stays fast.",
      builtinDescription: "Built-in orchestration agent",
      version: "Version",
      versionDescription:
        "Use draft while iterating, then switch to published when validating the released copy.",
      draftVersion: "Draft",
      publishedVersion: "Published",
      chooseAnotherTitle: "Choose another agent",
      chooseAnotherDescription:
        "Search by name or description, then switch this conversation in one click.",
      total: (count: number) => `${count} total`,
      searchPlaceholder: "Search agents",
      loading: "Loading agents...",
      loadError: "Failed to load agents",
      empty: "No agents match this search.",
      availableIn: (statuses: string) => `Available in ${statuses}`,
    },
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Workspace",
    chats: "Chats",
  },

  // Workspace
  workspace: {
    settingsAndMore: "Settings and more",
    apiKeys: "API keys",
    userRoleFallback: "User",
    toggleSidebar: "Toggle Sidebar",
    artifactsPanelTitle: "Artifacts",
    filesSurfaceTitle: "Files",
    designSurfaceTitle: "Design",
    runtimeSurfaceTitle: "Runtime",
    closeWorkspaceDock: "Close workspace dock",
    noArtifactSelectedTitle: "No artifact selected",
    noArtifactSelectedDescription: "Select an artifact to view its details",
    noPreviewSelectedTitle: "No preview selected",
    noPreviewSelectedDescription:
      "Select a file from Files or reveal an artifact to preview it here.",
    noDesignSurfaceTitle: "No design session yet",
    noDesignSurfaceDescription:
      "Open the design editor to inspect or modify the thread's OpenPencil document.",
    noRuntimeSurfaceTitle: "No runtime session yet",
    noRuntimeSurfaceDescription:
      "Open the runtime workspace to inspect the active environment in a full tab.",
    noTargetFile: "No target file",
    designSurfaceDescription:
      "Design editing stays in a full OpenPencil tab. This dock keeps the current target file, selection, and sync state visible next to chat.",
    runtimeSurfaceDescription:
      "Runtime inspection stays in a full workspace tab. This dock keeps the current session status visible next to chat.",
    openDesignEditor: "Open design editor",
    reopenDesignEditor: "Reopen editor tab",
    openRuntimeSurface: "Open runtime workspace",
    reopenRuntimeSurface: "Reopen runtime tab",
    selectedNodesLabel: "Selected nodes",
    designStatusIdle: "Idle",
    designStatusLoading: "Loading",
    designStatusReady: "Ready",
    designStatusDirty: "Dirty",
    designStatusSaving: "Saving",
    designStatusSynced: "Synced",
    designStatusConflict: "Conflict",
    designStatusError: "Error",
    designPopupBlockedDescription:
      "The browser blocked the automatic design tab open. Use the button below to open the editor manually.",
    designSessionExpiredDescription:
      "The design session expired. Reopen the editor to resume syncing with Deer Flow.",
    designOpenFailedDescription:
      "Deer Flow could not reopen the design editor just now. Try opening it again from this panel.",
    designSyncFailedDescription:
      "The open design tab hit a save or sync failure. Keep the editor open and retry the action after checking the error above.",
    designRevisionLabel: "Revision",
    designRevisionUnavailable: "Waiting for first sync",
    designLastActivityLabel: "Last activity",
    designLastActivityUnavailable: "No activity yet",
    runtimeStatusIdle: "Idle",
    runtimeStatusOpening: "Opening",
    runtimeStatusActive: "Active",
    runtimeStatusFailed: "Failed",
    eventDesignSaved: "Design saved",
    eventRuntimeOpened: "Runtime opened",
    eventPreviewUpdated: "Preview updated",
    eventSelectedNodesCount: (count: number) =>
      `${count} selected node${count === 1 ? "" : "s"}`,
    officePreviewDialogDescription:
      "Preview and edit the selected office document.",
    todoListTitle: "To-dos",
  },

  knowledge: {
    sectionTitle: "Knowledge",
    manageButton: "Knowledge",
    loadingAttached: "Loading attached knowledge...",
    emptyAttached: "No knowledge base is attached to this thread yet.",
    chooseAtLeastOneFile: "Choose at least one file.",
    invalidSelectedModel:
      "Select a valid model before creating a knowledge base.",
    defaultBaseName: "Knowledge Base",
    indexQueued: "Knowledge indexing has been queued.",
    createError: "Failed to create knowledge base.",
    uploadButton: "Upload knowledge",
    newTitle: "New Knowledge Base",
    newDescription:
      "Upload PDF, Word, or Markdown files and build a persistent document tree index for this thread.",
    newDescriptionGlobal:
      "Upload PDF, Word, or Markdown files and build a shared persistent document tree index for the library.",
    modelLabel: "Index model",
    modelPlaceholder: "Select a model",
    namePlaceholder: "Knowledge base name",
    descriptionPlaceholder: "Optional description for the agent",
    managerTitle: "Knowledge Library",
    managerDescription:
      "Browse shared knowledge by owner, inspect build progress, and review the stored PageTree index and canonical text.",
    managerTitleGlobal: "Shared Knowledge Library",
    managerDescriptionGlobal:
      "Browse owner folders, inspect indexing progress, and compare stored PageTree data with the canonical source text.",
    libraryTitle: "Shared Library",
    libraryDescription:
      "Knowledge bases are grouped by owner. Attach a base to the current thread to make it available to the agent tools.",
    libraryDescriptionGlobal:
      "Knowledge bases are grouped by owner so you can inspect shared documents, preview source files, and audit stored index data.",
    searchPlaceholder: "Search owners, bases, or documents",
    loadingLibrary: "Loading knowledge library...",
    emptyLibrary: "No shared knowledge matches the current search.",
    noDocumentSelectedTitle: "No Document Selected",
    noDocumentSelectedDescription:
      "Choose a document on the left to inspect its build status, tree, and stored debug payload.",
    baseCount: (count: number) => `${count} base${count === 1 ? "" : "s"}`,
    documentCount: (count: number) =>
      `${count} document${count === 1 ? "" : "s"}`,
    readyCount: (count: number) => `${count} ready`,
    activeCount: (count: number) => `${count} active`,
    attachedBaseCount: (count: number) =>
      `${count} attached base${count === 1 ? "" : "s"}`,
    backToChat: "Back to chat",
    backToAgents: "Back to agents",
    visibilityShared: "Shared",
    visibilityPrivate: "Private",
    previewEnabled: "Preview enabled",
    previewDisabled: "Preview disabled",
    previewSetting: "Preview access",
    previewSettingHint: "Allow other users to open tree/debug/source previews.",
    previewUpdateEnabled: (name: string) =>
      `Enabled preview access for "${name}".`,
    previewUpdateDisabled: (name: string) =>
      `Disabled preview access for "${name}".`,
    previewUpdateError: "Failed to update preview access.",
    attach: "Attach",
    detach: "Detach",
    attached: "Attached",
    attachedSuccess: (name: string) => `Attached "${name}" to this thread.`,
    detachedSuccess: (name: string) => `Detached "${name}" from this thread.`,
    bindingError: "Failed to update knowledge binding.",
    deleteTitle: "Delete Knowledge Base",
    deleteDescription: (name: string) =>
      `Delete "${name}" and all of its indexed documents? This action cannot be undone.`,
    deleteSuccess: (name: string) => `Deleted "${name}".`,
    deleteError: "Failed to delete knowledge base.",
    clearAllTitle: "Clear Knowledge Bases",
    clearAllSelfDescription: (count: number) =>
      `Delete all ${count} of your knowledge bases? Indexed data, source files, and preview artifacts will also be removed. This action cannot be undone.`,
    clearAllOwnerDescription: (ownerName: string, count: number) =>
      `Delete all ${count} knowledge bases owned by "${ownerName}"? Indexed data, source files, and preview artifacts will also be removed. This action cannot be undone.`,
    clearAllSuccess: (count: number) =>
      `Cleared ${count} knowledge base${count === 1 ? "" : "s"}.`,
    clearAllOwnerSuccess: (ownerName: string, count: number) =>
      `Cleared ${count} knowledge base${count === 1 ? "" : "s"} for "${ownerName}".`,
    clearAllError: "Failed to clear knowledge bases.",
    buildProgressTitle: "Build Progress",
    buildProgressDescription:
      "Latest indexing stage, timing, and job status for the selected document.",
    stageLabel: "Stage",
    progressLabel: "Progress",
    elapsedLabel: "Elapsed",
    updatedAtLabel: "Updated",
    messageLabel: "Message",
    noBuildMessage: "No build message yet.",
    notAvailable: "N/A",
    overviewTab: "Overview",
    treeTab: "Tree",
    eventsTab: "Events",
    indexTab: "Index JSON",
    canonicalTab: "Canonical Text",
    treePending: "The document tree will appear after indexing finishes.",
    loadingTree: "Loading document tree...",
    emptyTree: "No tree nodes were returned for this document.",
    loadingEvents: "Loading build events...",
    emptyEvents: "No build events recorded yet.",
    loadingDebug: "Loading debug payload...",
    emptyCanonical: "No canonical text stored for this document.",
    pageLabel: "Page",
    lineLabel: "Line",
    pageCount: (count: number) => `${count} page${count === 1 ? "" : "s"}`,
    nodeCount: (count: number) => `${count} node${count === 1 ? "" : "s"}`,
    childCount: (count: number) => `${count} child${count === 1 ? "" : "ren"}`,
    status: {
      queued: "Queued",
      ready: "Ready",
      processing: "Indexing",
      error: "Error",
    },
    selector: {
      button: "Knowledge",
      title: "Select Knowledge Bases",
      description:
        "Search shared knowledge bases and update the thread bindings the agent will keep using across turns and refreshes.",
      searchPlaceholder: "Search knowledge bases, documents, or owners",
      results: "Knowledge Bases",
      empty: "No knowledge bases match this search.",
      apply: "Update thread knowledge",
      applied: "Thread knowledge bindings updated.",
      appliedCount: (count: number) =>
        `Attached ${count} knowledge base${count === 1 ? "" : "s"} to this thread.`,
      attachError: "Failed to update selected knowledge bases.",
      readyLabel: "Knowledge attached to this thread",
      selectedCount: (count: number) =>
        `${count} knowledge base${count === 1 ? "" : "s"}`,
    },
  },

  // Conversation
  conversation: {
    noMessages: "No messages yet",
    startConversation: "Start a conversation to see messages here",
  },

  // Chats
  chats: {
    searchChats: "Search chats",
    clearAll: "Clear all chats",
    clearAllConfirm:
      "Are you sure you want to delete all of your chats? This action cannot be undone.",
    clearAllSuccess: "All chats deleted",
  },

  // Auth
  auth: {
    heroTitle: "Build, research, and ship with a single agent workspace.",
    heroDescription:
      "Sign in to continue your threads, tools, skills, and sandboxes. If you are new, create an account and start from the same workspace immediately.",
    heroFeatureThreads: "Thread history and context stay synced.",
    heroFeatureSkills:
      "Agent skills and tool settings are ready out of the box.",
    heroFeatureJwt: "JWT-based auth for workspace and API features.",
    panelSubtitle: "Access your workspace in seconds.",
    badge: "v2.0 Auth",
    signInTab: "Sign in",
    registerTab: "Register",
    accountLabel: "Account",
    emailLabel: "Email",
    passwordLabel: "Password",
    nameLabel: "Name",
    confirmPasswordLabel: "Confirm password",
    loginEmailPlaceholder: "you@example.com",
    loginPasswordPlaceholder: "Enter your password",
    registerNamePlaceholder: "Your name",
    registerEmailPlaceholder: "you@example.com",
    registerPasswordPlaceholder: "At least 8 characters",
    confirmPasswordPlaceholder: "Type password again",
    signingIn: "Signing in...",
    signInAction: "Sign in",
    creatingAccount: "Creating account...",
    createAccountAction: "Create account",
    newHere: "New here?",
    createAccountLink: "Create an account",
    alreadyHaveAccount: "Already have an account?",
    signInLink: "Sign in",
    passwordMismatchError: "Passwords do not match.",
    passwordTooShortError: "Password must be at least 8 characters.",
    loginFailed: "Login failed",
    registrationFailed: "Registration failed",
  },

  // Page titles (document title)
  pages: {
    appName: "OpenAgents",
    chats: "Chats",
    newChat: "New chat",
    untitled: "Untitled",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `${count} more step${count === 1 ? "" : "s"}`,
    lessSteps: "Less steps",
    executeCommand: "Execute command",
    presentFiles: "Present files",
    needYourHelp: "Need your help",
    questionTitle: "Question from the agent",
    questionContext: "Why this is needed",
    questionOptions: "Suggested answers",
    questionProgress: (current: number, total: number) =>
      `Question ${current} of ${total}`,
    questionHintSingle: "Choose one option or type your own answer.",
    questionHintMultiple: "Choose one or more options, or add your own answer.",
    questionCustomAnswer: "Custom answer",
    questionReplyPlaceholder: "Type your answer",
    questionReplyAction: "Send answer",
    questionDismissAction: "Dismiss",
    questionBackAction: "Back",
    questionNextAction: "Next",
    questionSubmitAction: "Submit",
    questionResumeError: "Failed to continue the question flow.",
    questionDismissError: "Failed to dismiss the question request.",
    useTool: (toolName: string) => `Use "${toolName}" tool`,
    searchFor: (query: string) => `Search for "${query}"`,
    searchForRelatedInfo: "Search for related information",
    searchForRelatedImages: "Search for related images",
    searchForRelatedImagesFor: (query: string) =>
      `Search for related images for "${query}"`,
    searchOnWebFor: (query: string) => `Search on the web for "${query}"`,
    viewWebPage: "View web page",
    listFolder: "List folder",
    readFile: "Read file",
    writeFile: "Write file",
    clickToViewContent: "Click to view file content",
    writeTodos: "Update to-do list",
    skillInstallTooltip: "Install skill and make it available to OpenAgents",
  },

  // Subtasks
  uploads: {
    uploading: "Uploading...",
    uploadingFiles: "Uploading files, please wait...",
  },

  subtasks: {
    subtask: "Subtask",
    executing: (count: number) =>
      `Executing ${count === 1 ? "" : count + " "}subtask${count === 1 ? "" : "s in parallel"}`,
    completedGroup: (count: number) =>
      `Completed ${count === 1 ? "1 subtask" : `${count} subtasks`}`,
    failedGroup: (count: number) =>
      `${count === 1 ? "1 subtask failed" : `${count} subtasks failed`}`,
    in_progress: "Running subtask",
    completed: "Subtask completed",
    failed: "Subtask failed",
  },

  // Settings
  settings: {
    title: "Settings",
    description: "Adjust how OpenAgents looks and behaves for you.",
    sections: {
      appearance: "Appearance",
      tools: "Tools",
      skills: "Skills",
      notification: "Notification",
      about: "About",
    },
    appearance: {
      themeTitle: "Theme",
      themeDescription:
        "Choose how the interface follows your device or stays fixed.",
      system: "System",
      light: "Light",
      dark: "Dark",
      systemDescription: "Match the operating system preference automatically.",
      lightDescription: "Bright palette with higher contrast for daytime.",
      darkDescription: "Dim palette that reduces glare for focus.",
      languageTitle: "Language",
      languageDescription: "Switch between languages.",
    },
    tools: {
      title: "Tools",
      description: "Manage the configuration and enabled status of MCP tools.",
      loadError: (message: string) =>
        message ? `Failed to load tools: ${message}` : "Failed to load tools",
      emptyState: "No MCP tools are configured yet.",
    },
    skills: {
      title: "Agent Skills",
      description:
        "Manage the configuration and enabled status of the agent skills.",
      loadError: (message: string) =>
        message ? `Failed to load skills: ${message}` : "Failed to load skills",
      createSkill: "Create skill",
      emptyTitle: "No agent skill yet",
      emptyDescription:
        "Create or save skills into `.openagents/skills/store/dev`, then promote them through the store lifecycle when ready.",
      emptyButton: "Create Your First Skill",
    },
    notification: {
      title: "Notification",
      description:
        "OpenAgents only sends a completion notification when the window is not active. This is especially useful for long-running tasks so you can switch to other work and get notified when done.",
      requestPermission: "Request notification permission",
      deniedHint:
        "Notification permission was denied. You can enable it in your browser's site settings to receive completion alerts.",
      testButton: "Send test notification",
      testTitle: "OpenAgents",
      testBody: "This is a test notification.",
      notSupported: "Your browser does not support notifications.",
      disableNotification: "Disable notification",
    },
    acknowledge: {
      emptyTitle: "Acknowledgements",
      emptyDescription: "Credits and acknowledgements will show here.",
    },
  },
};
