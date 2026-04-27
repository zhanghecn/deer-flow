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
  useRef,
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

const FIXED_PUBLIC_API_SCOPES = [
  "responses:create",
  "responses:read",
  "artifacts:read",
];
const UNSUPPORTED_GROUP_ID = "__unsupported_contract__";
const TOKENS_PER_PAGE = 10;
const TOKEN_DISPLAY_PREFIX = 18;
const TOKEN_DISPLAY_SUFFIX = 12;

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

function isExpiredToken(token: APITokenRecord) {
  if (!token.expires_at) {
    return false;
  }

  const expiresAt = new Date(token.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function isActiveToken(token: APITokenRecord) {
  // New keys no longer support expirations, but older rows may still carry an
  // expiry timestamp and should not reappear in the active inventory.
  return (
    !token.revoked_at && token.status !== "revoked" && !isExpiredToken(token)
  );
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function formatTokenDisplay(value: string) {
  if (value.length <= TOKEN_DISPLAY_PREFIX + TOKEN_DISPLAY_SUFFIX + 3) {
    return value;
  }

  // API keys are operational identifiers, so keep both the stable prefix and
  // a meaningful tail visible while removing the noisy middle segment.
  return `${value.slice(0, TOKEN_DISPLAY_PREFIX)}...${value.slice(
    -TOKEN_DISPLAY_SUFFIX,
  )}`;
}

function copyTextWithTextareaFallback(value: string) {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  // LAN deployments often run over plain HTTP, where the async Clipboard API can
  // be denied. Keep a user-gesture fallback so the key manager does not leave a
  // stale token in the operator's clipboard after showing "copy failed".
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function writeTextToClipboard(value: string) {
  if (typeof navigator.clipboard?.writeText !== "function") {
    return copyTextWithTextareaFallback(value);
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyTextWithTextareaFallback(value);
  }
}

function tokenMatchesInventorySearch(token: APITokenRecord, query: string) {
  if (!query) {
    return true;
  }

  return [token.name, token.token ?? "", ...token.allowed_agents]
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
  return UNSUPPORTED_GROUP_ID;
}

function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-slate-900">{children}</p>
      {hint ? <p className="text-sm leading-6 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function HeroMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3">
      <p className="text-[11px] font-medium tracking-[0.16em] text-slate-500 uppercase">
        {label}
      </p>
      <p className="mt-1.5 font-[family-name:'Space_Grotesk'] text-[1.35rem] font-semibold tracking-[-0.04em] text-slate-950">
        {value.toString().padStart(2, "0")}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function InventoryFilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition",
        active
          ? "border-emerald-700 bg-emerald-50 text-emerald-950"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold",
          active ? "bg-emerald-100 text-emerald-900" : "text-slate-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function APIKeyManagementPage() {
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.role?.trim().toLowerCase() === "admin";
  const text = getAPIKeyManagementPageText(locale);
  const queryClient = useQueryClient();
  const createPanelRef = useRef<HTMLElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [selectedCreateAgent, setSelectedCreateAgent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInventoryGroup, setSelectedInventoryGroup] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [createdToken, setCreatedToken] = useState("");
  const [createdTokenID, setCreatedTokenID] = useState<string | null>(null);
  const [copiedPlaintext, setCopiedPlaintext] = useState(false);
  const [copiedTokenID, setCopiedTokenID] = useState<string | null>(null);
  const [pendingDeleteID, setPendingDeleteID] = useState<string | null>(null);
  // Defer the search string so large inventories stay responsive while the
  // operator types across long hash-like key values.
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const tokensQuery = useQuery({
    queryKey: ["auth", "api-tokens"],
    queryFn: listAPITokens,
  });
  const { agents: prodAgents, isLoading: loadingAgents } = useAgents("prod");

  const creatableProdAgents = useMemo(
    () =>
      prodAgents
        .filter(
          (agent) =>
            // Admin self-service can issue keys against any published prod
            // agent, while non-admin users stay limited to their own agents.
            agent.status === "prod" &&
            (isAdmin || agent.owner_user_id === user?.id) &&
            agent.name.trim().length > 0,
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [isAdmin, prodAgents, user?.id],
  );
  const normalizedSearchQuery = useMemo(
    () => normalizeSearchValue(deferredSearchQuery),
    [deferredSearchQuery],
  );

  useEffect(() => {
    if (creatableProdAgents.length === 0) {
      if (selectedCreateAgent) {
        setSelectedCreateAgent("");
      }
      return;
    }

    if (!creatableProdAgents.some((agent) => agent.name === selectedCreateAgent)) {
      const firstCreatableAgent = creatableProdAgents[0];
      if (firstCreatableAgent) {
        setSelectedCreateAgent(firstCreatableAgent.name);
      }
    }
  }, [creatableProdAgents, selectedCreateAgent]);

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
      setCreatedTokenID(token.id);
      setCopiedPlaintext(false);
      setCopiedTokenID(null);
      setName("");
      setPendingDeleteID(null);
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

  const deleteMutation = useMutation({
    mutationFn: async (tokenID: string) => {
      await deleteAPIToken(tokenID);
      return tokenID;
    },
    onSuccess: async (tokenID) => {
      if (createdTokenID === tokenID) {
        setCreatedToken("");
        setCreatedTokenID(null);
        setCopiedPlaintext(false);
      }
      if (copiedTokenID === tokenID) {
        setCopiedTokenID(null);
      }
      setPendingDeleteID(null);
      toast.success(text.deleteSuccess);
      await queryClient.invalidateQueries({ queryKey: ["auth", "api-tokens"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : text.deleteFailed);
    },
  });

  const activeTokens = useMemo(
    () =>
      [...(tokensQuery.data ?? [])]
        .filter((token) => isActiveToken(token))
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime(),
        ),
    [tokensQuery.data],
  );

  const groupedTokens = useMemo(() => {
    const groups = new Map<string, APITokenRecord[]>();
    for (const token of activeTokens) {
      const groupID = resolveTokenGroupID(token);
      const existing = groups.get(groupID);
      if (existing) {
        existing.push(token);
      } else {
        groups.set(groupID, [token]);
      }
    }
    return groups;
  }, [activeTokens]);

  const inventoryGroups = useMemo(() => {
    const groups = [...groupedTokens.entries()]
      .map(([groupID, tokens]) => ({
        id: groupID,
        label:
          groupID === UNSUPPORTED_GROUP_ID ? text.unsupportedGroup : groupID,
        count: tokens.length,
      }))
      .sort((left, right) => {
        if (left.id === UNSUPPORTED_GROUP_ID) {
          return 1;
        }
        if (right.id === UNSUPPORTED_GROUP_ID) {
          return -1;
        }
        return left.label.localeCompare(right.label);
      });
    return groups;
  }, [groupedTokens, text.unsupportedGroup]);

  useEffect(() => {
    if (
      selectedInventoryGroup &&
      !inventoryGroups.some((group) => group.id === selectedInventoryGroup)
    ) {
      setSelectedInventoryGroup("");
    }
  }, [inventoryGroups, selectedInventoryGroup]);

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearchQuery, selectedInventoryGroup]);

  const selectedGroup = useMemo(
    () =>
      inventoryGroups.find((group) => group.id === selectedInventoryGroup) ??
      null,
    [inventoryGroups, selectedInventoryGroup],
  );
  const filteredTokens = useMemo(() => {
    const baseTokens = selectedInventoryGroup
      ? (groupedTokens.get(selectedInventoryGroup) ?? [])
      : activeTokens;

    return baseTokens.filter((token) =>
      tokenMatchesInventorySearch(token, normalizedSearchQuery),
    );
  }, [
    activeTokens,
    groupedTokens,
    normalizedSearchQuery,
    selectedInventoryGroup,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredTokens.length / TOKENS_PER_PAGE),
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedTokens = useMemo(() => {
    const startIndex = (currentPage - 1) * TOKENS_PER_PAGE;
    return filteredTokens.slice(startIndex, startIndex + TOKENS_PER_PAGE);
  }, [currentPage, filteredTokens]);

  const legacyTokenCount = useMemo(
    () => activeTokens.filter((token) => !token.token).length,
    [activeTokens],
  );
  const viewerIdentity =
    user?.email?.trim() ?? user?.name?.trim() ?? text.title;

  async function handleCopy(value: string, successMessage: string) {
    if (await writeTextToClipboard(value)) {
      toast.success(successMessage);
      return true;
    }

    toast.error(text.copyFailed);
    return false;
  }

  async function handleCopyPlaintext() {
    if (!createdToken) {
      return;
    }
    const copied = await handleCopy(createdToken, text.tokenReadyCopied);
    if (!copied) {
      return;
    }
    setCopiedPlaintext(true);
    if (createdTokenID) {
      setCopiedTokenID(createdTokenID);
    }
  }

  async function handleCopyStoredToken(token: APITokenRecord) {
    if (!token.token) {
      return;
    }

    const copied = await handleCopy(token.token, text.tokenReadyCopied);
    if (!copied) {
      return;
    }
    setCopiedTokenID(token.id);
    if (token.id === createdTokenID) {
      setCopiedPlaintext(true);
    }
  }

  function handleFocusCreateComposer() {
    createPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 120);
  }

  useLayoutEffect(() => {
    document.title = `${t.workspace.apiKeys} - ${t.pages.appName}`;
  }, [t.pages.appName, t.workspace.apiKeys]);

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody className="items-stretch bg-[#f5f1e9]">
        <section className="min-h-full">
          <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4 sm:px-6 xl:px-8">
            <section className="overflow-hidden rounded-xl border border-[#ded6c9] bg-[#fcfbf8] shadow-sm">
              <div className="flex flex-col gap-4 border-b border-[#ece4d8] px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <Badge
                      variant="outline"
                      className="rounded-md border-[#d9cfbe] bg-[#f4efe6] px-2 py-0.5 text-[11px] tracking-[0.14em] text-slate-700 uppercase"
                    >
                      {text.eyebrow}
                    </Badge>
                    <p>
                      <span className="font-medium text-slate-700">
                        {text.signedInAs}
                      </span>
                      {" · "}
                      {viewerIdentity}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <h1 className="font-[family-name:'Space_Grotesk'] text-[1.35rem] font-semibold tracking-[-0.03em] text-slate-950 sm:text-[1.5rem]">
                      {text.title}
                    </h1>
                    <p className="max-w-3xl text-sm leading-6 text-slate-600">
                      {text.description}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:items-end">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="h-9 rounded-md bg-emerald-900 text-white hover:bg-emerald-800"
                      disabled={creatableProdAgents.length === 0}
                      onClick={handleFocusCreateComposer}
                    >
                      <KeyRoundIcon className="size-4" />
                      {text.openCreateDialog}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-9 rounded-md border-[#d9cfbe] bg-white text-slate-700 hover:bg-[#f7f3ec]"
                      onClick={() => setSelectedInventoryGroup("")}
                    >
                      {text.inventoryAllLabel}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-[#e5ddd1] bg-[#f8f4ed] px-3 py-2 text-xs leading-5 text-slate-600">
                    <span className="font-medium text-slate-800">
                      {text.contractTitle}
                    </span>
                    {" · "}
                    {text.contractDescription}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 px-5 py-4 md:grid-cols-3">
                <HeroMetric
                  label={text.summaryPublishedAgents}
                  value={creatableProdAgents.length}
                  description={text.summaryPublishedHint}
                />
                <HeroMetric
                  label={text.summaryActiveKeys}
                  value={activeTokens.length}
                  description={text.summaryActiveHint}
                />
                <HeroMetric
                  label={text.summaryRotation}
                  value={legacyTokenCount}
                  description={text.summaryRotationHint}
                />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
              <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
                <section
                  ref={createPanelRef}
                  className="overflow-hidden rounded-xl border border-[#ded6c9] bg-white shadow-sm"
                >
                  <div className="border-b border-[#ece4d8] px-4 py-3">
                    <h2 className="font-[family-name:'Space_Grotesk'] text-[1.1rem] font-semibold tracking-[-0.03em] text-slate-950">
                      {text.createTitle}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {text.createDescription}
                    </p>
                  </div>
                  <div className="space-y-4 px-4 py-4">
                    {createdToken ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">
                              {text.tokenReadyTitle}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              {text.tokenReadyDescription}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-white text-emerald-900"
                          >
                            {copiedPlaintext
                              ? text.tokenReadyCopied
                              : text.freshStatusLabel}
                          </Badge>
                        </div>
                        <button
                          type="button"
                          aria-label={createdToken}
                          title={createdToken}
                          onClick={() => {
                            void handleCopyPlaintext();
                          }}
                          className="mt-3 flex w-full items-center justify-between gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-left font-mono text-[12px] text-slate-900 transition hover:border-emerald-300 hover:bg-emerald-50"
                        >
                          <span className="min-w-0 truncate">
                            {formatTokenDisplay(createdToken)}
                          </span>
                          {copiedPlaintext ? (
                            <CheckIcon className="size-4 shrink-0 text-emerald-700" />
                          ) : (
                            <CopyIcon className="size-4 shrink-0 text-emerald-700" />
                          )}
                        </button>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {text.tokenReadyHint}
                        </p>
                      </div>
                    ) : null}

                    <div className="space-y-4">
                      <div className="space-y-2.5">
                        <FieldLabel
                          children={text.targetAgentLabel}
                          hint={text.targetAgentHint}
                        />
                        {loadingAgents ? (
                          <div className="rounded-md border border-[#ded6c9] bg-[#f7f3ec] px-3 py-2 text-sm text-slate-500">
                            {text.loadingAgents}
                          </div>
                        ) : creatableProdAgents.length === 0 ? (
                          <div className="rounded-md border border-dashed border-[#d6c7b5] bg-[#f7f3ec] px-3 py-3 text-sm leading-6 text-slate-600">
                            {text.noOwnedPublishedAgents}
                          </div>
                        ) : (
                          <Select
                            value={selectedCreateAgent}
                            onValueChange={setSelectedCreateAgent}
                          >
                            <SelectTrigger
                              aria-label={text.targetAgentLabel}
                              className="h-10 rounded-md border-[#ded6c9] bg-[#fcfbf8] px-3"
                            >
                              <SelectValue
                                placeholder={text.targetAgentPlaceholder}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {creatableProdAgents.map((agent) => (
                                <SelectItem key={agent.name} value={agent.name}>
                                  {agent.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      <div className="space-y-2.5">
                        <FieldLabel children={text.nameLabel} />
                        <Input
                          ref={nameInputRef}
                          aria-label={text.nameLabel}
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          placeholder={text.namePlaceholder}
                          className="h-10 rounded-md border-[#ded6c9] bg-[#fcfbf8] px-3"
                        />
                      </div>

                      <div className="rounded-md border border-[#ded6c9] bg-[#f8f4ed] p-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {text.capabilitiesLabel}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          {text.capabilitiesDescription}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {FIXED_PUBLIC_API_SCOPES.map((scope) => (
                            <span
                              key={scope}
                              className="rounded-md border border-[#e5ddd1] bg-white px-2 py-1 font-mono text-[11px] font-medium text-slate-700"
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      </div>

                      <Button
                        className="h-10 w-full rounded-md bg-emerald-900 text-white hover:bg-emerald-800"
                        disabled={
                          createMutation.isPending ||
                          creatableProdAgents.length === 0
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
                  </div>
                </section>
              </div>

              <section className="overflow-hidden rounded-xl border border-[#ded6c9] bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-[#ece4d8] px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <h2 className="font-[family-name:'Space_Grotesk'] text-[1.1rem] font-semibold tracking-[-0.03em] text-slate-950">
                      {text.inventoryTitle}
                    </h2>
                    <p className="max-w-3xl text-sm leading-6 text-slate-600">
                      {text.inventoryDescription}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge
                      variant="outline"
                      className="border-[#d9cfbe] bg-[#f7f3ec] text-slate-700"
                    >
                      {text.pageSummary(currentPage, totalPages)}
                    </Badge>
                    {legacyTokenCount > 0 ? (
                      <Badge className="border border-amber-200 bg-amber-50 text-amber-800 shadow-none">
                        {legacyTokenCount} {text.keyUnavailableTitle}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-b border-[#ece4d8] bg-[#fcfbf8] px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <InventoryFilterButton
                      active={!selectedInventoryGroup}
                      label={text.inventoryAllLabel}
                      count={activeTokens.length}
                      onClick={() => setSelectedInventoryGroup("")}
                    />
                    {inventoryGroups.map((group) => (
                      <InventoryFilterButton
                        key={group.id}
                        active={group.id === selectedInventoryGroup}
                        label={group.label}
                        count={group.count}
                        onClick={() => setSelectedInventoryGroup(group.id)}
                      />
                    ))}
                  </div>
                  <label className="relative flex w-full max-w-sm items-center">
                    <SearchIcon className="pointer-events-none absolute left-3 size-4 text-slate-400" />
                    <Input
                      aria-label={text.searchLabel}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={text.searchPlaceholder}
                      className="h-9 rounded-md border-[#ded6c9] bg-white pl-9"
                    />
                  </label>
                </div>

                {tokensQuery.isLoading ? (
                  <div className="px-4 py-10 text-sm text-slate-500">
                    {text.loadingKeys}
                  </div>
                ) : tokensQuery.error ? (
                  <div className="px-4 py-10 text-sm text-rose-700">
                    {tokensQuery.error instanceof Error
                      ? tokensQuery.error.message
                      : text.loadFailed}
                  </div>
                ) : activeTokens.length === 0 ? (
                  <div className="px-4 py-10">
                    <h3 className="text-base font-semibold text-slate-900">
                      {text.emptyTitle}
                    </h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      {text.emptyDescription}
                    </p>
                  </div>
                ) : filteredTokens.length === 0 ? (
                  <div className="px-4 py-10">
                    <h3 className="text-base font-semibold text-slate-900">
                      {normalizedSearchQuery
                        ? text.emptySearch
                        : selectedGroup
                          ? text.groupEmptyTitle
                          : text.emptyTitle}
                    </h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      {normalizedSearchQuery
                        ? text.searchPlaceholder
                        : selectedGroup
                          ? text.groupEmptyDescription
                          : text.emptyDescription}
                    </p>
                  </div>
                ) : (
                  <>
                    <Table className="min-w-[860px]">
                      <TableHeader>
                        <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                          <TableHead className="w-[220px]">
                            {text.inventoryIdentityHeader}
                          </TableHead>
                          <TableHead className="w-[160px]">
                            {text.inventoryAgentHeader}
                          </TableHead>
                          <TableHead>{text.inventorySurfaceHeader}</TableHead>
                          <TableHead className="w-[170px]">
                            {text.inventoryCreatedHeader}
                          </TableHead>
                          <TableHead className="w-[110px] text-right">
                            {text.inventoryLifecycleHeader}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedTokens.map((token) => {
                          const isPendingDelete = pendingDeleteID === token.id;
                          const isDeleting =
                            deleteMutation.isPending &&
                            deleteMutation.variables === token.id;
                          const isLatestToken = createdTokenID === token.id;

                          return (
                            <Fragment key={token.id}>
                              <TableRow
                                className={cn(
                                  token.token ? "bg-white" : "bg-amber-50/40",
                                )}
                              >
                                <TableCell className="py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate font-medium text-slate-950">
                                      {token.name}
                                    </span>
                                    {isLatestToken ? (
                                      <Badge
                                        variant="outline"
                                        className="border-emerald-200 bg-emerald-50 text-emerald-900"
                                      >
                                        {text.freshStatusLabel}
                                      </Badge>
                                    ) : null}
                                    {!token.token ? (
                                      <Badge className="border border-amber-200 bg-amber-50 text-amber-800 shadow-none">
                                        {text.keyUnavailableTitle}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell className="py-3 text-sm text-slate-600">
                                  {token.allowed_agents[0] ??
                                    text.unsupportedGroup}
                                </TableCell>
                                <TableCell className="py-3">
                                  {token.token ? (
                                    <button
                                      type="button"
                                      aria-label={token.token}
                                      title={token.token}
                                      onClick={() => {
                                        void handleCopyStoredToken(token);
                                      }}
                                      // Full keys stay on one line and remain copyable from
                                      // the table without introducing horizontal scrollbars.
                                      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left font-mono text-[12px] text-slate-900 transition hover:border-emerald-300 hover:bg-emerald-50"
                                    >
                                      <span className="block min-w-0 truncate">
                                        {formatTokenDisplay(token.token)}
                                      </span>
                                      {copiedTokenID === token.id ? (
                                        <CheckIcon className="size-4 shrink-0 text-emerald-700" />
                                      ) : (
                                        <CopyIcon className="size-4 shrink-0 text-emerald-700" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="text-xs font-medium text-amber-800">
                                      {text.keyUnavailableTitle}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="py-3 text-sm whitespace-nowrap text-slate-600">
                                  {formatTimestamp(
                                    token.created_at,
                                    locale,
                                    "—",
                                  )}
                                </TableCell>
                                <TableCell className="py-3 text-right">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-md border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                                    onClick={() => setPendingDeleteID(token.id)}
                                  >
                                    <Trash2Icon className="size-4" />
                                    {text.deleteButton}
                                  </Button>
                                </TableCell>
                              </TableRow>

                              {isPendingDelete ? (
                                <TableRow className="bg-rose-50/70 hover:bg-rose-50/70">
                                  <TableCell colSpan={5} className="py-3">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                      <p className="max-w-2xl text-sm leading-6 text-rose-800">
                                        {text.deleteWarning}
                                      </p>
                                      <div className="flex flex-wrap gap-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            setPendingDeleteID(null)
                                          }
                                        >
                                          {text.deleteCancel}
                                        </Button>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          disabled={isDeleting}
                                          onClick={() =>
                                            deleteMutation.mutate(token.id)
                                          }
                                        >
                                          {isDeleting ? (
                                            <Loader2Icon className="size-4 animate-spin" />
                                          ) : (
                                            <Trash2Icon className="size-4" />
                                          )}
                                          {isDeleting
                                            ? text.deleting
                                            : text.deleteConfirm}
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

                    <div className="flex flex-col gap-3 border-t border-[#ece4d8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
            </section>
          </div>
        </section>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
