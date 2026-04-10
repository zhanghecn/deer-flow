import type { Locale } from "@/core/i18n";

type APIKeyManagementPageText = {
  eyebrow: string;
  title: string;
  description: string;
  signedInAs: string;
  activeKeys: string;
  keyedAgents: string;
  publishedAgents: string;
  createSection: string;
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
  capabilitiesFootnote: string;
  createButton: string;
  creatingButton: string;
  tokenReadyTitle: string;
  tokenReadyDescription: string;
  tokenReadyCopy: string;
  tokenReadyCopied: string;
  inventorySection: string;
  inventoryTitle: string;
  inventoryDescription: string;
  inventoryAgentLabel: string;
  inventoryAgentPlaceholder: string;
  legacyUnscopedGroup: string;
  legacyMultiGroup: string;
  searchLabel: string;
  searchPlaceholder: string;
  loadingKeys: string;
  filterAll: string;
  filterActive: string;
  filterExpired: string;
  filterRevoked: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyFiltered: string;
  groupEmptyTitle: string;
  groupEmptyDescription: string;
  agentBindingLabel: string;
  createdAt: string;
  lastUsed: string;
  revokedAt: string;
  neverUsed: string;
  statusActive: string;
  statusExpired: string;
  statusRevoked: string;
  revokeButton: string;
  revokeConfirm: string;
  revokeCancel: string;
  revokeWarning: string;
  revoking: string;
  copy: string;
  copied: string;
  copyFailed: string;
  createSuccess: string;
  revokeSuccess: string;
  createFailed: string;
  revokeFailed: string;
  loadFailed: string;
  missingName: string;
  missingTargetAgent: string;
  scopesLine: string;
  actionsLabel: string;
  previousPage: string;
  nextPage: string;
  pageSummary: (current: number, total: number) => string;
};

const enUS: APIKeyManagementPageText = {
  eyebrow: "API keys",
  title: "User API keys",
  description:
    "Create and revoke single-agent keys tied to your workspace account. Each key now belongs to one published prod agent that you own.",
  signedInAs: "Signed in as",
  activeKeys: "Active keys",
  keyedAgents: "Keyed agents",
  publishedAgents: "Published agents",
  createSection: "Create",
  createTitle: "Mint a new key",
  createDescription:
    "Issue an integration key for one published prod agent. Broad multi-agent keys are no longer created here.",
  nameLabel: "Key name",
  namePlaceholder: "e.g. contract-reviewer-prod",
  targetAgentLabel: "Target agent",
  targetAgentPlaceholder: "Select a published prod agent",
  targetAgentHint:
    "API keys now bind to exactly one published prod agent owned by this account.",
  loadingAgents: "Loading published agents...",
  noOwnedPublishedAgents:
    "This account does not own any published prod agents yet. Publish one first to issue a key.",
  capabilitiesLabel: "Capabilities",
  capabilitiesDescription:
    "This page mints the current public API baseline: `responses:create`, `responses:read`, and `artifacts:read`.",
  capabilitiesFootnote: "Scopes remain fixed to the public API baseline.",
  createButton: "Create key",
  creatingButton: "Creating key...",
  tokenReadyTitle: "Plaintext key ready",
  tokenReadyDescription:
    "Copy it now. The full secret is not shown again after this view closes or refreshes.",
  tokenReadyCopy: "Copy plaintext key",
  tokenReadyCopied: "Plaintext key copied",
  inventorySection: "Inventory",
  inventoryTitle: "Key inventory",
  inventoryDescription:
    "Inspect keys one agent at a time, then search, copy, rotate, or revoke without mixing credentials across agents.",
  inventoryAgentLabel: "Agent group",
  inventoryAgentPlaceholder: "Select an agent group",
  legacyUnscopedGroup: "Legacy unscoped keys",
  legacyMultiGroup: "Legacy multi-agent keys",
  searchLabel: "Search keys",
  searchPlaceholder: "Search key name or token prefix",
  loadingKeys: "Loading your keys...",
  filterAll: "All",
  filterActive: "Active",
  filterExpired: "Expired",
  filterRevoked: "Revoked",
  emptyTitle: "No keys yet",
  emptyDescription:
    "Create the first single-agent key from the left panel to test or distribute one published agent at a time.",
  emptyFiltered: "No keys match this filter.",
  groupEmptyTitle: "No keys for this group",
  groupEmptyDescription:
    "Create a key for the selected agent from the left panel, or switch to another group.",
  agentBindingLabel: "Agent binding",
  createdAt: "Created",
  lastUsed: "Last used",
  revokedAt: "Revoked",
  neverUsed: "Never used",
  statusActive: "active",
  statusExpired: "expired",
  statusRevoked: "revoked",
  revokeButton: "Revoke key",
  revokeConfirm: "Confirm revoke",
  revokeCancel: "Cancel",
  revokeWarning:
    "Revocation is permanent. Clients using this key will stop working immediately.",
  revoking: "Revoking...",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed.",
  createSuccess: "API key created",
  revokeSuccess: "API key revoked",
  createFailed: "Failed to create API key.",
  revokeFailed: "Failed to revoke API key.",
  loadFailed: "Failed to load API keys.",
  missingName: "Key name is required.",
  missingTargetAgent: "Select one published prod agent.",
  scopesLine: "Scopes",
  actionsLabel: "Actions",
  previousPage: "Previous",
  nextPage: "Next",
  pageSummary: (current, total) => `Page ${current} / ${total}`,
};

