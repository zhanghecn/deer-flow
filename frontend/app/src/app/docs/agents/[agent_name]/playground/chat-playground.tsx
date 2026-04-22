import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  Settings,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/core/auth/hooks";
import { listAPITokens, type APITokenRecord } from "@/core/auth/tokens";
import {
  type PublicAPITurnArtifact,
  type PublicAPITurnEvent,
  type PublicAPITurnSnapshot,
  downloadPublicAPIArtifact,
  uploadPublicAPIFile,
} from "@/core/public-api/api";
import { createPublicAPISession } from "@/core/public-api/session";

import {
  coerceTimestampMs,
  formatCalendarDate,
  formatTraceTime,
  mergeFinalAssistantText,
} from "./chat-playground-utils";

type ReasoningEffort = "low" | "medium" | "high" | "max";
type RunPhase = "ready" | "streaming" | "failed" | "waiting";
type DebugTab = "request" | "events" | "snapshot";

type ContentBlock =
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      name: string;
      arguments?: unknown;
      output?: unknown;
      startedAt: number;
      completedAt?: number;
    };

interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: ContentBlock[];
  status: "streaming" | "done" | "error";
  turnId?: string;
  reasoningText?: string;
}

interface DebugEntry {
  type: string;
  timestamp: number | null;
  summary: string;
}

interface StoredRequest {
  url: string;
  body: unknown;
}

const TRACE_TEXT = {
  assistantMessage: "Assistant",
  assistantThinking: "Thinking",
  toolCall: "Tool Call",
  toolResult: "Tool Result",
  turnCompleted: "Completed",
  turnStarted: "Started",
  turnWaiting: "Waiting",
  turnFailed: "Failed",
};

function uid() {
  return crypto.randomUUID();
}

function fmtJSON(obj: unknown, max = 300): string {
  try {
    const s = JSON.stringify(obj, null, 2);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(obj);
  }
}

function eventAccent(type: string) {
  if (type.includes("failed")) return "text-rose-400";
  if (type.includes("tool.")) return "text-amber-400";
  if (type.includes("text.delta")) return "text-cyan-400";
  if (type.includes("reasoning")) return "text-violet-400";
  if (type.includes("turn.")) return "text-zinc-300";
  return "text-zinc-500";
}

// ─── Small Components ─────────────────────────────────────

function StatusDot({ phase }: { phase: RunPhase }) {
  const dot: Record<RunPhase, string> = {
    ready: "bg-emerald-400",
    streaming: "bg-cyan-400 animate-pulse",
    failed: "bg-rose-400",
    waiting: "bg-amber-400",
  };
  const label: Record<RunPhase, string> = {
    ready: "Ready",
    streaming: "Streaming",
    failed: "Failed",
    waiting: "Waiting",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`inline-block size-2 rounded-full ${dot[phase]}`} />
      {label[phase]}
    </span>
  );
}

