import { Bot, Check, FileText, Loader2, Send, Settings, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  normalizeThreadError,
  shouldIgnoreThreadError,
} from "@/core/threads/error";

import { MarkdownRenderer } from "../components/markdown-renderer";
import { createChatSession, type ToolCallStep } from "../lib/chat-session";
import { resolvePublicAPIBaseURL } from "../lib/public-api";
import { createDemoId } from "../lib/uid";

const SETTINGS_KEY = "demo_chat_settings";

/* ─── Types ─────────────────────────────────────────────── */

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning: string;
  status: "streaming" | "done" | "error" | "interrupted";
  toolCalls?: ToolCallStep[];
};

type ChatSettings = {
  baseURI: string;
  apiKey: string;
  agentName: string;
};

/* ─── Settings helpers ──────────────────────────────────── */

function getDefaultBaseURI(): string {
  return (
    (import.meta.env.VITE_DEMO_PUBLIC_API_BASE_URL as string | undefined)
      ?.trim() || ""
  );
}

function getDefaultAPIKey(): string {
  return (
    (import.meta.env.VITE_DEMO_PUBLIC_API_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_DEMO_HTTP_API_KEY as string | undefined)?.trim() ||
    ""
  );
}

function getDefaultSettings(): ChatSettings {
  return {
    baseURI: getDefaultBaseURI(),
    apiKey: getDefaultAPIKey(),
    agentName:
      getDefaultAgentName() ||
      (import.meta.env.VITE_DEMO_HTTP_AGENT_NAME as string | undefined)
        ?.trim() ||
      "",
  };
}

function loadSettings(): ChatSettings {
  const defaults = getDefaultSettings();
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return {
        ...defaults,
        ...(JSON.parse(raw) as Partial<ChatSettings>),
      };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

function saveSettings(settings: ChatSettings) {
  sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* ─── Agent resolution ──────────────────────────────────── */

function getDefaultAgentName(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("agent");
  const fromEnv = import.meta.env.VITE_DEMO_DEFAULT_AGENT_NAME as
    | string
    | undefined;
  return fromQuery?.trim() || fromEnv?.trim() || null;
}

function getAgentNameFromQuery(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("agent")?.trim() || null;
}

function resolveAgentName(): string | null {
  const fromQuery = getAgentNameFromQuery();
  if (fromQuery) return fromQuery;
  const settings = loadSettings();
  if (settings.agentName?.trim()) return settings.agentName.trim();
  return getDefaultAgentName();
}

/* ─── Utilities ─────────────────────────────────────────── */

function createMessageId() {
  return createDemoId("chat");
}

function isDemoOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  return normalizeThreadError(error);
}

/* ─── Components ────────────────────────────────────────── */

function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" }) {
  const map = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    danger: "bg-rose-500",
  };
  return (
    <span className={`inline-block size-2 rounded-full ${map[tone]}`} />
  );
}

function safeParseJSON(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

const DOCUMENT_PATH_KEYS = new Set([
  "path",
  "file_path",
  "filepath",
  "filename",
  "document_path",
  "asset_path",
]);

const DOCUMENT_PATH_ARRAY_KEYS = new Set([
  "paths",
  "files",
  "filenames",
  "items",
  "results",
  "documents",
  "assets",
]);

function looksLikeKnowledgePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return false;
  return (
    trimmed.includes("/") ||
    /\.(md|markdown|txt|pdf|docx?|pptx?|xlsx?|csv|json|png|jpe?g|webp|gif)$/i.test(
      trimmed,
    )
  );
}

function shouldCollectStringPath(parentKey: string | undefined, value: string) {
  if (!parentKey) return false;
  return (
    (DOCUMENT_PATH_KEYS.has(parentKey) ||
      DOCUMENT_PATH_ARRAY_KEYS.has(parentKey)) &&
    looksLikeKnowledgePath(value)
  );
}

