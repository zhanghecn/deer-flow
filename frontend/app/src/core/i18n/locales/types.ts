import type { LucideIcon } from "lucide-react";

export interface Translations {
  // Locale meta
  locale: {
    localName: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    rename: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    download: string;
    thinking: string;
    artifacts: string;
    public: string;
    custom: string;
    notAvailableInDemoMode: string;
    loading: string;
    version: string;
    lastUpdated: string;
    logout: string;
    code: string;
    preview: string;
    previewUnavailable: string;
    inlinePreviewUnsupported: string;
    cancel: string;
    save: string;
    install: string;
    create: string;
    clearAll: string;
  };

  // Commands
  commands: {
    knowledgeAdd: string;
    createAgent: string;
    createSkill: string;
    saveAgentToStore: string;
    saveSkillToStore: string;
    pushAgentProd: string;
    pushSkillProd: string;
  };

  // Welcome
  welcome: {
    greeting: string;
    description: string;
    createYourOwnSkill: string;
    createYourOwnSkillDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    submit: string;
    stop: string;
    createSkillPrompt: string;
    addAttachments: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    proMode: string;
    proModeDescription: string;
    subagentToggle: string;
    subagentToggleDescription: string;
    searchModels: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    quickInsertCommandBadge: string;
    quickInsertCommandsLabel: string;
    quickInsertSkillsLabel: string;
    retryingModel: (current: number, max: number, time: string) => string;
    retryingTool: (
      toolName: string,
      current: number,
      max: number,
      time: string,
    ) => string;
    retryingToolGeneric: (current: number, max: number, time: string) => string;
    retryDelay: (seconds: string) => string;
    executionThinking: (elapsed?: string) => string;
    executionRunningTool: (toolName: string | undefined, elapsed?: string) => string;
    executionFinalizing: (elapsed?: string) => string;
    executionRetryCompleted: string;
    executionRetryFailed: string;
    executionCompleted: (elapsed?: string) => string;
    executionFailed: (elapsed?: string) => string;
    executionStopped: (elapsed?: string) => string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    workspaceDock: string;
    runtimeWorkspace: string;
    designBoard: string;
    chats: string;
    demoChats: string;
    agents: string;
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    chat: string;
    copyUrl: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    deleteArchiveTitle: (agentName: string) => string;
    deleteArchiveDescription: (agentName: string) => string;
    deleteDraft: string;
    deletePublished: string;
    deleteAllArchives: string;
    deleteDraftSuccess: (agentName: string) => string;
    deletePublishedSuccess: (agentName: string) => string;
    deleteAllArchivesSuccess: (agentName: string) => string;
    publish: string;
    publishSuccess: (agentName: string) => string;
    ownerBadge: string;
    ownedByYou: string;
    ownedBy: (ownerName: string) => string;
    legacyOwnerless: string;
    readOnlyBadge: string;
    memoryOff: string;
    memoryOn: string;
    memoryWithModel: (modelName: string) => string;
    coreBadge: string;
    currentBadge: string;
    draftBadge: string;
    publishedBadge: string;
    defaultDraft: string;
    defaultPublished: string;
    draftOnly: string;
    publishedReady: string;
    publishedOnly: string;
    publishToProd: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepCheckError: string;
    nameStepBootstrapMessage: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
    switcher: {
      title: string;
      description: string;
      currentAgent: string;
      currentAgentDescription: string;
      builtinDescription: string;
      version: string;
      versionDescription: string;
      draftVersion: string;
      publishedVersion: string;
      chooseAnotherTitle: string;
      chooseAnotherDescription: string;
      total: (count: number) => string;
      searchPlaceholder: string;
      loading: string;
      loadError: string;
      empty: string;
      availableIn: (statuses: string) => string;
    };
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
  };

  // Workspace
  workspace: {
    settingsAndMore: string;
    apiKeys: string;
    userRoleFallback: string;
    toggleSidebar: string;
    artifactsPanelTitle: string;
    filesSurfaceTitle: string;
    designSurfaceTitle: string;
    runtimeSurfaceTitle: string;
    closeWorkspaceDock: string;
    noArtifactSelectedTitle: string;
    noArtifactSelectedDescription: string;
    noPreviewSelectedTitle: string;
    noPreviewSelectedDescription: string;
    noDesignSurfaceTitle: string;
    noDesignSurfaceDescription: string;
    noRuntimeSurfaceTitle: string;
    noRuntimeSurfaceDescription: string;
    noTargetFile: string;
    designSurfaceDescription: string;
    runtimeSurfaceDescription: string;
    openDesignEditor: string;
    reopenDesignEditor: string;
    openRuntimeSurface: string;
    reopenRuntimeSurface: string;
    selectedNodesLabel: string;
    designStatusIdle: string;
    designStatusLoading: string;
    designStatusReady: string;
    designStatusDirty: string;
    designStatusSaving: string;
    designStatusSynced: string;
    designStatusConflict: string;
    designStatusError: string;
    designPopupBlockedDescription: string;
    designSessionExpiredDescription: string;
    designOpenFailedDescription: string;
    designSyncFailedDescription: string;
    designRevisionLabel: string;
    designRevisionUnavailable: string;
    designLastActivityLabel: string;
    designLastActivityUnavailable: string;
    runtimeStatusIdle: string;
    runtimeStatusOpening: string;
    runtimeStatusActive: string;
    runtimeStatusFailed: string;
    eventDesignSaved: string;
    eventRuntimeOpened: string;
    eventPreviewUpdated: string;
    eventSelectedNodesCount: (count: number) => string;
    officePreviewDialogDescription: string;
    todoListTitle: string;
  };

