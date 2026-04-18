import {
  Activity,
  ChevronDown,
  ChevronRight,
  Code2,
  FileJson,
  Loader2,
  Network,
  RotateCcw,
  Send,
  Settings,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import {
  type PublicAPITurnEvent,
  type PublicAPITurnSnapshot,
} from "@/core/public-api/api";
import { createPublicAPISession } from "@/core/public-api/session";

// ─── Types ────────────────────────────────────────────────

type ReasoningEffort = "minimal" | "low" | "medium" | "high";
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
  timestamp: number;
  summary: string;
}

interface StoredRequest {
  url: string;
  body: unknown;
}

// ─── Constants ────────────────────────────────────────────

const DEFAULT_BASE_URL =
  import.meta.env.VITE_DEMO_PUBLIC_API_BASE_URL?.trim() ||
  "http://127.0.0.1:8083/v1";
const DEFAULT_API_KEY =
  import.meta.env.VITE_DEMO_PUBLIC_API_KEY?.trim() || "";
const DEFAULT_AGENT_NAME =
  import.meta.env.VITE_DEMO_DEFAULT_AGENT_NAME?.trim() ||
  "support-cases-sdk-demo";
const DEFAULT_STDIO_API_KEY =
  import.meta.env.VITE_DEMO_STDIO_API_KEY?.trim() || "";
const DEFAULT_HTTP_API_KEY =
  import.meta.env.VITE_DEMO_HTTP_API_KEY?.trim() || DEFAULT_API_KEY;
const STDIO_AGENT_NAME =
  import.meta.env.VITE_DEMO_STDIO_AGENT_NAME?.trim() || "";
const HTTP_AGENT_NAME =
  import.meta.env.VITE_DEMO_HTTP_AGENT_NAME?.trim() || "";

const QUICK_PROMPTS = [
  {
    id: "list",
    label: "列出文件",
    prompt: "案例库里有哪些文件？请直接列出文件名，不要编造。",
  },
  {
    id: "read",
    label: "读取第一页",
    prompt:
      "请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。",
  },
  {
    id: "glob",
    label: "筛选 Final_",
    prompt: "请只列出文件名以 Final_ 开头的案例文件。",
  },
  {
    id: "grep",
    label: "搜索 夏仲奇",
    prompt:
      `请搜索案例库中包含"夏仲奇"的文件，并告诉我出现在哪些文件`,
  },
];

const TRACE_TEXT = {
  assistantMessage: "助手回复",
  assistantThinking: "思考内容",
  toolCall: "工具调用",
  toolResult: "工具结果",
  turnCompleted: "运行完成",
  turnStarted: "turn.started",
  turnWaiting: "等待用户输入",
  turnFailed: "turn.failed",
} as const;

// ─── Utilities ────────────────────────────────────────────

function uid() {
  return crypto.randomUUID();
}

function fmtTime(ts: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(ts);
}

function fmtJSON(obj: unknown, max = 300): string {
  try {
    const s = JSON.stringify(obj, null, 2);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(obj);
  }
}

function resolveApiRoot(raw: string) {
  const t = raw.replace(/\/+$/, "");
  return t.endsWith("/v1") ? t : `${t}/v1`;
}