function collectPathsFromValue(
  value: unknown,
  paths: Set<string>,
  parentKey?: string,
) {
  if (typeof value === "string") {
    if (shouldCollectStringPath(parentKey, value)) {
      paths.add(value.trim());
    }
    return;
  }

  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectPathsFromValue(item, paths, parentKey));
    return;
  }

  const record = value as Record<string, unknown>;
  // Tool outputs may nest file paths inside search results, content blocks, or
  // asset metadata. We extract only path-shaped fields so the customer-facing
  // trace stays useful without leaking raw tool JSON.
  Object.entries(record).forEach(([key, item]) =>
    collectPathsFromValue(item, paths, key),
  );
}

function getReadFilePaths(tool: ToolCallStep): string[] {
  if (
    tool.name !== "document_read" &&
    tool.name !== "document_fetch_asset" &&
    tool.name !== "document_search" &&
    tool.name !== "document_list"
  ) {
    return [];
  }

  const paths = new Set<string>();
  collectPathsFromValue(tool.arguments, paths);
  tool.output?.forEach((item) => {
    if (!item.text) return;
    const parsed = safeParseJSON(item.text);
    if (parsed) collectPathsFromValue(parsed, paths);
  });
  return Array.from(paths);
}

function getToolActivityTitle(tool: ToolCallStep, fileCount: number) {
  if (tool.status === "running") {
    if (tool.name === "document_read" || tool.name === "document_fetch_asset") {
      return "正在读取知识库文件";
    }
    if (tool.name === "document_list") {
      return "正在列出知识库文件";
    }
    return "正在检索知识库";
  }

  if (tool.status === "error") {
    return "知识库工具调用失败";
  }

  if (tool.name === "document_read" || tool.name === "document_fetch_asset") {
    return fileCount > 0
      ? `已读取 ${fileCount} 个知识库文件`
      : "已读取知识库文件";
  }

  if (tool.name === "document_list") {
    return fileCount > 0
      ? `已列出 ${fileCount} 个知识库文件`
      : "已列出知识库文件";
  }

  return fileCount > 0
    ? `检索到 ${fileCount} 个知识库文件`
    : "未检索到知识库文件";
}