function ToolCallCard({ call }: { call: Extract<ContentBlock, { type: "tool_call" }> }) {
  const [open, setOpen] = useState(false);
  const done = call.completedAt != null;
  return (
    <div className="rounded border border-amber-500/20 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-amber-500/10 transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-amber-400" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-amber-400" />
        )}
        <Wrench className="size-3.5 shrink-0 text-amber-400" />
        <span className="font-mono text-amber-300 text-xs">{call.name}</span>
        {!done && <Loader2 className="ml-auto size-3 animate-spin text-amber-400" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-amber-500/10 px-3 py-2">
          {call.arguments !== undefined && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Args</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-xs text-zinc-300">
                {fmtJSON(call.arguments, 500)}
              </pre>
            </div>
          )}
          {call.output !== undefined && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Output</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-xs text-zinc-300">
                {fmtJSON(call.output, 500)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Debug Panel ──────────────────────────────────────────

function DebugPanel({
  request,
  events,
  snapshot,
  activeTab,
  onTabChange,
  apiBaseURL,
  apiToken,
}: {
  request: StoredRequest | null;
  events: DebugEntry[];
  snapshot: PublicAPITurnSnapshot | null;
  activeTab: DebugTab;
  onTabChange: (t: DebugTab) => void;
  apiBaseURL: string;
  apiToken: string;
}) {
  const eventsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    eventsRef.current?.scrollTo({ top: eventsRef.current.scrollHeight });
  }, [events]);

  const tabs: { key: DebugTab; icon: typeof Activity; label: string }[] = [
    { key: "request", icon: Send, label: "Request" },
    { key: "events", icon: Activity, label: "Events" },
    { key: "snapshot", icon: FileJson, label: "Response" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0 border-b border-zinc-800 px-1">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors ${
              activeTab === key
                ? "border-cyan-400 text-cyan-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
            {key === "events" && events.length > 0 && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">
                {events.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "request" && (
          <div className="space-y-3">
            {request ? (
              <>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Endpoint</p>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">POST</span>
                    <code className="text-xs text-zinc-300 break-all">{request.url}</code>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Body</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-xs text-zinc-300">
                    {fmtJSON(request.body, 3000)}
                  </pre>
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-zinc-600">Send a message to see the request</p>
            )}
          </div>
        )}

        {activeTab === "events" && (
          <div ref={eventsRef} className="space-y-0.5 font-mono text-xs">
            {events.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-600">SSE events appear here in real time</p>
            ) : (
              events.map((entry, i) => (
                <div
                  key={`${entry.type}-${i}`}
                  className="flex items-start gap-2 rounded px-2 py-1 hover:bg-zinc-800/50"
                >
                  <span className="shrink-0 text-zinc-600">
                    {formatTraceTime(entry.timestamp)}
                  </span>
                  <span className={`shrink-0 ${eventAccent(entry.type)}`}>{entry.type}</span>
                  {entry.summary && (
                    <span className="truncate text-zinc-500">{entry.summary}</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "snapshot" && (
          <div className="space-y-3">
            {snapshot ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ["Turn ID", snapshot.id],
                    ["Status", snapshot.status],
                    ["Agent", snapshot.agent],
                    ["Tokens", snapshot.usage ? String(snapshot.usage.total_tokens) : "—"],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</p>
                      <p className="truncate font-mono text-xs text-zinc-300">{v ?? "—"}</p>
                    </div>
                  ))}
                </div>

                {snapshot.artifacts && snapshot.artifacts.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Artifacts</p>
                    <div className="space-y-1">
                      {snapshot.artifacts.map((a) => (
                        <ArtifactRow key={a.id} artifact={a} baseURL={apiBaseURL} apiToken={apiToken} />
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Full Response</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-[11px] text-zinc-400">
                    {fmtJSON(snapshot, 8000)}
                  </pre>
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-zinc-600">Response appears after the run completes</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactRow({ artifact, baseURL, apiToken }: { artifact: PublicAPITurnArtifact; baseURL: string; apiToken: string }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const filename = await downloadPublicAPIArtifact({ baseURL, apiToken, artifact });
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 px-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-zinc-300">{artifact.filename}</p>
      </div>
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={downloading}
        className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
      >
        {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      </button>
    </div>
  );
}

// ─── Config Drawer ────────────────────────────────────────

function ConfigDrawer({
  open,
  onClose,
  apiKey,
  setAPIKey,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEffort,
  setReasoningEffort,
  matchingTokens,
  authenticated,
}: {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  setAPIKey: (v: string) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: (v: boolean) => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (v: ReasoningEffort) => void;
  matchingTokens: APITokenRecord[];
  authenticated: boolean;
}) {
  if (!open) return null;

  const matchedToken = matchingTokens.find((t) => t.token === apiKey);
  const showSelector = authenticated && matchingTokens.length > 0;
  const matchedTokenCreatedDate = matchedToken
    ? formatCalendarDate(matchedToken.created_at)
    : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-72 flex-col border-l border-zinc-700/50 bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-700/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">API Key</span>
            {showSelector ? (
              <select
                value={apiKey}
                onChange={(e) => setAPIKey(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200"
              >
                {matchingTokens.map((t) => (
                  <option key={t.id} value={t.token ?? ""}>
                    {t.name || t.id}
                  </option>
                ))}
                <option value="">— Manual input —</option>
              </select>
            ) : (
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setAPIKey(e.target.value)}
                placeholder="df_..."
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
              />
            )}
            {matchedToken && (
              <p className="text-[11px] text-zinc-500">
                {matchedToken.name || matchedToken.id}
                {matchedTokenCreatedDate
                  ? ` · created ${matchedTokenCreatedDate}`
                  : ""}
              </p>
            )}
            {!authenticated && (
              <p className="text-[11px] text-cyan-400/70">
                Login to auto-fill your API key
              </p>
            )}
          </label>
          <hr className="border-zinc-800" />
          <label className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Reasoning</span>
            <input
              type="checkbox"
              checked={reasoningEnabled}
              onChange={(e) => setReasoningEnabled(e.target.checked)}
              className="accent-cyan-500"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Effort</span>
            <select
              value={reasoningEffort}
              disabled={!reasoningEnabled}
              onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="max">max</option>
            </select>
          </label>
        </div>
      </aside>
    </>
  );
}

// ─── Main Component ────────────────────────────────────────

interface ChatPlaygroundProps {
  agentName: string;
  defaultBaseURL?: string | null;
}

export function ChatPlayground({ agentName, defaultBaseURL }: ChatPlaygroundProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ReturnType<typeof createPublicAPISession> | null>(null);
  const sessionConfigKeyRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [apiKey, setAPIKey] = useState("");
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");

  // Key auto-fetch
  const { authenticated } = useAuth();
  const tokensQuery = useQuery({
    queryKey: ["auth", "api-tokens"],
    queryFn: listAPITokens,
    enabled: authenticated,
  });

  const matchingTokens = useMemo(() => {
    const tokens = tokensQuery.data ?? [];
    return tokens.filter(
      (t) =>
        t.allowed_agents.includes(agentName) &&
        t.token &&
        t.status !== "revoked",
    );
  }, [tokensQuery.data, agentName]);

  useEffect(() => {
    if (apiKey || matchingTokens.length === 0) return;
    const first = matchingTokens[0];
    if (first?.token) setAPIKey(first.token);
  }, [matchingTokens, apiKey]);

  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [runState, setRunState] = useState<RunPhase>("ready");

  // Files
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);

  // Debug
  const [debugReq, setDebugReq] = useState<StoredRequest | null>(null);
  const [debugEvents, setDebugEvents] = useState<DebugEntry[]>([]);
  const [debugSnapshot, setDebugSnapshot] = useState<PublicAPITurnSnapshot | null>(null);
  const [debugTab, setDebugTab] = useState<DebugTab>("events");

  // UI
  const [showConfig, setShowConfig] = useState(false);
  const [showDebug, setShowDebug] = useState(true);

  const apiBaseURL = defaultBaseURL ?? "";
  const previousTurnIdRef = useRef("");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const updateMsg = useCallback(
    (id: string, fn: (m: Message) => Message) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
    },
    [],
  );

  function ensureSession() {
    const configKey = [apiBaseURL.trim(), apiKey.trim(), agentName.trim()].join("\n");
    if (!sessionRef.current || sessionConfigKeyRef.current !== configKey) {
      sessionRef.current = createPublicAPISession({
        baseURL: apiBaseURL,
        apiToken: apiKey.trim(),
        agent: agentName.trim(),
        traceText: TRACE_TEXT,
      });
      sessionConfigKeyRef.current = configKey;
    }
    return sessionRef.current;
  }

  function resetSession() {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current?.reset();
    previousTurnIdRef.current = "";
    setMessages([]);
    setQueuedFiles([]);
    setRunState("ready");
    setDebugReq(null);
    setDebugEvents([]);
    setDebugSnapshot(null);
  }

  function handleQueueFiles(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    setQueuedFiles((current) => {
      const seen = new Set(current.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      const next = [...current];
      for (const file of incoming) {
        const sig = `${file.name}:${file.size}:${file.lastModified}`;
        if (!seen.has(sig)) {
          seen.add(sig);
          next.push(file);
        }
      }
      return next;
    });
  }

  function handleRemoveFile(index: number) {
    setQueuedFiles((current) => current.filter((_, i) => i !== index));
  }

  async function uploadFiles(): Promise<string[]> {
    const fileIds: string[] = [];
    for (const file of queuedFiles) {
      const uploaded = await uploadPublicAPIFile({
        baseURL: apiBaseURL,
        apiToken: apiKey.trim(),
        file,
      });
      fileIds.push(uploaded.id);
    }
    return fileIds;
  }

  async function handleSend(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    const key = apiKey.trim();

    if (!key) {
      toast.error("Please enter an API Key in Settings");
      setShowConfig(true);
      return;
    }
    if (!prompt && queuedFiles.length === 0) return;

    const userId = uid();
    const asstId = uid();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setDraft("");
    setRunState("streaming");
    setDebugEvents([]);
    setDebugSnapshot(null);
    setDebugTab("events");
    const session = ensureSession();

    // Upload files first
    let fileIds: string[] = [];
    if (queuedFiles.length > 0) {
      try {
        fileIds = await uploadFiles();
        setQueuedFiles([]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "File upload failed");
        setRunState("ready");
        return;
      }
    }

    const requestBody = session.previewRequest({
      text: prompt,
      fileIds: fileIds.length > 0 ? fileIds : undefined,
      thinking: { enabled: reasoningEnabled, effort: reasoningEffort },
      metadata: { source: "docs_playground" },
    });

    setDebugReq({ url: `${apiBaseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/turns`, body: requestBody });

    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: "user",
        blocks: [
          { type: "text", content: prompt },
          ...(fileIds.length > 0 ? [{ type: "text" as const, content: `[${fileIds.length} file(s) attached]` }] : []),
        ],
        status: "done",
      },
      {
        id: asstId,
        role: "assistant",
        blocks: [],
        status: "streaming",
        reasoningText: "",
      },
    ]);

    try {
      const result = await session.prompt({
        text: prompt,
        fileIds: fileIds.length > 0 ? fileIds : undefined,
        thinking: { enabled: reasoningEnabled, effort: reasoningEffort },
        metadata: { source: "docs_playground" },
        signal: ctrl.signal,
        onUpdate: ({ event, readModel }) => {
          // Debug events
          if (event.kind === "ledger_event") {
            const ledgerEvt = event.event;
            // Runtime traces are not yet perfectly uniform across deployments.
            // Normalize here so mixed seconds / milliseconds / ISO strings do
            // not blank the entire Events panel during a real debugging run.
            const eventTimestamp = coerceTimestampMs(ledgerEvt.created_at);
            setDebugEvents((prev) => [
              ...prev,
              {
                type: ledgerEvt.type,
                timestamp: eventTimestamp,
                summary: summarizeEvent(ledgerEvt),
              },
            ]);
          } else if (event.kind === "turn_started") {
            setDebugEvents((prev) => [...prev, { type: "turn.started", timestamp: Date.now(), summary: event.turnId }]);
          } else if (event.kind === "turn_completed") {
            setDebugEvents((prev) => [...prev, { type: "turn.completed", timestamp: Date.now(), summary: event.turnId }]);
          } else if (event.kind === "turn_failed") {
            setDebugEvents((prev) => [...prev, { type: "turn.failed", timestamp: Date.now(), summary: event.detail }]);
          }

          updateMsg(asstId, (m) => {
            const blocks = [...m.blocks];

            if (event.kind === "assistant_text_delta") {
              const last = blocks[blocks.length - 1];
              if (last?.type === "text") {
                blocks[blocks.length - 1] = { ...last, content: readModel.liveOutput };
              } else {
                blocks.push({ type: "text", content: readModel.liveOutput });
              }
            } else if (
              event.kind === "ledger_event" &&
              event.event.type === "tool.call.started"
            ) {
              const startedAt = coerceTimestampMs(event.event.created_at) ?? Date.now();
              blocks.push({
                type: "tool_call",
                name: event.event.tool_name ?? "unknown",
                arguments: event.event.tool_arguments,
                startedAt,
              });
            } else if (
              event.kind === "ledger_event" &&
              event.event.type === "tool.call.completed"
            ) {
              const completedAt = coerceTimestampMs(event.event.created_at) ?? Date.now();
              for (let i = blocks.length - 1; i >= 0; i--) {
                const block = blocks[i]!;
                if (
                  block.type === "tool_call" &&
                  block.name === (event.event.tool_name ?? "unknown") &&
                  !block.completedAt
                ) {
                  blocks[i] = {
                    ...block,
                    output: event.event.tool_output,
                    completedAt,
                  };
                  break;
                }
              }
            }

            return {
              ...m,
              blocks,
              reasoningText: readModel.liveReasoning || m.reasoningText,
              turnId: readModel.turnId || m.turnId,
              status: readModel.phase === "failed" ? "error" : m.status,
            };
          });

          if (readModel.phase === "failed") setRunState("failed");
          else if (readModel.phase === "waiting") setRunState("waiting");
        },
      });

      const finalized = result.turn;
      if (!finalized) {
        setRunState("ready");
        updateMsg(asstId, (m) => ({ ...m, status: "done" }));
        return;
      }
      setDebugSnapshot(finalized);
      previousTurnIdRef.current = session.getPreviousTurnId();

      const finalStatus =
        finalized.status === "completed" || finalized.status === "requires_input"
          ? "done" as const
          : "error" as const;

      updateMsg(asstId, (m) => {
        const finalText = finalized.output_text?.trim();
        if (finalText) {
          return {
            ...m,
            blocks: mergeFinalAssistantText(m.blocks, finalText),
            status: finalStatus,
            turnId: finalized.id,
            reasoningText: result.readModel.liveReasoning || finalized.reasoning_text,
          };
        }
        return {
          ...m,
          status: finalStatus,
          turnId: finalized.id,
          reasoningText: result.readModel.liveReasoning || finalized.reasoning_text,
        };
      });

      if (finalized.status === "requires_input") {
        setRunState("waiting");
        return;
      }
      setRunState("ready");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setRunState("ready");
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      setRunState("failed");
      toast.error(detail);
      updateMsg(asstId, (m) => ({
        ...m,
        status: "error",
        blocks:
          m.blocks.length > 0
            ? m.blocks
            : [{ type: "text" as const, content: `Error: ${detail}` }],
      }));
    } finally {
      abortRef.current = null;
    }
  }

  function summarizeEvent(e: PublicAPITurnEvent): string {
    switch (e.type) {
      case "turn.started":
        return e.turn_id ?? "";
      case "assistant.text.delta": {
        const d = e.delta ?? "";
        return d.length > 50 ? `"${d.slice(0, 50)}…"` : `"${d}"`;
      }
      case "tool.call.started":
        return e.tool_name ?? "";
      case "tool.call.completed":
        return e.tool_name ?? "";
      case "turn.completed":
        return "completed";
      case "turn.failed":
        return e.error ?? "error";
      default:
        return "";
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#0a0b10] text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <StatusDot phase={runState} />
          <span className="text-[13px] font-medium text-zinc-200">{agentName}</span>
          <span className="hidden text-[10px] uppercase tracking-wider text-zinc-500 sm:inline">
            Dev Console
          </span>
          {apiKey && matchingTokens.length > 0 && (
            <span className="hidden items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 sm:inline-flex">
              <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
              Key auto-filled
            </span>
          )}
          {!authenticated && (
            <span className="hidden items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 sm:inline-flex">
              Login for auto-fill
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {previousTurnIdRef.current && (
            <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">
              prev: {previousTurnIdRef.current.slice(0, 12)}…
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowDebug(!showDebug)}
            className={`rounded p-1.5 transition-colors ${showDebug ? "bg-zinc-800 text-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}
            title="Toggle debug panel"
          >
            <Activity className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowConfig(true)}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Settings"
          >
            <Settings className="size-4" />
          </button>
          <button
            type="button"
            onClick={resetSession}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="Reset"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex min-h-0 flex-1">
        {/* Chat */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6"
          >
            {empty ? (
              <div className="flex h-full min-h-[380px] items-center justify-center">
                <div className="max-w-sm space-y-4 text-center">
                  <p className="text-[15px] font-medium text-zinc-300">Try the agent</p>
                  <p className="text-[13px] leading-6 text-zinc-500">
                    Send a message to test the{" "}
                    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-cyan-400">
                      /v1/turns
                    </code>{" "}
                    endpoint. Open Settings to add your API key.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 pb-2">
                {messages.map((msg) =>
                  msg.role === "user" ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[70%] rounded-lg bg-indigo-600 px-4 py-2.5 text-sm text-white">
                        {msg.blocks.map((block, i) =>
                          block.type === "text" ? (
                            <p key={i} className="whitespace-pre-wrap">{block.content}</p>
                          ) : null,
                        )}
                      </div>
                    </div>
                  ) : (
                    <div key={msg.id} className="max-w-[85%]">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Assistant</span>
                          {msg.status === "streaming" && (
                            <Loader2 className="size-3 animate-spin text-cyan-400" />
                          )}
                          {msg.status === "error" && (
                            <span className="text-[10px] text-rose-400">failed</span>
                          )}
                          {msg.turnId && (
                            <span className="ml-auto font-mono text-[10px] text-zinc-600">
                              {msg.turnId.slice(0, 16)}…
                            </span>
                          )}
                        </div>

                        {msg.blocks.length === 0 && !msg.reasoningText?.trim() ? (
                          <p className="text-sm text-zinc-500">Processing…</p>
                        ) : (
                          <div className="space-y-3">
                            {msg.reasoningText?.trim() && (
                              <details
                                className="rounded border border-violet-500/20 bg-violet-500/5"
                                open={msg.status === "streaming"}
                              >
                                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-violet-400 hover:bg-violet-500/10">
                                  <ChevronRight className="size-3" />
                                  Reasoning
                                </summary>
                                <div className="border-t border-violet-500/10 px-3 py-2">
                                  <pre className="whitespace-pre-wrap break-words text-xs text-violet-300/80">
                                    {msg.reasoningText}
                                  </pre>
                                </div>
                              </details>
                            )}
                            {msg.blocks.map((block, i) =>
                              block.type === "text" ? (
                                block.content ? (
                                  <div key={`t-${i}`} className="whitespace-pre-wrap break-words text-sm text-zinc-200">
                                    {block.content}
                                  </div>
                                ) : null
                              ) : (
                                <ToolCallCard key={`tc-${i}`} call={block} />
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 px-4 py-3">
            {/* File queue */}
            {queuedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {queuedFiles.map((file, index) => (
                  <span
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300"
                  >
                    <Paperclip className="size-3" />
                    {file.name}
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(index)}
                      className="text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                title="Attach file"
              >
                <Paperclip className="size-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleQueueFiles(e.target.files)}
              />
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Type a message…"
                rows={2}
                className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500/50 focus:outline-none"
              />
              <div className="flex flex-col gap-1.5">
                {runState === "streaming" ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
                  >
                    <Square className="size-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    className="flex items-center justify-center rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
                  >
                    <Send className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Debug panel */}
        {showDebug && (
          <div className="hidden w-[340px] shrink-0 border-l border-zinc-800 lg:block">
            <DebugPanel
              request={debugReq}
              events={debugEvents}
              snapshot={debugSnapshot}
              activeTab={debugTab}
              onTabChange={setDebugTab}
              apiBaseURL={apiBaseURL}
              apiToken={apiKey}
            />
          </div>
        )}
      </div>

      {/* Config Drawer */}
      <ConfigDrawer
        open={showConfig}
        onClose={() => setShowConfig(false)}
        apiKey={apiKey}
        setAPIKey={setAPIKey}
        reasoningEnabled={reasoningEnabled}
        setReasoningEnabled={setReasoningEnabled}
        reasoningEffort={reasoningEffort}
        setReasoningEffort={setReasoningEffort}
        matchingTokens={matchingTokens}
        authenticated={authenticated}
      />
    </div>
  );
}