function summarizeEvent(e: PublicAPITurnEvent): string {
  switch (e.type) {
    case "turn.started":
      return e.turn_id ?? "";
    case "assistant.text.delta": {
      const d = e.delta ?? "";
      return d.length > 50 ? `"${d.slice(0, 50)}…"` : `"${d}"`;
    }
    case "assistant.reasoning.delta": {
      const d = e.delta ?? "";
      return d.length > 40 ? `"${d.slice(0, 40)}…"` : `"${d}"`;
    }
    case "tool.call.started":
      return e.tool_name ?? "";
    case "tool.call.completed":
      return e.tool_name ?? "";
    case "turn.completed":
      return "completed";
    case "turn.failed":
      return e.error ?? "error";
    case "turn.requires_input":
      return e.text ?? "";
    case "assistant.message.started":
      return e.message_id ?? "";
    case "assistant.message.completed":
      return "done";
    default:
      return "";
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

function Markdown({
  content,
  streaming,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  if (!content) return null;
  if (streaming) {
    return (
      <pre
        className={`whitespace-pre-wrap break-words font-inherit text-inherit ${className ?? ""}`}
      >
        {content}
      </pre>
    );
  }
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function StatusDot({ phase }: { phase: RunPhase }) {
  const dot: Record<RunPhase, string> = {
    ready: "bg-emerald-400",
    streaming: "bg-cyan-400 animate-pulse",
    failed: "bg-rose-400",
    waiting: "bg-amber-400",
  };
  const label: Record<RunPhase, string> = {
    ready: "就绪",
    streaming: "流式中",
    failed: "失败",
    waiting: "等待输入",
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
        <span className="font-mono text-amber-300 text-xs">
          {call.name}
        </span>
        {done ? (
          <span className="ml-auto text-[10px] text-zinc-500">
            {fmtTime(call.completedAt!)}
          </span>
        ) : (
          <Loader2 className="ml-auto size-3 animate-spin text-amber-400" />
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-amber-500/10 px-3 py-2">
          {call.arguments !== undefined && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                参数
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-xs text-zinc-300">
                {fmtJSON(call.arguments, 500)}
              </pre>
            </div>
          )}
          {call.output !== undefined && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                返回
              </p>
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
}: {
  request: StoredRequest | null;
  events: DebugEntry[];
  snapshot: PublicAPITurnSnapshot | null;
  activeTab: DebugTab;
  onTabChange: (t: DebugTab) => void;
}) {
  const eventsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    eventsRef.current?.scrollTo({ top: eventsRef.current.scrollHeight });
  }, [events]);

  const tabs: { key: DebugTab; icon: typeof Activity; label: string }[] = [
    { key: "request", icon: Send, label: "Request" },
    { key: "events", icon: Activity, label: "Events" },
    { key: "snapshot", icon: FileJson, label: "Snapshot" },
  ];

  return (
    <div className="flex h-full flex-col bg-[#0d0f16]">
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
        {/* Request Tab */}
        {activeTab === "request" && (
          <div className="space-y-3">
            {request ? (
              <>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                    Endpoint
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">
                      POST
                    </span>
                    <code className="text-xs text-zinc-300 break-all">
                      {request.url}
                    </code>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                    Headers
                  </p>
                  <pre className="rounded bg-zinc-900/60 p-2 font-mono text-xs text-zinc-400">
                    {`Authorization: Bearer sk-***\nContent-Type: application/json\nAccept: text/event-stream`}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                    Body
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-xs text-zinc-300">
                    {fmtJSON(request.body, 2000)}
                  </pre>
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-zinc-600">
                发送消息后这里会显示 HTTP 请求详情
              </p>
            )}
          </div>
        )}

        {/* Events Tab */}
        {activeTab === "events" && (
          <div ref={eventsRef} className="space-y-0.5 font-mono text-xs">
            {events.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-600">
                流式响应事件会实时显示在这里
              </p>
            ) : (
              events.map((entry, i) => (
                <div
                  key={`${entry.type}-${i}`}
                  className="flex items-start gap-2 rounded px-2 py-1 hover:bg-zinc-800/50"
                >
                  <span className="shrink-0 text-zinc-600">
                    {fmtTime(entry.timestamp)}
                  </span>
                  <span className={`shrink-0 ${eventAccent(entry.type)}`}>
                    {entry.type}
                  </span>
                  {entry.summary && (
                    <span className="truncate text-zinc-500">
                      {entry.summary}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Snapshot Tab */}
        {activeTab === "snapshot" && (
          <div className="space-y-3">
            {snapshot ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Turn ID", snapshot.id],
                    ["Status", snapshot.status],
                    ["Agent", snapshot.agent],
                    ["Thread", snapshot.thread_id ?? "—"],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                    >
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                        {k}
                      </p>
                      <p className="truncate font-mono text-xs text-zinc-300">
                        {v ?? "—"}
                      </p>
                    </div>
                  ))}
                </div>
                {snapshot.output_text && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                      Output
                    </p>
                    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-zinc-900/60 p-2 font-mono text-xs text-zinc-300">
                      {snapshot.output_text.slice(0, 1000)}
                    </pre>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                    Full Snapshot
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-[11px] text-zinc-400">
                    {fmtJSON(snapshot, 5000)}
                  </pre>
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-zinc-600">
                运行完成后这里会显示最终 Turn 快照
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Config Drawer ────────────────────────────────────────

function ConfigDrawer({
  open,
  onClose,
  apiBaseURL,
  setAPIBaseURL,
  apiKey,
  setAPIKey,
  agentName,
  setAgentName,
  reasoningEnabled,
  setReasoningEnabled,
  reasoningEffort,
  setReasoningEffort,
}: {
  open: boolean;
  onClose: () => void;
  apiBaseURL: string;
  setAPIBaseURL: (v: string) => void;
  apiKey: string;
  setAPIKey: (v: string) => void;
  agentName: string;
  setAgentName: (v: string) => void;
  reasoningEnabled: boolean;
  setReasoningEnabled: (v: boolean) => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (v: ReasoningEffort) => void;
}) {
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l border-zinc-700/50 bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-700/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">连接配置</h2>
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
            <span className="text-xs font-medium text-zinc-400">Base URL</span>
            <input
              value={apiBaseURL}
              onChange={(e) => setAPIBaseURL(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setAPIKey(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Agent</span>
            <input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-cyan-500/50 focus:outline-none"
            />
          </label>
          {(STDIO_AGENT_NAME || HTTP_AGENT_NAME) && (
            <div className="flex flex-wrap gap-2">
              {STDIO_AGENT_NAME && (
                <button
                  type="button"
                  onClick={() => {
                    setAgentName(STDIO_AGENT_NAME);
                    if (DEFAULT_STDIO_API_KEY) setAPIKey(DEFAULT_STDIO_API_KEY);
                  }}
                  className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-cyan-500/30 hover:text-cyan-400"
                >
                  Stdio Agent
                </button>
              )}
              {HTTP_AGENT_NAME && (
                <button
                  type="button"
                  onClick={() => {
                    setAgentName(HTTP_AGENT_NAME);
                    if (DEFAULT_HTTP_API_KEY) setAPIKey(DEFAULT_HTTP_API_KEY);
                  }}
                  className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-cyan-500/30 hover:text-cyan-400"
                >
                  HTTP Agent
                </button>
              )}
            </div>
          )}
          <hr className="border-zinc-800" />
          <label className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">
              开启思考
            </span>
            <input
              type="checkbox"
              checked={reasoningEnabled}
              onChange={(e) => setReasoningEnabled(e.target.checked)}
              className="accent-cyan-500"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">
              思考强度
            </span>
            <select
              value={reasoningEffort}
              disabled={!reasoningEnabled}
              onChange={(e) =>
                setReasoningEffort(e.target.value as ReasoningEffort)
              }
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
        </div>
      </aside>
    </>
  );
}

// ─── Main App ─────────────────────────────────────────────

export function App() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ReturnType<typeof createPublicAPISession> | null>(
    null,
  );
  const sessionConfigKeyRef = useRef("");

  // Config
  const [apiBaseURL, setAPIBaseURL] = useState(DEFAULT_BASE_URL);
  const [apiKey, setAPIKey] = useState(DEFAULT_API_KEY);
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("medium");

  // Chat
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [previousTurnID, setPreviousTurnID] = useState("");
  const [runState, setRunState] = useState<RunPhase>("ready");

  // Debug
  const [debugReq, setDebugReq] = useState<StoredRequest | null>(null);
  const [debugEvents, setDebugEvents] = useState<DebugEntry[]>([]);
  const [debugSnapshot, setDebugSnapshot] =
    useState<PublicAPITurnSnapshot | null>(null);
  const [debugTab, setDebugTab] = useState<DebugTab>("events");

  // UI
  const [showConfig, setShowConfig] = useState(false);
  const [showDebug, setShowDebug] = useState(true);

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
    setMessages([]);
    setPreviousTurnID("");
    setRunState("ready");
    setDebugReq(null);
    setDebugEvents([]);
    setDebugSnapshot(null);
  }

  async function handleSend(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    const key = apiKey.trim();
    const agent = agentName.trim();

    if (!key) {
      toast.error("请先填入 API Key");
      return;
    }
    if (!agent) {
      toast.error("请先指定 Agent");
      return;
    }
    if (!prompt) {
      toast.error("请输入消息");
      return;
    }

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
    const requestBody = session.previewRequest({
      text: prompt,
      thinking: { enabled: reasoningEnabled, effort: reasoningEffort },
      metadata: { source: "dev_console", surface: "standalone_demo" },
    });

    setDebugReq({ url: `${resolveApiRoot(apiBaseURL)}/turns`, body: requestBody });
    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: "user",
        content: prompt,
        status: "done",
        blocks: [{ type: "text", content: prompt }],
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
        thinking: { enabled: reasoningEnabled, effort: reasoningEffort },
        metadata: { source: "dev_console", surface: "standalone_demo" },
        signal: ctrl.signal,
        onUpdate: ({ event, readModel }) => {
          const ledgerEvt = event.kind === "ledger_event" ? event.event : null;
          if (ledgerEvt) {
            setDebugEvents((prev) => [
              ...prev,
              {
                type: ledgerEvt.type,
                timestamp: ledgerEvt.created_at * 1000,
                summary: summarizeEvent(ledgerEvt),
              },
            ]);
          } else if (event.kind === "turn_started") {
            setDebugEvents((prev) => [
              ...prev,
              {
                type: "turn.started",
                timestamp: Date.now(),
                summary: event.turnId,
              },
            ]);
          } else if (event.kind === "turn_completed") {
            setDebugEvents((prev) => [
              ...prev,
              {
                type: "turn.completed",
                timestamp: Date.now(),
                summary: event.turnId,
              },
            ]);
          } else if (event.kind === "turn_failed") {
            setDebugEvents((prev) => [
              ...prev,
              {
                type: "turn.failed",
                timestamp: Date.now(),
                summary: event.detail,
              },
            ]);
          }

          updateMsg(asstId, (m) => {
            const blocks = [...m.blocks];

            if (event.kind === "assistant_text_delta") {
              const last = blocks[blocks.length - 1];
              if (last && last.type === "text") {
                blocks[blocks.length - 1] = {
                  ...last,
                  content: readModel.liveOutput,
                };
              } else {
                blocks.push({ type: "text", content: readModel.liveOutput });
              }
            } else if (
              event.kind === "ledger_event" &&
              event.event.type === "tool.call.started"
            ) {
              blocks.push({
                type: "tool_call",
                name: event.event.tool_name ?? "unknown",
                arguments: event.event.tool_arguments,
                startedAt: event.event.created_at * 1000,
              });
            } else if (
              event.kind === "ledger_event" &&
              event.event.type === "tool.call.completed"
            ) {
              for (let i = blocks.length - 1; i >= 0; i--) {
                const block = blocks[i];
                if (
                  block.type === "tool_call" &&
                  block.name === (event.event.tool_name ?? "unknown") &&
                  !block.completedAt
                ) {
                  blocks[i] = {
                    ...block,
                    output: event.event.tool_output,
                    completedAt: event.event.created_at * 1000,
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

          if (readModel.phase === "failed") {
            setRunState("failed");
          } else if (readModel.phase === "waiting") {
            setRunState("waiting");
          }
        },
      });
      const finalized = result.turn;

      if (!finalized) {
        setRunState("ready");
        updateMsg(asstId, (m) => ({ ...m, status: "done" }));
        return;
      }
      setDebugSnapshot(finalized);
      setPreviousTurnID(session.getPreviousTurnId());
      const finalStatus =
        finalized.status === "completed"
          ? "done" as const
          : finalized.status === "requires_input"
            ? "done" as const
            : "error" as const;
      updateMsg(asstId, (m) => {
        // If output_text from snapshot differs, replace all text blocks with final text
        const finalText = finalized.output_text?.trim();
        if (finalText) {
          const toolBlocks = m.blocks.filter((b) => b.type === "tool_call");
          const hasText = m.blocks.some((b) => b.type === "text");
          if (!hasText || toolBlocks.length === 0) {
            // Simple case: replace with single text block
          return {
            ...m,
            blocks: [{ type: "text" as const, content: finalText }, ...toolBlocks],
            status: finalStatus,
            turnId: finalized.id,
              reasoningText:
                result.readModel.liveReasoning || finalized.reasoning_text,
            };
          }
        }
        return {
          ...m,
          status: finalStatus,
          turnId: finalized.id,
          reasoningText:
            result.readModel.liveReasoning || finalized.reasoning_text,
        };
      });

      if (finalized.status === "requires_input") {
        setRunState("waiting");
        toast.message("等待用户输入");
        return;
      }
      setRunState("ready");
      toast.success("运行完成");
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
            : [{ type: "text" as const, content: `请求失败：${detail}` }],
      }));
    } finally {
      abortRef.current = null;
    }
  }

  // ── Render ─────────────────────────────────────

  return (
    <div className="flex h-screen flex-col bg-[#0a0b10] text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Code2 className="size-5 text-cyan-400" />
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
              {agentName || "未指定 Agent"}
            </h1>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">
              OpenAgents Dev Console
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot phase={runState} />
          {previousTurnID && (
            <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">
              prev: {previousTurnID.slice(0, 12)}…
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowDebug(!showDebug)}
            className={`rounded p-1.5 transition-colors ${showDebug ? "bg-zinc-800 text-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}
            title="切换调试面板"
          >
            <Activity className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowConfig(true)}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="连接配置"
          >
            <Settings className="size-4" />
          </button>
          <button
            type="button"
            onClick={resetSession}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            title="重置会话"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex min-h-0 flex-1">
        {/* Chat */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6"
          >
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[400px] items-center justify-center">
                <div className="max-w-md space-y-6 text-center">
                  <div>
                    <Code2 className="mx-auto size-10 text-cyan-400/60" />
                    <h2 className="mt-3 text-xl font-semibold text-zinc-200">
                      OpenAgents HTTP 调试控制台
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      直接通过原生 HTTP 调用{" "}
                      <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-cyan-400">
                        /v1/turns
                      </code>{" "}
                      契约，实时查看请求、SSE 事件和 Turn 快照。
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {QUICK_PROMPTS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSend(p.prompt)}
                        className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-left transition-colors hover:border-cyan-500/30 hover:bg-zinc-800"
                      >
                        <span className="text-xs font-medium text-zinc-300">
                          {p.label}
                        </span>
                        <p className="mt-1 truncate text-[11px] text-zinc-600">
                          {p.prompt}
                        </p>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600">
                    点击上方问题快速开始，或在下方输入自定义消息
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 pb-2">
                {messages.map((msg) =>
                  msg.role === "user" ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[70%] rounded-lg bg-indigo-600 px-4 py-2.5 text-sm text-white">
                        <p className="whitespace-pre-wrap">{msg.blocks[0]?.type === "text" ? msg.blocks[0].content : ""}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={msg.id} className="max-w-[85%]">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3">
                        {/* Status indicator */}
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                            助手
                          </span>
                          {msg.status === "streaming" && (
                            <Loader2 className="size-3 animate-spin text-cyan-400" />
                          )}
                          {msg.status === "error" && (
                            <span className="text-[10px] text-rose-400">
                              failed
                            </span>
                          )}
                          {msg.turnId && (
                            <span className="ml-auto font-mono text-[10px] text-zinc-600">
                              {msg.turnId.slice(0, 16)}…
                            </span>
                          )}
                        </div>

                        {/* Ordered blocks: text and tool calls in stream order */}
                        {msg.blocks.length === 0 ? (
                          <p className="text-sm text-zinc-500">
                            处理中…
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {msg.blocks.map((block, i) =>
                              block.type === "text" ? (
                                block.content ? (
                                  <Markdown
                                    key={`t-${i}`}
                                    content={block.content}
                                    streaming={
                                      msg.status === "streaming" &&
                                      i === msg.blocks.length - 1
                                    }
                                    className="prose-invert prose-sm max-w-none text-zinc-200"
                                  />
                                ) : null
                              ) : (
                                <ToolCallCard key={`tc-${i}`} call={block} />
                              ),
                            )}
                          </div>
                        )}

                        {/* Reasoning */}
                        {msg.reasoningText?.trim() && (
                          <details
                            className="mt-3 rounded border border-violet-500/20 bg-violet-500/5"
                            open={msg.status === "streaming"}
                          >
                            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-violet-400 hover:bg-violet-500/10">
                              <ChevronRight className="size-3" />
                              思考过程
                            </summary>
                            <div className="border-t border-violet-500/10 px-3 py-2">
                              <Markdown
                                content={msg.reasoningText}
                                streaming={msg.status === "streaming"}
                                className="prose-invert prose-sm max-w-none text-xs text-violet-300/80"
                              />
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 px-4 py-3 lg:px-6">
            {/* Quick prompts */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDraft(p.prompt)}
                  className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-cyan-500/30 hover:text-cyan-400"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="输入消息，按 Enter 发送…"
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
                    disabled={false}
                    className="flex items-center justify-center rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="size-4" />
                  </button>
                )}
                <span className="flex items-center justify-center text-[10px] text-zinc-600">
                  <Network className="mr-1 size-3" />
                  HTTP
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Debug */}
        {showDebug && (
          <div className="hidden w-[380px] shrink-0 border-l border-zinc-800 lg:block">
            <DebugPanel
              request={debugReq}
              events={debugEvents}
              snapshot={debugSnapshot}
              activeTab={debugTab}
              onTabChange={setDebugTab}
            />
          </div>
        )}
      </div>

      {/* Config Drawer */}
      <ConfigDrawer
        open={showConfig}
        onClose={() => setShowConfig(false)}
        apiBaseURL={apiBaseURL}
        setAPIBaseURL={setAPIBaseURL}
        apiKey={apiKey}
        setAPIKey={setAPIKey}
        agentName={agentName}
        setAgentName={setAgentName}
        reasoningEnabled={reasoningEnabled}
        setReasoningEnabled={setReasoningEnabled}
        reasoningEffort={reasoningEffort}
        setReasoningEffort={setReasoningEffort}
      />
    </div>
  );
}