function ToolActivityCard({ tools }: { tools: ToolCallStep[] }) {
  const activityItems = tools
    .map((tool) => {
      const paths = getReadFilePaths(tool);
      return {
        id: tool.id,
        status: tool.status,
        title: getToolActivityTitle(tool, paths.length),
        paths,
      };
    })
    .filter((item) => item.paths.length > 0 || item.status === "running");
  const hasRunningTool = tools.some((tool) => tool.status === "running");
  const hasToolError = tools.some((tool) => tool.status === "error");

  if (activityItems.length === 0) return null;

  return (
    <div className="mb-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <FileText className="size-3.5 shrink-0 text-slate-400" />
        <span className="font-medium">
          知识库工具调用 {activityItems.length} 次
        </span>
        {hasRunningTool ? (
          <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin text-emerald-500" />
        ) : hasToolError ? (
          <X className="ml-auto size-3.5 shrink-0 text-rose-500" />
        ) : (
          <Check className="ml-auto size-3.5 shrink-0 text-emerald-500" />
        )}
      </div>
      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
        {activityItems.map((item, index) => (
          <div key={item.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                #{index + 1}
              </span>
              <span>{item.title}</span>
              {item.status === "running" && (
                <Loader2 className="ml-auto size-3 animate-spin text-emerald-500" />
              )}
              {item.status === "error" && (
                <X className="ml-auto size-3 text-rose-500" />
              )}
            </div>
            {item.paths.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {item.paths.map((path) => (
                  <li
                    key={path}
                    className="truncate rounded border border-slate-100 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600"
                    title={path}
                  >
                    {path}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReasoningCard({
  reasoning,
  isStreaming,
}: {
  reasoning: string;
  isStreaming: boolean;
}) {
  if (!reasoning || reasoning.trim().length === 0) return null;

  return (
    <div className="mb-1.5 overflow-hidden rounded-md border border-amber-200/60 bg-amber-50/40 text-left">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Sparkles className="size-3 shrink-0 text-amber-500" />
        <span className="text-[11px] font-medium text-slate-600">思考过程</span>
        {isStreaming && (
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-amber-500">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
            思考中
          </span>
        )}
      </div>
      <div className="border-t border-amber-100/60 px-2.5 py-1.5">
        <pre className="max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words rounded bg-white/70 p-2 text-[12px] leading-[1.7] text-slate-600">
          {reasoning}
        </pre>
      </div>
    </div>
  );
}

function ConfigurationWarning({
  agentName,
  baseURLIsDemo,
}: {
  agentName: string | null;
  baseURLIsDemo: boolean;
}) {
  if (!agentName) {
    return <>请在设置中配置 Agent 名称，或在 URL 中指定 ?agent=</>;
  }
  if (baseURLIsDemo) {
    return <>Base URI 不能留空（否则会请求到 demo 自身导致 404），请在设置中填写</>;
  }
  return <>请在右上角设置中填写 API Key</>;
}

/* ─── Main Chat Page ────────────────────────────────────── */

export function ChatPage() {
  const agentName = resolveAgentName();
  const agentNameFromQuery = getAgentNameFromQuery();

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ReturnType<typeof createChatSession> | null>(null);
  const sessionKeyRef = useRef("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const [settings, setSettingsState] = useState<ChatSettings>(loadSettings);
  const [baseURIInput, setBaseURIInput] = useState(settings.baseURI);
  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey);
  const [agentNameInput, setAgentNameInput] = useState(
    settings.agentName || getDefaultAgentName() || "",
  );

  const resolvedBaseURL = resolvePublicAPIBaseURL(baseURIInput || null);
  const baseURLIsDemo = isDemoOrigin(resolvedBaseURL);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = messages.length === 0;
  const isConfigured =
    agentName != null && agentName.trim() !== "" && apiKeyInput.trim() !== "" && !baseURLIsDemo;

  /* Override body styles for light theme */
  useEffect(() => {
    document.body.style.color = "#1e293b";
    document.body.style.background =
      "linear-gradient(180deg, #f0fdf4 0%, #ffffff 40%, #f8fafc 100%)";
    return () => {
      document.body.style.color = "";
      document.body.style.background = "";
    };
  }, []);

  /* Sync settings inputs when drawer opens */
  useEffect(() => {
    if (settingsOpen) {
      setBaseURIInput(settings.baseURI);
      setApiKeyInput(settings.apiKey);
      setAgentNameInput(settings.agentName || getDefaultAgentName() || "");
    }
  }, [settingsOpen, settings]);

  /* Auto-scroll */
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  /* Auto-resize textarea */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const ensureSession = useCallback(() => {
    const configKey = `${resolvedBaseURL}\n${apiKeyInput.trim()}\n${agentName ?? ""}`;
    if (!sessionRef.current || sessionKeyRef.current !== configKey) {
      sessionRef.current = createChatSession({
        baseURL: resolvedBaseURL,
        apiToken: apiKeyInput.trim(),
        agent: agentName ?? "",
      });
      sessionKeyRef.current = configKey;
    }
    return sessionRef.current;
  }, [resolvedBaseURL, apiKeyInput, agentName]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming || !isConfigured) return;

    const userId = createMessageId();
    const assistantMessageId = createMessageId();
    const abortController = new AbortController();
    abortRef.current = abortController;

    setDraft("");
    setError(null);
    setIsStreaming(true);

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text, reasoning: "", status: "done" },
      { id: assistantMessageId, role: "assistant", content: "", reasoning: "", status: "streaming", toolCalls: [] },
    ]);

    const session = ensureSession();
    let latestPhase: "streaming" | "waiting" | "ready" | "failed" | "interrupted" =
      "streaming";
    let latestError = "";

    session
      .prompt({
        text,
        stream: true,
        signal: abortController.signal,
        onUpdate: ({ text: liveText, reasoning: liveReasoning, phase, error: liveError }) => {
          latestPhase = phase;
          latestError = liveError ?? latestError;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    // Failed public runs can terminate without a turn snapshot.
                    // Preserve the streamed content when present, otherwise
                    // surface the normalized terminal error inline.
                    content:
                      liveText ||
                      m.content ||
                      (phase === "failed" && liveError
                        ? `Error: ${liveError}`
                        : ""),
                    reasoning: liveReasoning,
                    status:
                      phase === "failed"
                        ? "error"
                        : phase === "interrupted"
                          ? "interrupted"
                        : phase === "ready"
                          ? "done"
                          : "streaming",
                  }
                : m,
            ),
          );
          if (phase === "failed" && liveError) {
            setError(liveError);
          }
        },
        onToolCall: (tool) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMessageId || !m.toolCalls) return m;
              const existing = m.toolCalls.find((t) => t.id === tool.id);
              if (existing) {
                return {
                  ...m,
                  toolCalls: m.toolCalls.map((t) =>
                    t.id === tool.id ? tool : t,
                  ),
                };
              }
              return { ...m, toolCalls: [...m.toolCalls, tool] };
            }),
          );
        },
      })
      .then((result) => {
        if (!result.turn) {
          if (latestPhase === "failed") {
            const detail = latestError || "Request failed";
            setError(detail);
            toast.error(detail);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      status: "error",
                      content: m.content || `Error: ${detail}`,
                    }
                  : m,
              ),
            );
          }
          setIsStreaming(false);
          return;
        }
        const finalStatus =
          result.turn.status === "completed" ||
          result.turn.status === "requires_input"
            ? "done"
            : "error";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: result.turn?.output_text?.trim() || m.content,
                  status: finalStatus,
                }
              : m,
          ),
        );
        setIsStreaming(false);
      })
      .catch((err) => {
        if (shouldIgnoreThreadError(err)) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? { ...m, status: "interrupted" }
                : m,
            ),
          );
          setIsStreaming(false);
          return;
        }
        const detail = getErrorMessage(err);
        setError(detail);
        toast.error(detail);
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  status: "error",
                  content: m.content || `Error: ${detail}`,
                }
              : m,
          ),
        );
      })
      .finally(() => {
        abortRef.current = null;
      });
  }, [draft, isStreaming, isConfigured, ensureSession]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const handleSaveSettings = useCallback(() => {
    const next = {
      baseURI: baseURIInput.trim(),
      apiKey: apiKeyInput.trim(),
      agentName: agentNameInput.trim(),
    };
    setSettingsState(next);
    saveSettings(next);
    setSettingsOpen(false);
    toast.success("设置已保存");
  }, [baseURIInput, apiKeyInput, agentNameInput]);

  const handleResetChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current?.reset();
    setMessages([]);
    setIsStreaming(false);
    setError(null);
    setSettingsOpen(false);
  }, []);

  /* ─── Render ────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-emerald-50/70 via-white to-white text-slate-800">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-emerald-100/70 bg-white/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm">
            <Bot className="size-5" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">
              AI 助手
            </span>
            {isConfigured ? (
              <StatusDot tone="ok" />
            ) : (
              <StatusDot tone="warn" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="设置"
          >
            <Settings className="size-5" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {empty ? (
          <div className="flex flex-col items-center justify-center pt-20">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-200">
              <Bot className="size-9" />
            </div>
            <h1 className="mb-2 text-xl font-semibold text-slate-800">
              你好，我是{" "}
              <span className="text-emerald-600">
                {agentName ?? "AI"} 助手
              </span>
            </h1>
            <p className="max-w-md text-center text-sm leading-6 text-slate-500">
              有什么可以帮您的吗？请输入您的问题，我会尽力为您解答。
            </p>
            {!isConfigured && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <ConfigurationWarning
                  agentName={agentName}
                  baseURLIsDemo={baseURLIsDemo}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-emerald-500 px-4 py-2.5 text-sm leading-6 text-white shadow-sm">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[85%]">
                    {/* Reasoning */}
                    {msg.reasoning && msg.reasoning.trim().length > 0 && (
                      <div className="mb-1.5">
                        <ReasoningCard
                          reasoning={msg.reasoning}
                          isStreaming={msg.status === "streaming"}
                        />
                      </div>
                    )}

                    {/* Tool calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mb-1.5">
                        <ToolActivityCard tools={msg.toolCalls} />
                      </div>
                    )}

                    <div
                      className={`rounded-2xl rounded-tl-sm border bg-white px-4 py-3 shadow-sm ${
                        msg.status === "error"
                          ? "border-rose-200 bg-rose-50"
                          : "border-slate-100"
                      }`}
                    >
                      {msg.status === "streaming" &&
                      msg.content.length === 0 &&
                      !msg.reasoning &&
                      (!msg.toolCalls || msg.toolCalls.length === 0) ? (
                        <div className="flex items-center gap-2 text-slate-400">
                          <Loader2 className="size-4 animate-spin" />
                          <span>思考中…</span>
                        </div>
                      ) : msg.status === "interrupted" &&
                        msg.content.length === 0 ? (
                        <div className="text-sm leading-6 text-slate-500">
                          已中断
                        </div>
                      ) : (
                        <div className="text-sm leading-6 text-slate-700">
                          <MarkdownRenderer content={msg.content} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}

            {error && (
              <div className="flex justify-center">
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
                  {error}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {!isConfigured && !empty && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {!agentName
                ? "请在设置中配置 Agent 名称，或在 URL 中指定 ?agent="
                : baseURLIsDemo
                  ? "Base URI 不能留空，请在设置中填写正确的 API 地址"
                  : "请在右上角设置中填写 API Key"}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 transition-colors focus-within:border-emerald-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="请输入您的问题，Shift+Enter 换行"
              rows={1}
              disabled={!isConfigured || isStreaming}
              className="min-h-[40px] max-h-[160px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-slate-700 placeholder-slate-400 outline-none disabled:opacity-50"
              style={{ height: "auto" }}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600 transition-colors hover:bg-slate-300"
                title="停止"
              >
                <Square className="size-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!draft.trim() || !isConfigured}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                title="发送"
              >
                <Send className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-slate-400">
            内容由 AI 生成，仅供参考
          </p>
        </div>
      </div>

      {/* Settings Drawer */}
      {settingsOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setSettingsOpen(false)}
          />
          <aside className="fixed top-0 right-0 z-50 flex h-full w-80 flex-col border-l border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-800">设置</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-600">
                  Base URI
                </label>
                <input
                  type="text"
                  value={baseURIInput}
                  onChange={(e) => setBaseURIInput(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <p className="text-xs text-slate-400">
                  留空则使用默认地址
                </p>
                <p className="text-xs font-mono text-slate-400">
                  解析后: {resolvedBaseURL}
                </p>
                {baseURLIsDemo && (
                  <p className="text-xs text-rose-500">
                    解析地址与当前页面同源，会导致请求 404，请填写正确的 API 地址
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-600">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="df_..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <p className="text-xs text-slate-400">
                  仅保存在 sessionStorage，关闭标签页后清除
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-600">
                  Agent 名称
                </label>
                <input
                  type="text"
                  value={agentNameInput}
                  onChange={(e) => setAgentNameInput(e.target.value)}
                  placeholder="support-cases-http-demo"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                {agentNameFromQuery ? (
                  <p className="text-xs text-amber-600">
                    当前由 URL 参数 ?agent={agentNameFromQuery} 控制，修改设置不会生效
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    来源优先级: URL ?agent= &gt; 设置 &gt; VITE_DEMO_DEFAULT_AGENT_NAME
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={handleResetChat}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                >
                  清空对话
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