  knowledge: {
    sectionTitle: string;
    manageButton: string;
    loadingAttached: string;
    emptyAttached: string;
    chooseAtLeastOneFile: string;
    invalidSelectedModel: string;
    defaultBaseName: string;
    indexQueued: string;
    createError: string;
    uploadButton: string;
    newTitle: string;
    newDescription: string;
    newDescriptionGlobal: string;
    modelLabel: string;
    modelPlaceholder: string;
    namePlaceholder: string;
    descriptionPlaceholder: string;
    managerTitle: string;
    managerDescription: string;
    managerTitleGlobal: string;
    managerDescriptionGlobal: string;
    libraryTitle: string;
    libraryDescription: string;
    libraryDescriptionGlobal: string;
    searchPlaceholder: string;
    loadingLibrary: string;
    emptyLibrary: string;
    noDocumentSelectedTitle: string;
    noDocumentSelectedDescription: string;
    baseCount: (count: number) => string;
    documentCount: (count: number) => string;
    readyCount: (count: number) => string;
    activeCount: (count: number) => string;
    attachedBaseCount: (count: number) => string;
    backToChat: string;
    backToAgents: string;
    visibilityShared: string;
    visibilityPrivate: string;
    previewEnabled: string;
    previewDisabled: string;
    previewSetting: string;
    previewSettingHint: string;
    previewUpdateEnabled: (name: string) => string;
    previewUpdateDisabled: (name: string) => string;
    previewUpdateError: string;
    attach: string;
    detach: string;
    attached: string;
    attachedSuccess: (name: string) => string;
    detachedSuccess: (name: string) => string;
    bindingError: string;
    deleteTitle: string;
    deleteDescription: (name: string) => string;
    deleteSuccess: (name: string) => string;
    deleteError: string;
    clearAllTitle: string;
    clearAllSelfDescription: (count: number) => string;
    clearAllOwnerDescription: (ownerName: string, count: number) => string;
    clearAllSuccess: (count: number) => string;
    clearAllOwnerSuccess: (ownerName: string, count: number) => string;
    clearAllError: string;
    buildProgressTitle: string;
    buildProgressDescription: string;
    stageLabel: string;
    progressLabel: string;
    elapsedLabel: string;
    updatedAtLabel: string;
    messageLabel: string;
    noBuildMessage: string;
    notAvailable: string;
    overviewTab: string;
    treeTab: string;
    eventsTab: string;
    indexTab: string;
    canonicalTab: string;
    treePending: string;
    loadingTree: string;
    emptyTree: string;
    loadingEvents: string;
    emptyEvents: string;
    loadingDebug: string;
    emptyCanonical: string;
    pageLabel: string;
    lineLabel: string;
    pageCount: (count: number) => string;
    nodeCount: (count: number) => string;
    childCount: (count: number) => string;
    status: {
      queued: string;
      ready: string;
      processing: string;
      error: string;
    };
    selector: {
      button: string;
      title: string;
      description: string;
      searchPlaceholder: string;
      results: string;
      empty: string;
      apply: string;
      applied: string;
      appliedCount: (count: number) => string;
      attachError: string;
      readyLabel: string;
      selectedCount: (count: number) => string;
    };
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
  };

  // Chats
  chats: {
    searchChats: string;
    clearAll: string;
    clearAllConfirm: string;
    clearAllSuccess: string;
  };

  // Auth
  auth: {
    heroTitle: string;
    heroDescription: string;
    heroFeatureThreads: string;
    heroFeatureSkills: string;
    heroFeatureJwt: string;
    panelSubtitle: string;
    badge: string;
    signInTab: string;
    registerTab: string;
    accountLabel: string;
    emailLabel: string;
    passwordLabel: string;
    nameLabel: string;
    confirmPasswordLabel: string;
    loginEmailPlaceholder: string;
    loginPasswordPlaceholder: string;
    registerNamePlaceholder: string;
    registerEmailPlaceholder: string;
    registerPasswordPlaceholder: string;
    confirmPasswordPlaceholder: string;
    signingIn: string;
    signInAction: string;
    creatingAccount: string;
    createAccountAction: string;
    newHere: string;
    createAccountLink: string;
    alreadyHaveAccount: string;
    signInLink: string;
    passwordMismatchError: string;
    passwordTooShortError: string;
    loginFailed: string;
    registrationFailed: string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    newChat: string;
    untitled: string;
  };

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    questionTitle: string;
    questionContext: string;
    questionOptions: string;
    questionProgress: (current: number, total: number) => string;
    questionHintSingle: string;
    questionHintMultiple: string;
    questionCustomAnswer: string;
    questionReplyPlaceholder: string;
    questionReplyAction: string;
    questionDismissAction: string;
    questionBackAction: string;
    questionNextAction: string;
    questionSubmitAction: string;
    questionResumeError: string;
    questionDismissError: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    executing: (count: number) => string;
    completedGroup: (count: number) => string;
    failedGroup: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    sections: {
      appearance: string;
      tools: string;
      skills: string;
      notification: string;
      about: string;
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      languageTitle: string;
      languageDescription: string;
    };
    tools: {
      title: string;
      description: string;
      loadError: (message: string) => string;
      emptyState: string;
      createProfile: string;
      editProfile: string;
      profileCreated: string;
      profileUpdated: string;
      profileDeleted: string;
      profileName: string;
      profileConfig: string;
      saveProfile: string;
      saveError: string;
    };
    skills: {
      title: string;
      description: string;
      loadError: (message: string) => string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };
}