const zhCN: APIKeyManagementPageText = {
  eyebrow: "API Key",
  title: "用户 API Key",
  description:
    "为当前账号创建和撤销单智能体 Key。每个 Key 现在只归属于一个由你创建并已发布的 prod agent。",
  signedInAs: "当前账号",
  activeKeys: "可用 Key",
  keyedAgents: "已发 Key 智能体",
  publishedAgents: "已发布智能体",
  createSection: "创建",
  createTitle: "签发新 Key",
  createDescription:
    "为单个已发布 prod agent 签发集成 Key。这里不再创建覆盖多个智能体的宽权限 Key。",
  nameLabel: "Key 名称",
  namePlaceholder: "例如 contract-reviewer-prod",
  targetAgentLabel: "目标智能体",
  targetAgentPlaceholder: "选择一个已发布 prod 智能体",
  targetAgentHint:
    "API Key 现在必须绑定到当前账号拥有的单个已发布 prod 智能体。",
  loadingAgents: "正在加载已发布智能体...",
  noOwnedPublishedAgents:
    "当前账号还没有自己拥有的已发布 prod 智能体。请先发布一个智能体再签发 Key。",
  capabilitiesLabel: "能力范围",
  capabilitiesDescription:
    "当前页面签发的是公开 API 的基线权限：`responses:create`、`responses:read` 和 `artifacts:read`。",
  capabilitiesFootnote: "当前仍固定使用公开 API 的基线权限。",
  createButton: "创建 Key",
  creatingButton: "创建中...",
  tokenReadyTitle: "明文 Key 已生成",
  tokenReadyDescription:
    "请现在复制。这个页面关闭或刷新后，不会再次展示完整 secret。",
  tokenReadyCopy: "复制明文 Key",
  tokenReadyCopied: "已复制明文 Key",
  inventorySection: "库存",
  inventoryTitle: "Key 列表",
  inventoryDescription:
    "按智能体视角逐个查看 Key，再搜索、复制、轮换或撤销，避免多个智能体的凭证混在一起。",
  inventoryAgentLabel: "智能体分组",
  inventoryAgentPlaceholder: "选择一个智能体分组",
  legacyUnscopedGroup: "历史无绑定 Key",
  legacyMultiGroup: "历史多智能体 Key",
  searchLabel: "搜索 Key",
  searchPlaceholder: "搜索 Key 名称或 token 前缀",
  loadingKeys: "正在加载你的 Key...",
  filterAll: "全部",
  filterActive: "可用",
  filterExpired: "已过期",
  filterRevoked: "已撤销",
  emptyTitle: "还没有 Key",
  emptyDescription:
    "先在左侧为单个已发布智能体创建第一个 Key，再逐个对外分发和管理。",
  emptyFiltered: "当前筛选条件下没有匹配的 Key。",
  groupEmptyTitle: "这个分组下还没有 Key",
  groupEmptyDescription:
    "可以在左侧为当前智能体创建 Key，或切换到其他分组查看已有 Key。",
  agentBindingLabel: "智能体绑定",
  createdAt: "创建时间",
  lastUsed: "最后使用",
  revokedAt: "撤销时间",
  neverUsed: "从未使用",
  statusActive: "可用",
  statusExpired: "已过期",
  statusRevoked: "已撤销",
  revokeButton: "撤销 Key",
  revokeConfirm: "确认撤销",
  revokeCancel: "取消",
  revokeWarning: "撤销后不可恢复，正在使用这个 Key 的客户端会立即失效。",
  revoking: "撤销中...",
  copy: "复制",
  copied: "已复制",
  copyFailed: "复制失败。",
  createSuccess: "API Key 已创建",
  revokeSuccess: "API Key 已撤销",
  createFailed: "创建 API Key 失败。",
  revokeFailed: "撤销 API Key 失败。",
  loadFailed: "加载 API Key 失败。",
  missingName: "请输入 Key 名称。",
  missingTargetAgent: "请选择一个已发布 prod 智能体。",
  scopesLine: "权限范围",
  actionsLabel: "操作",
  previousPage: "上一页",
  nextPage: "下一页",
  pageSummary: (current, total) => `第 ${current} / ${total} 页`,
};

export function getAPIKeyManagementPageText(locale: Locale) {
  return locale === "zh-CN" ? zhCN : enUS;
}
