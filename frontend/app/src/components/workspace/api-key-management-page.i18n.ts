import type { Locale } from "@/core/i18n";

type APIKeyManagementPageText = {
  eyebrow: string;
  title: string;
  description: string;
  signedInAs: string;
  contractTitle: string;
  contractDescription: string;
  summaryPublishedAgents: string;
  summaryActiveKeys: string;
  summaryRotation: string;
  summaryPublishedHint: string;
  summaryActiveHint: string;
  summaryRotationHint: string;
  openCreateDialog: string;
  inventoryAllLabel: string;
  createTitle: string;
  createDescription: string;
  nameLabel: string;
  namePlaceholder: string;
  targetAgentLabel: string;
  targetAgentPlaceholder: string;
  targetAgentHint: string;
  loadingAgents: string;
  noOwnedPublishedAgents: string;
  capabilitiesLabel: string;
  capabilitiesDescription: string;
  createButton: string;
  creatingButton: string;
  tokenReadyTitle: string;
  tokenReadyDescription: string;
  tokenReadyHint: string;
  tokenReadyCopied: string;
  freshStatusLabel: string;
  operatorNotesTitle: string;
  operatorIsolationNote: string;
  operatorRotationNote: string;
  operatorSurfaceNote: string;
  inventoryTitle: string;
  inventoryDescription: string;
  inventoryIdentityHeader: string;
  inventoryAgentHeader: string;
  inventorySurfaceHeader: string;
  inventoryCreatedHeader: string;
  inventoryLifecycleHeader: string;
  unsupportedGroup: string;
  searchLabel: string;
  searchPlaceholder: string;
  loadingKeys: string;
  emptyTitle: string;
  emptyDescription: string;
  emptySearch: string;
  groupEmptyTitle: string;
  groupEmptyDescription: string;
  keyUnavailableTitle: string;
  keyUnavailableDescription: string;
  deleteButton: string;
  deleteConfirm: string;
  deleteCancel: string;
  deleteWarning: string;
  deleting: string;
  copyFailed: string;
  createSuccess: string;
  deleteSuccess: string;
  createFailed: string;
  deleteFailed: string;
  loadFailed: string;
  missingName: string;
  missingTargetAgent: string;
  previousPage: string;
  nextPage: string;
  pageSummary: (current: number, total: number) => string;
};

const enUS: APIKeyManagementPageText = {
  eyebrow: "API keys",
  title: "API key management",
  description:
    "Create, copy, and revoke keys for the published agents you own. Each key is bound to exactly one prod agent.",
  signedInAs: "Signed in as",
  contractTitle: "Contract",
  contractDescription: "One key maps to one published prod agent.",
  summaryPublishedAgents: "Published agents",
  summaryActiveKeys: "Active keys",
  summaryRotation: "Needs rotation",
  summaryPublishedHint: "Every key lands on a single released contract.",
  summaryActiveHint:
    "Fresh keys stay copyable from the main list instead of disappearing after creation.",
  summaryRotationHint:
    "Legacy rows are isolated and clearly called out before they surprise an operator.",
  openCreateDialog: "New key",
  inventoryAllLabel: "All active",
  createTitle: "Create key",
  createDescription:
    "Select the published agent, enter a key name, and issue a new key.",
  nameLabel: "Key name",
  namePlaceholder: "e.g. contract-reviewer-prod",
  targetAgentLabel: "Published agent",
  targetAgentPlaceholder: "Select a published prod agent",
  targetAgentHint:
    "API keys bind to exactly one published prod agent owned by this account.",
  loadingAgents: "Loading published agents...",
  noOwnedPublishedAgents:
    "This account does not own any published prod agents yet. Publish one first to issue a key.",
  capabilitiesLabel: "Baseline contract",
  capabilitiesDescription: "All new keys include the fixed public API scopes.",
  createButton: "Create key",
  creatingButton: "Creating key...",
  tokenReadyTitle: "Plaintext key ready",
  tokenReadyDescription: "Copy it here or directly from the table.",
  tokenReadyHint: "The same full key is now visible in the inventory table.",
  tokenReadyCopied: "Key copied",
  freshStatusLabel: "Latest",
  operatorNotesTitle: "Operator notes",
  operatorIsolationNote:
    "Keys stay split by published agent. There is no broad shared contract hidden behind one credential.",
  operatorRotationNote:
    "Older rows cannot reveal plaintext again. They must rotate if operators still need copy access.",
  operatorSurfaceNote:
    "Creation, copying, and cleanup now happen on the same page instead of bouncing between separate surfaces.",
  inventoryTitle: "Issued keys",
  inventoryDescription:
    "Full keys stay visible in one compact table. Click the key itself to copy it.",
  inventoryIdentityHeader: "Key name",
  inventoryAgentHeader: "Agent",
  inventorySurfaceHeader: "Key",
  inventoryCreatedHeader: "Created",
  inventoryLifecycleHeader: "Actions",
  unsupportedGroup: "Unsupported keys",
  searchLabel: "Search keys",
  searchPlaceholder: "Search key, name, or agent",
  loadingKeys: "Loading your keys...",
  emptyTitle: "No keys yet",
  emptyDescription:
    "Create the first single-agent key to test or distribute one published agent at a time.",
  emptySearch: "No keys match your search.",
  groupEmptyTitle: "No keys for this group",
  groupEmptyDescription:
    "Create a key for the selected agent, or switch to another group.",
  keyUnavailableTitle: "Rotate required",
  keyUnavailableDescription:
    "This older key was created before full-key display was stored. Delete it and create a new key to copy it from the list.",
  deleteButton: "Delete key",
  deleteConfirm: "Delete key",
  deleteCancel: "Cancel",
  deleteWarning:
    "Deletion is permanent. Clients using this key will stop working immediately.",
  deleting: "Deleting...",
  copyFailed: "Copy failed.",
  createSuccess: "API key created",
  deleteSuccess: "API key deleted",
  createFailed: "Failed to create API key.",
  deleteFailed: "Failed to delete API key.",
  loadFailed: "Failed to load API keys.",
  missingName: "Key name is required.",
  missingTargetAgent: "Select one published prod agent.",
  previousPage: "Previous",
  nextPage: "Next",
  pageSummary: (current, total) => `Page ${current} / ${total}`,
};

