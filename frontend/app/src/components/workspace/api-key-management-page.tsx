import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useAgents } from "@/core/agents";
import { useAuth } from "@/core/auth/hooks";
import {
  createAPIToken,
  deleteAPIToken,
  listAPITokens,
  type APITokenCreateResponse,
  type APITokenRecord,
} from "@/core/auth/tokens";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { getAPIKeyManagementPageText } from "./api-key-management-page.i18n";

type KeyFilter = "all" | "active" | "expired" | "revoked";
type EffectiveTokenStatus = "active" | "expired" | "revoked";
type InventoryGroup = {
  id: string;
  label: string;
  count: number;
};

const FIXED_PUBLIC_API_SCOPES = [
  "responses:create",
  "responses:read",
  "artifacts:read",
];
const LEGACY_UNSCOPED_GROUP_ID = "__legacy_unscoped__";
const LEGACY_MULTI_GROUP_ID = "__legacy_multi__";
const TOKENS_PER_PAGE = 10;

function formatTimestamp(
  timestamp: string | null | undefined,
  locale: string,
  fallback: string,
) {
  if (!timestamp) {
    return fallback;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function resolveEffectiveTokenStatus(token: APITokenRecord): EffectiveTokenStatus {
  if (token.revoked_at || token.status === "revoked") {
    return "revoked";
  }

  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    return "expired";
  }

  return "active";
}

function statusBadgeClass(status: EffectiveTokenStatus) {
  switch (status) {
    case "expired":
      return "border-amber-200 bg-amber-50 text-amber-950";
    case "revoked":
      return "border-rose-200 bg-rose-50 text-rose-950";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function tokenMatchesInventorySearch(token: APITokenRecord, query: string) {
  if (!query) {
    return true;
  }

  return [token.name, token.token_prefix, ...token.allowed_agents]
    .join("\n")
    .toLowerCase()
    .includes(query);
}

function resolveTokenGroupID(token: APITokenRecord) {
  if (token.allowed_agents.length === 1) {
    const agentName = token.allowed_agents[0];
    if (agentName) {
      return agentName;
    }
  }
  if (token.allowed_agents.length === 0) {
    return LEGACY_UNSCOPED_GROUP_ID;
  }
  return LEGACY_MULTI_GROUP_ID;
}

function FieldLabel({
  children,
  hint,
}: {
  children: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-slate-950">{children}</p>
      {hint ? (
        <p className="text-sm leading-6 text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function StatMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="space-y-1 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <dt className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
        {value}
      </dd>
    </div>
  );
}

export function APIKeyManagementPage() {
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const text = getAPIKeyManagementPageText(locale);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [selectedCreateAgent, setSelectedCreateAgent] = useState("");
  const [filter, setFilter] = useState<KeyFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInventoryGroup, setSelectedInventoryGroup] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [createdToken, setCreatedToken] = useState("");
  const [copiedPlaintext, setCopiedPlaintext] = useState(false);
  const [copiedTokenID, setCopiedTokenID] = useState<string | null>(null);
  const [pendingRevokeID, setPendingRevokeID] = useState<string | null>(null);
  // Defer the free-text filter so inventories remain responsive even when the
  // current user has accumulated many historical keys.
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const tokensQuery = useQuery({
    queryKey: ["auth", "api-tokens"],
    queryFn: listAPITokens,
  });
  const { agents: prodAgents, isLoading: loadingAgents } = useAgents("prod");

  const ownedProdAgents = useMemo(
    () =>
      prodAgents
        .filter(
          (agent) =>
            agent.status === "prod" &&
            agent.owner_user_id === user?.id &&
            agent.name.trim().length > 0,
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [prodAgents, user?.id],
  );
  const normalizedSearchQuery = useMemo(
    () => normalizeSearchValue(deferredSearchQuery),
    [deferredSearchQuery],
  );

  useEffect(() => {
    if (ownedProdAgents.length === 0) {
      if (selectedCreateAgent) {
        setSelectedCreateAgent("");
      }
      return;
    }

    if (!ownedProdAgents.some((agent) => agent.name === selectedCreateAgent)) {
      const firstOwnedAgent = ownedProdAgents[0];
      if (firstOwnedAgent) {
        setSelectedCreateAgent(firstOwnedAgent.name);
      }
    }
  }, [ownedProdAgents, selectedCreateAgent]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error(text.missingName);
      }
      if (!selectedCreateAgent) {
        throw new Error(text.missingTargetAgent);
      }

      return createAPIToken({
        name: trimmedName,
        scopes: FIXED_PUBLIC_API_SCOPES,
        // API keys now map to exactly one published prod agent so audit logs
        // and operator UX can reason about one key -> one agent contract.
        allowed_agents: [selectedCreateAgent],
        metadata: {
          source: "workspace_api_key_manager",
          agent_name: selectedCreateAgent,
        },
      });
    },
    onSuccess: async (token: APITokenCreateResponse) => {
      setCreatedToken(token.token ?? "");
      setCopiedPlaintext(false);
      setName("");
      setPendingRevokeID(null);
      setSearchQuery("");
      setCurrentPage(1);
      if (token.allowed_agents[0]) {
        setSelectedInventoryGroup(token.allowed_agents[0]);
      }
      toast.success(text.createSuccess);
      await queryClient.invalidateQueries({ queryKey: ["auth", "api-tokens"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : text.createFailed);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (tokenID: string) => {
      await deleteAPIToken(tokenID);
      return tokenID;
    },
    onSuccess: async () => {
      setPendingRevokeID(null);
      toast.success(text.revokeSuccess);
      await queryClient.invalidateQueries({ queryKey: ["auth", "api-tokens"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : text.revokeFailed);
    },
  });

  const filteredTokens = useMemo(() => {
    const tokens = tokensQuery.data ?? [];
    return tokens.filter((token) => {
      const matchesFilter =
        filter === "all" || resolveEffectiveTokenStatus(token) === filter;
      return (
        matchesFilter &&
        tokenMatchesInventorySearch(token, normalizedSearchQuery)
      );
    });
  }, [filter, normalizedSearchQuery, tokensQuery.data]);

  const groupedTokens = useMemo(() => {
    const groups = new Map<string, APITokenRecord[]>();
    for (const token of filteredTokens) {
      const groupID = resolveTokenGroupID(token);
      const existing = groups.get(groupID);
      if (existing) {
        existing.push(token);
      } else {
        groups.set(groupID, [token]);
      }
    }
    for (const tokens of groups.values()) {
      tokens.sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      );
    }
    return groups;
  }, [filteredTokens]);

  const inventoryGroups = useMemo(() => {
    const keyedAgentGroups = new Map<string, InventoryGroup>();
    // Keep the create form strict to owned prod agents, but let the inventory
    // show every single-agent key group the account already has so historical
    // credentials do not disappear just because ownership rules hardened later.
    for (const [groupID, tokens] of groupedTokens.entries()) {
      if (
        groupID === LEGACY_UNSCOPED_GROUP_ID ||
        groupID === LEGACY_MULTI_GROUP_ID
      ) {
        continue;
      }

      keyedAgentGroups.set(groupID, {
        id: groupID,
        label: groupID,
        count: tokens.length,
      });
    }

    for (const agent of ownedProdAgents) {
      const existingGroup = keyedAgentGroups.get(agent.name);
      keyedAgentGroups.set(agent.name, {
        id: agent.name,
        label: agent.name,
        count: existingGroup?.count ?? 0,
      });
    }

    const ownedAgentNames = new Set(ownedProdAgents.map((agent) => agent.name));
    const ownedAgentGroups: InventoryGroup[] = [];
    const historicalAgentGroups: InventoryGroup[] = [];

    for (const group of keyedAgentGroups.values()) {
      if (ownedAgentNames.has(group.id)) {
        ownedAgentGroups.push(group);
        continue;
      }
      historicalAgentGroups.push(group);
    }

    ownedAgentGroups.sort((left, right) => left.label.localeCompare(right.label));
    historicalAgentGroups.sort((left, right) =>
      left.label.localeCompare(right.label),
    );

    const groups: InventoryGroup[] = [
      ...ownedAgentGroups,
      ...historicalAgentGroups,
    ];

    const legacyUnscopedCount =
      groupedTokens.get(LEGACY_UNSCOPED_GROUP_ID)?.length ?? 0;
    if (legacyUnscopedCount > 0) {
      groups.push({
        id: LEGACY_UNSCOPED_GROUP_ID,
        label: text.legacyUnscopedGroup,
        count: legacyUnscopedCount,
      });
    }

    const legacyMultiCount = groupedTokens.get(LEGACY_MULTI_GROUP_ID)?.length ?? 0;
    if (legacyMultiCount > 0) {
      groups.push({
        id: LEGACY_MULTI_GROUP_ID,
        label: text.legacyMultiGroup,
        count: legacyMultiCount,
      });
    }

    return groups;
  }, [groupedTokens, ownedProdAgents, text.legacyMultiGroup, text.legacyUnscopedGroup]);

  useEffect(() => {
    if (inventoryGroups.length === 0) {
      if (selectedInventoryGroup) {
        setSelectedInventoryGroup("");
      }
      return;
    }

    if (inventoryGroups.some((group) => group.id === selectedInventoryGroup)) {
      return;
    }

    const firstNonEmptyGroup =
      inventoryGroups.find((group) => group.count > 0) ?? inventoryGroups[0];
    if (firstNonEmptyGroup) {
      setSelectedInventoryGroup(firstNonEmptyGroup.id);
    }
  }, [inventoryGroups, selectedInventoryGroup]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, normalizedSearchQuery, selectedInventoryGroup]);

  const selectedGroup = useMemo(
    () =>
      inventoryGroups.find((group) => group.id === selectedInventoryGroup) ?? null,
    [inventoryGroups, selectedInventoryGroup],
  );
  const selectedGroupTokens = useMemo(
    () => (selectedGroup ? groupedTokens.get(selectedGroup.id) ?? [] : []),
    [groupedTokens, selectedGroup],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(selectedGroupTokens.length / TOKENS_PER_PAGE),
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedTokens = useMemo(() => {
    const startIndex = (currentPage - 1) * TOKENS_PER_PAGE;
    return selectedGroupTokens.slice(startIndex, startIndex + TOKENS_PER_PAGE);
  }, [currentPage, selectedGroupTokens]);

  const activeCount = useMemo(
    () =>
      (tokensQuery.data ?? []).filter(
        (token) => resolveEffectiveTokenStatus(token) === "active",
      ).length,
    [tokensQuery.data],
  );

  const keyedAgentCount = useMemo(() => {
    const keyedAgents = new Set<string>();
    for (const token of tokensQuery.data ?? []) {
      if (token.allowed_agents.length !== 1) {
        continue;
      }

      const agentName = token.allowed_agents[0];
      if (agentName) {
        keyedAgents.add(agentName);
      }
    }

    return keyedAgents.size;
  }, [tokensQuery.data]);

  const viewerIdentity =
    user?.email?.trim() ?? user?.name?.trim() ?? text.title;

  async function handleCopy(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(text.copyFailed);
    }
  }

  async function handleCopyPlaintext() {
    if (!createdToken) {
      return;
    }
    await handleCopy(createdToken, text.tokenReadyCopied);
    setCopiedPlaintext(true);
  }

  async function handleCopyPrefix(tokenPrefix: string, tokenID: string) {
    await handleCopy(tokenPrefix, text.copied);
    setCopiedTokenID(tokenID);
    window.setTimeout(() => {
      setCopiedTokenID((current) => (current === tokenID ? null : current));
    }, 1500);
  }

  useLayoutEffect(() => {
    document.title = `${t.workspace.apiKeys} - ${t.pages.appName}`;
  }, [t.pages.appName, t.workspace.apiKeys]);

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="items-stretch bg-slate-50">
        <section className="min-h-full">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="flex flex-col gap-5 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-cyan-200 bg-cyan-50 text-cyan-900"
                  >
                    {text.eyebrow}
                  </Badge>
                  <p className="text-sm text-slate-600">
                    <span className="font-medium text-slate-950">
                      {text.signedInAs}
                    </span>
                    {" · "}
                    {viewerIdentity}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <h1 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-3xl">
                    {text.title}
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    {text.description}
                  </p>
                </div>
              </div>

              <dl className="grid w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-3 lg:max-w-xl">
                <StatMetric label={text.activeKeys} value={activeCount} />
                <StatMetric label={text.keyedAgents} value={keyedAgentCount} />
                <StatMetric
                  label={text.publishedAgents}
                  value={ownedProdAgents.length}
                />
              </dl>
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)]">
              <section className="rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    {text.createSection}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                    {text.createTitle}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {text.createDescription}
                  </p>
                </div>

                <div className="space-y-5 px-5 py-5">
                  <div className="space-y-3">
                    <FieldLabel children={text.nameLabel} />
                    <Input
                      aria-label={text.nameLabel}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={text.namePlaceholder}
                      className="h-10 rounded-xl border-slate-200 bg-slate-50"
                    />
                  </div>

                  <div className="space-y-3">
                    <FieldLabel
                      children={text.targetAgentLabel}
                      hint={text.targetAgentHint}
                    />
                    {loadingAgents ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        {text.loadingAgents}
                      </div>
                    ) : ownedProdAgents.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                        {text.noOwnedPublishedAgents}
                      </div>
                    ) : (
                      <Select
                        value={selectedCreateAgent}
                        onValueChange={setSelectedCreateAgent}
                      >
                        <SelectTrigger
                          aria-label={text.targetAgentLabel}
                          className="h-10 w-full rounded-xl border-slate-200 bg-slate-50"
                        >
                          <SelectValue placeholder={text.targetAgentPlaceholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {ownedProdAgents.map((agent) => (
                            <SelectItem key={agent.name} value={agent.name}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-950">
                        {text.capabilitiesLabel}
                      </p>
                      <p className="text-sm leading-6 text-slate-600">
                        {text.capabilitiesDescription}
                      </p>
                      <p className="text-sm leading-6 text-slate-500">
                        {text.capabilitiesFootnote}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FIXED_PUBLIC_API_SCOPES.map((scope) => (
                        <Badge
                          key={scope}
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-900"
                        >
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {createdToken ? (
                    <div className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-4">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-cyan-950">
                          {text.tokenReadyTitle}
                        </p>
                        <p className="text-sm leading-6 text-cyan-900/80">
                          {text.tokenReadyDescription}
                        </p>
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-cyan-200 bg-white px-3 py-2 font-mono text-sm text-slate-950">
                        {createdToken}
                      </div>
                      <Button
                        variant="secondary"
                        className="h-9 rounded-full bg-slate-950 text-white hover:bg-slate-900"
                        onClick={() => {
                          void handleCopyPlaintext();
                        }}
                      >
                        {copiedPlaintext ? (
                          <CheckIcon className="size-4" />
                        ) : (
                          <CopyIcon className="size-4" />
                        )}
                        {copiedPlaintext
                          ? text.tokenReadyCopied
                          : text.tokenReadyCopy}
                      </Button>
                    </div>
                  ) : null}

                  <Button
                    className="h-10 w-full rounded-full bg-slate-950 text-white hover:bg-slate-900"
                    disabled={
                      createMutation.isPending || ownedProdAgents.length === 0
                    }
                    onClick={() => createMutation.mutate()}
                  >
                    {createMutation.isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <KeyRoundIcon className="size-4" />
                    )}
                    {createMutation.isPending
                      ? text.creatingButton
                      : text.createButton}
                  </Button>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                        {text.inventorySection}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                        {text.inventoryTitle}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {text.inventoryDescription}
                      </p>
                    </div>

                    <div className="grid gap-3 lg:min-w-[32rem] lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                          {text.inventoryAgentLabel}
                        </p>
                        {inventoryGroups.length === 0 ? (
                          <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400">
                            {text.inventoryAgentPlaceholder}
                          </div>
                        ) : (
                          <Select
                            value={selectedInventoryGroup}
                            onValueChange={setSelectedInventoryGroup}
                          >
                            <SelectTrigger
                              aria-label={text.inventoryAgentLabel}
                              className="h-10 w-full rounded-xl border-slate-200 bg-slate-50"
                            >
                              <SelectValue
                                placeholder={text.inventoryAgentPlaceholder}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {inventoryGroups.map((group) => (
                                <SelectItem key={group.id} value={group.id}>
                                  {group.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                          {text.searchLabel}
                        </p>
                        <div className="relative">
                          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            aria-label={text.searchLabel}
                            value={searchQuery}
                            onChange={(event) =>
                              setSearchQuery(event.target.value)
                            }
                            placeholder={text.searchPlaceholder}
                            className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <Tabs
                    value={filter}
                    onValueChange={(value) => setFilter(value as KeyFilter)}
                    className="gap-3"
                  >
                    <TabsList className="h-auto w-fit rounded-xl bg-slate-100 p-1">
                      <TabsTrigger value="all" className="rounded-lg px-3 py-2">
                        {text.filterAll}
                      </TabsTrigger>
                      <TabsTrigger value="active" className="rounded-lg px-3 py-2">
                        {text.filterActive}
                      </TabsTrigger>
                      <TabsTrigger
                        value="expired"
                        className="rounded-lg px-3 py-2"
                      >
                        {text.filterExpired}
                      </TabsTrigger>
                      <TabsTrigger
                        value="revoked"
                        className="rounded-lg px-3 py-2"
                      >
                        {text.filterRevoked}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {tokensQuery.isLoading ? (
                  <div className="px-5 py-10 text-sm text-slate-500">
                    {text.loadingKeys}
                  </div>
                ) : tokensQuery.error ? (
                  <div className="px-5 py-10 text-sm text-rose-700">
                    {tokensQuery.error instanceof Error
                      ? tokensQuery.error.message
                      : text.loadFailed}
                  </div>
                ) : inventoryGroups.length === 0 ? (
                  <div className="px-5 py-12">
                    <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">
                      {(tokensQuery.data ?? []).length === 0
                        ? text.emptyTitle
                        : text.emptyFiltered}
                    </h3>
                    {(tokensQuery.data ?? []).length === 0 ? (
                      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                        {text.emptyDescription}
                      </p>
                    ) : null}
                  </div>
                ) : selectedGroupTokens.length === 0 ? (
                  <div className="px-5 py-12">
                    <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">
                      {text.groupEmptyTitle}
                    </h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      {text.groupEmptyDescription}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-slate-50 text-slate-700"
                        >
                          {selectedGroup?.label}
                        </Badge>
                        <p className="text-sm text-slate-500">
                          {selectedGroup?.count ?? 0}
                        </p>
                      </div>
                      <p className="text-sm text-slate-500">
                        {text.pageSummary(currentPage, totalPages)}
                      </p>
                    </div>

                    <div className="px-3 py-3 sm:px-5">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="sticky left-0 z-20 min-w-[17rem] bg-white shadow-[inset_-1px_0_0_0_rgba(226,232,240,1)]">
                              {text.nameLabel}
                            </TableHead>
                            <TableHead className="min-w-[14rem]">
                              {text.agentBindingLabel}
                            </TableHead>
                            <TableHead className="hidden min-w-[14rem] xl:table-cell">
                              {text.scopesLine}
                            </TableHead>
                            <TableHead className="hidden whitespace-nowrap lg:table-cell">
                              {text.lastUsed}
                            </TableHead>
                            <TableHead className="w-[10rem] text-right">
                              {text.actionsLabel}
                            </TableHead>
                          </TableRow>
                        </TableHeader>

                        <TableBody>
                          {paginatedTokens.map((token) => {
                            const status = resolveEffectiveTokenStatus(token);
                            const isPendingRevoke = pendingRevokeID === token.id;
                            const isRevoking =
                              revokeMutation.isPending &&
                              revokeMutation.variables === token.id;

                            return (
                              <Fragment key={token.id}>
                                <TableRow className="group align-top">
                                  <TableCell className="sticky left-0 z-10 min-w-[17rem] bg-white shadow-[inset_-1px_0_0_0_rgba(226,232,240,1)] group-hover:bg-slate-50">
                                    <div className="space-y-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium text-slate-950">
                                          {token.name}
                                        </p>
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "px-2.5 py-0.5 uppercase",
                                            statusBadgeClass(status),
                                          )}
                                        >
                                          {status === "active"
                                            ? text.statusActive
                                            : status === "expired"
                                              ? text.statusExpired
                                              : text.statusRevoked}
                                        </Badge>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
                                          {token.token_prefix}
                                        </span>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 rounded-md px-2 text-xs text-slate-600"
                                          onClick={() => {
                                            void handleCopyPrefix(
                                              token.token_prefix,
                                              token.id,
                                            );
                                          }}
                                        >
                                          {copiedTokenID === token.id ? (
                                            <CheckIcon className="size-3.5" />
                                          ) : (
                                            <CopyIcon className="size-3.5" />
                                          )}
                                          {copiedTokenID === token.id
                                            ? text.copied
                                            : text.copy}
                                        </Button>
                                      </div>

                                      <p className="text-xs text-slate-500">
                                        {text.createdAt}
                                        {" · "}
                                        {formatTimestamp(token.created_at, locale, "—")}
                                      </p>
                                    </div>
                                  </TableCell>

                                  <TableCell className="min-w-[14rem]">
                                    <div className="flex flex-wrap gap-1.5">
                                      {token.allowed_agents.length === 0 ? (
                                        <Badge
                                          variant="outline"
                                          className="border-amber-200 bg-amber-50 text-amber-900"
                                        >
                                          {text.legacyUnscopedGroup}
                                        </Badge>
                                      ) : token.allowed_agents.length === 1 ? (
                                        <Badge
                                          variant="outline"
                                          className="border-cyan-200 bg-cyan-50 text-cyan-900"
                                        >
                                          {token.allowed_agents[0]}
                                        </Badge>
                                      ) : (
                                        token.allowed_agents.map((agentName) => (
                                          <Badge
                                            key={`${token.id}-${agentName}`}
                                            variant="outline"
                                            className="border-amber-200 bg-amber-50 text-amber-900"
                                          >
                                            {agentName}
                                          </Badge>
                                        ))
                                      )}
                                    </div>
                                  </TableCell>

                                  <TableCell className="hidden min-w-[14rem] xl:table-cell">
                                    <div className="flex flex-wrap gap-1.5">
                                      {token.scopes.map((scope) => (
                                        <Badge
                                          key={`${token.id}-${scope}`}
                                          variant="outline"
                                          className="border-emerald-200 bg-emerald-50 text-emerald-900"
                                        >
                                          {scope}
                                        </Badge>
                                      ))}
                                    </div>
                                  </TableCell>

                                  <TableCell className="hidden whitespace-nowrap lg:table-cell">
                                    <div className="space-y-1">
                                      <p className="text-sm text-slate-950">
                                        {formatTimestamp(
                                          token.last_used,
                                          locale,
                                          text.neverUsed,
                                        )}
                                      </p>
                                      {token.revoked_at ? (
                                        <p className="text-xs text-slate-500">
                                          {text.revokedAt}
                                          {" · "}
                                          {formatTimestamp(
                                            token.revoked_at,
                                            locale,
                                            "—",
                                          )}
                                        </p>
                                      ) : null}
                                    </div>
                                  </TableCell>

                                  <TableCell className="w-[10rem] text-right">
                                    {status === "revoked" ? (
                                      <p className="text-xs text-slate-500">
                                        {formatTimestamp(token.revoked_at, locale, "—")}
                                      </p>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                        onClick={() => setPendingRevokeID(token.id)}
                                      >
                                        <Trash2Icon className="size-4" />
                                        {text.revokeButton}
                                      </Button>
                                    )}
                                  </TableCell>
                                </TableRow>

                                {isPendingRevoke ? (
                                  <TableRow className="bg-rose-50/50">
                                    <TableCell colSpan={5} className="pt-0">
                                      <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                        <p className="text-sm leading-6 text-rose-800">
                                          {text.revokeWarning}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              setPendingRevokeID(null)
                                            }
                                          >
                                            {text.revokeCancel}
                                          </Button>
                                          <Button
                                            variant="destructive"
                                            size="sm"
                                            disabled={isRevoking}
                                            onClick={() =>
                                              revokeMutation.mutate(token.id)
                                            }
                                          >
                                            {isRevoking ? (
                                              <Loader2Icon className="size-4 animate-spin" />
                                            ) : (
                                              <Trash2Icon className="size-4" />
                                            )}
                                            {isRevoking
                                              ? text.revoking
                                              : text.revokeConfirm}
                                          </Button>
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
                      <p className="text-sm text-slate-500">
                        {text.pageSummary(currentPage, totalPages)}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage <= 1}
                          onClick={() =>
                            setCurrentPage((page) => Math.max(1, page - 1))
                          }
                        >
                          <ChevronLeftIcon className="size-4" />
                          {text.previousPage}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage >= totalPages}
                          onClick={() =>
                            setCurrentPage((page) =>
                              Math.min(totalPages, page + 1),
                            )
                          }
                        >
                          {text.nextPage}
                          <ChevronRightIcon className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </section>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