const zhCN: APIKeyManagementPageText = {
  eyebrow: "API Key",
  title: "API Key 管理",
  description:
    "为你已发布的智能体创建、复制和删除集成 Key。每个 Key 只绑定一个 prod agent。",
  signedInAs: "当前账号",
  contractTitle: "契约",
  contractDescription: "一个 Key 只映射到一个已发布 prod 智能体。",
  summaryPublishedAgents: "已发布智能体",
  summaryActiveKeys: "有效 Key",
  summaryRotation: "待轮换",
  summaryPublishedHint: "每个 Key 都落到一个明确的已发布契约上。",
  summaryActiveHint: "新 Key 会继续显示在主列表里，不会在创建后立刻消失。",
  summaryRotationHint: "旧 Key 会被单独标出，避免运维人员后知后觉地踩坑。",
  openCreateDialog: "新建 Key",
  inventoryAllLabel: "全部有效",
  createTitle: "创建 Key",
  createDescription: "选择已发布智能体，填写 Key 名称，然后签发新 Key。",
  nameLabel: "Key 名称",
  namePlaceholder: "例如 contract-reviewer-prod",
  targetAgentLabel: "已发布智能体",
  targetAgentPlaceholder: "选择一个已发布 prod 智能体",
  targetAgentHint: "API Key 必须绑定到当前账号拥有的单个已发布 prod 智能体。",
  loadingAgents: "正在加载已发布智能体...",
  noOwnedPublishedAgents:
    "当前账号还没有自己拥有的已发布 prod 智能体。请先发布一个智能体再签发 Key。",
  capabilitiesLabel: "基线契约",
  capabilitiesDescription: "新建 Key 默认包含固定的公开 API 权限。",
  createButton: "创建 Key",
  creatingButton: "创建中...",
  tokenReadyTitle: "明文 Key 已生成",
  tokenReadyDescription: "可以从这里复制，也可以直接从表格中复制。",
  tokenReadyHint: "同一条完整 Key 已经同步显示在右侧表格中。",
  tokenReadyCopied: "已复制 Key",
  freshStatusLabel: "最新",
  operatorNotesTitle: "运维提示",
  operatorIsolationNote:
    "Key 会按照已发布智能体隔离，不会再把多个契约混在一把凭证后面。",
  operatorRotationNote:
    "旧行无法再次回显明文。如果仍需要复制入口，只能删除并重新创建。",
  operatorSurfaceNote:
    "创建、复制和清理都收在一个页面里，不再让用户在多个零散入口之间来回切换。",
  inventoryTitle: "已签发 Key",
  inventoryDescription:
    "完整 Key 会直接显示在紧凑表格里，点击 Key 本身即可复制。",
  inventoryIdentityHeader: "Key 名称",
  inventoryAgentHeader: "智能体",
  inventorySurfaceHeader: "Key",
  inventoryCreatedHeader: "创建时间",
  inventoryLifecycleHeader: "操作",
  unsupportedGroup: "不受支持的 Key",
  searchLabel: "搜索 Key",
  searchPlaceholder: "搜索 Key、名称或智能体",
  loadingKeys: "正在加载你的 Key...",
  emptyTitle: "还没有 Key",
  emptyDescription:
    "先为单个已发布智能体创建第一个 Key，再逐个对外分发和管理。",
  emptySearch: "没有匹配当前搜索条件的 Key。",
  groupEmptyTitle: "这个分组下还没有 Key",
  groupEmptyDescription:
    "可以为当前智能体创建 Key，或切换到其他分组查看已有 Key。",
  keyUnavailableTitle: "需要重建",
  keyUnavailableDescription:
    "这个旧 Key 创建时没有保存可回显明文。请删除后重新创建，列表里才会直接显示完整 Key。",
  deleteButton: "删除 Key",
  deleteConfirm: "确认删除",
  deleteCancel: "取消",
  deleteWarning: "删除后不可恢复，正在使用这个 Key 的客户端会立即失效。",
  deleting: "删除中...",
  copyFailed: "复制失败。",
  createSuccess: "API Key 已创建",
  deleteSuccess: "API Key 已删除",
  createFailed: "创建 API Key 失败。",
  deleteFailed: "删除 API Key 失败。",
  loadFailed: "加载 API Key 失败。",
  missingName: "请输入 Key 名称。",
  missingTargetAgent: "请选择一个已发布 prod 智能体。",
  previousPage: "上一页",
  nextPage: "下一页",
  pageSummary: (current, total) => `第 ${current} / ${total} 页`,
};

export function getAPIKeyManagementPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
