import {
  Loader2Icon,
  NetworkIcon,
  SearchIcon,
  ServerCogIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { type PublicAPIResponseEnvelope } from "@/core/public-api/api";
import {
  coercePublicAPIResponse,
  createBrowserPublicAPIClient,
  normalizeSDKResponseEvent,
} from "@/core/public-api/sdk-compat";
import {
  applyNormalizedPublicAPIRunEvent,
  applyPublicAPIResponseEnvelope,
  buildPublicAPIReasoningRequest,
  createPublicAPIRunReadModel,
  type PublicAPIReasoningEffort,
} from "@/core/public-api/run-session";

type DemoMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  responseId?: string;
  toolCallCount?: number;
  reasoningSummary?: string;
  activity?: Array<{
    title: string;
    detail?: string;
    timestamp: number;
  }>;
};

const DEFAULT_BASE_URL =
  import.meta.env.VITE_DEMO_PUBLIC_API_BASE_URL?.trim() ||
  "http://127.0.0.1:8083/v1";
const DEFAULT_API_KEY = import.meta.env.VITE_DEMO_PUBLIC_API_KEY?.trim() || "";
const DEFAULT_AGENT_NAME =
  import.meta.env.VITE_DEMO_DEFAULT_AGENT_NAME?.trim() ||
  "support-cases-sdk-demo";
const DEFAULT_STDIO_API_KEY =
  import.meta.env.VITE_DEMO_STDIO_API_KEY?.trim() || "";
const DEFAULT_HTTP_API_KEY =
  import.meta.env.VITE_DEMO_HTTP_API_KEY?.trim() ||
  DEFAULT_API_KEY;
const STDIO_AGENT_NAME =
  import.meta.env.VITE_DEMO_STDIO_AGENT_NAME?.trim() || "";
const HTTP_AGENT_NAME = import.meta.env.VITE_DEMO_HTTP_AGENT_NAME?.trim() || "";

const PROMPTS = [
  {
    id: "list-files",
    label: "列出文件",
    prompt: "案例库里有哪些文件？请直接列出文件名，不要编造。",
  },
  {
    id: "read-page",
    label: "读取第一页",
    prompt: "请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。",
  },
  {
    id: "glob",
    label: "筛选 Final_ 文件",
    prompt: "请只列出文件名以 Final_ 开头的案例文件。",
  },
  {
    id: "grep",
    label: "搜索 夏仲奇",
    prompt: "请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。",
  },
];

function nextMessageID() {
  return crypto.randomUUID();
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold tracking-tight text-stone-950">
        {title}
      </h2>
      <p className="text-sm leading-6 text-stone-600">{description}</p>
    </div>
  );
}

function formatActivityTitle(title: string) {
  return title === "Tool started" ? "工具开始" : title;
}

export function App() {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [apiBaseURL, setAPIBaseURL] = useState(DEFAULT_BASE_URL);
  const [apiKey, setAPIKey] = useState(DEFAULT_API_KEY);
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<PublicAPIResponseEnvelope | null>(
    null,
  );
  const [previousResponseID, setPreviousResponseID] = useState("");
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] =
    useState<PublicAPIReasoningEffort>("medium");
  const [runState, setRunState] = useState<"ready" | "streaming" | "failed" | "waiting">(
    "ready",
  );

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      block: "end",
    });
  }, [messages]);

  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages],
  );

  function replaceMessage(
    messageID: string,
    updater: (message: DemoMessage) => DemoMessage,
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageID ? updater(message) : message,
      ),
    );
  }

  function resetSession() {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setLastResponse(null);
    setPreviousResponseID("");
    setRunState("ready");
  }

  async function handleSend(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    const trimmedKey = apiKey.trim();
    const trimmedAgent = agentName.trim();

    if (!trimmedKey) {
      toast.error("请先填入用户 Key。");
      return;
    }
    if (!trimmedAgent) {
      toast.error("请先指定已发布 Agent。");
      return;
    }
    if (!prompt) {
      toast.error("请先输入问题。");
      return;
    }

    const userMessageID = nextMessageID();
    const assistantMessageID = nextMessageID();
    const controller = new AbortController();
    abortRef.current = controller;

    setDraft("");
    setRunState("streaming");
    setMessages((current) => [
      ...current,
      {
        id: userMessageID,
        role: "user",
        content: prompt,
        status: "done",
      },
      {
        id: assistantMessageID,
        role: "assistant",
        content: "",
        status: "streaming",
        activity: [],
        toolCallCount: 0,
        reasoningSummary: "",
      },
    ]);

    try {
      const client = createBrowserPublicAPIClient({
        apiToken: trimmedKey,
        baseURL: apiBaseURL,
      });

      let terminalResponseID = "";
      let runModel = createPublicAPIRunReadModel();
      const traceText = {
        assistantMessage: "助手回复",
        toolCall: "工具开始",
        toolResult: "工具结束",
        runCompleted: "运行完成",
      };

      const stream = await client.responses.create(
        {
          model: trimmedAgent,
          input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
          previous_response_id: previousResponseID || undefined,
          metadata: {
            source: "frontend_demo_support",
            surface: "standalone_demo",
          },
          reasoning: buildPublicAPIReasoningRequest(
            reasoningEnabled,
            reasoningEffort,
          ),
          stream: true,
        },
        {
          signal: controller.signal,
        },
      );

      for await (const rawEvent of stream) {
        for (const normalizedEvent of normalizeSDKResponseEvent(rawEvent)) {
          runModel = applyNormalizedPublicAPIRunEvent({
            current: runModel,
            event: normalizedEvent,
            traceText,
          });
          terminalResponseID = runModel.responseId || terminalResponseID;

          replaceMessage(assistantMessageID, (message) => ({
            ...message,
            content: runModel.liveOutput || message.content,
            activity: runModel.traceItems.map((item) => ({
              title: item.title,
              detail: item.detail,
              timestamp: item.timestamp,
            })),
            toolCallCount: runModel.toolCallCount,
            responseId: runModel.responseId || message.responseId,
            status: runModel.phase === "failed" ? "error" : message.status,
          }));

          if (runModel.phase === "failed") {
            setRunState("failed");
          }
        }
      }

      if (!terminalResponseID) {
        setRunState("ready");
        replaceMessage(assistantMessageID, (message) => ({
          ...message,
          status: "done",
        }));
        return;
      }

      const finalizedResponse = coercePublicAPIResponse(
        await client.responses.retrieve(terminalResponseID, undefined, {
          signal: controller.signal,
        }),
      );
      if (!finalizedResponse) {
        throw new Error("响应内容无效。");
      }

      setLastResponse(finalizedResponse);
      setPreviousResponseID(finalizedResponse.id);
      runModel = applyPublicAPIResponseEnvelope({
        current: runModel,
        response: finalizedResponse,
        traceText,
      });

      replaceMessage(assistantMessageID, (message) => ({
        ...message,
        content:
          finalizedResponse.output_text?.trim() ||
          runModel.liveOutput ||
          message.content,
        status:
          finalizedResponse.status === "completed"
            ? "done"
            : finalizedResponse.status === "incomplete"
              ? "done"
              : "error",
        responseId: runModel.responseId || finalizedResponse.id,
        toolCallCount: runModel.toolCallCount,
        reasoningSummary: runModel.reasoningSummary,
        activity: runModel.traceItems.map((item) => ({
          title: item.title,
          detail: item.detail,
          timestamp: item.timestamp,
        })),
      }));

      if (finalizedResponse.status === "incomplete") {
        setRunState("waiting");
        toast.message("响应正在等待用户输入。");
        return;
      }

      setRunState("ready");
      toast.success("运行完成");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setRunState("ready");
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      setRunState("failed");
      toast.error(detail);
      replaceMessage(assistantMessageID, (message) => ({
        ...message,
        status: "error",
        content: message.content || `请求失败：${detail}`,
      }));
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <div className="min-h-screen px-5 py-5 text-stone-900 lg:px-8">
      <div className="mx-auto grid max-w-[1480px] gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border border-stone-300/80 bg-stone-100/85 p-5 backdrop-blur-sm">
          <div className="space-y-8">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-stone-900">
                <div className="flex size-10 items-center justify-center border border-stone-900 bg-stone-900 text-stone-50">
                  <ServerCogIcon className="size-5" />
                </div>
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-stone-500">
                    Standalone Demo
                  </p>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    客服接入验收台
                  </h1>
                </div>
              </div>
              <p className="text-sm leading-6 text-stone-600">
                这是一个独立于主应用的外部接入示例。它直接走官方 OpenAI
                JavaScript SDK，对接 Deer Flow 已发布 Agent 的 `/v1/responses`
                契约。
              </p>
            </div>

            <section className="space-y-3">
              <SectionTitle
                title="连接配置"
                description="默认会预填本地 current-code 测试地址和用户 Key，你也可以手动改。"
              />
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-800">
                  Base URL
                </span>
                <input
                  value={apiBaseURL}
                  onChange={(event) => setAPIBaseURL(event.target.value)}
                  className="w-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-800">
                  用户 Key
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setAPIKey(event.target.value)}
                  className="w-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-800">
                  Agent
                </span>
                <input
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  className="w-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
              </label>
              {(STDIO_AGENT_NAME || HTTP_AGENT_NAME) && (
                <div className="flex flex-wrap gap-2">
                  {STDIO_AGENT_NAME ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAgentName(STDIO_AGENT_NAME);
                        if (DEFAULT_STDIO_API_KEY) {
                          setAPIKey(DEFAULT_STDIO_API_KEY);
                        }
                      }}
                      className="border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 transition-colors hover:bg-stone-200"
                    >
                      切到 stdio Agent
                    </button>
                  ) : null}
                  {HTTP_AGENT_NAME ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAgentName(HTTP_AGENT_NAME);
                        if (DEFAULT_HTTP_API_KEY) {
                          setAPIKey(DEFAULT_HTTP_API_KEY);
                        }
                      }}
                      className="border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 transition-colors hover:bg-stone-200"
                    >
                      切到 HTTP Agent
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            <section className="space-y-3 border-t border-stone-300 pt-6">
              <SectionTitle
                title="运行偏好"
                description="开启后，会在最终响应里显示 Deer Flow 公开暴露的 reasoning summary。"
              />
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-stone-800">
                  开启思考
                </span>
                <input
                  type="checkbox"
                  checked={reasoningEnabled}
                  onChange={(event) =>
                    setReasoningEnabled(event.target.checked)
                  }
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-800">
                  思考强度
                </span>
                <select
                  value={reasoningEffort}
                  disabled={!reasoningEnabled}
                  onChange={(event) =>
                    setReasoningEffort(
                      event.target.value as PublicAPIReasoningEffort,
                    )
                  }
                  className="w-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:cursor-not-allowed disabled:bg-stone-100"
                >
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            </section>

            <section className="space-y-3 border-t border-stone-300 pt-6">
              <SectionTitle
                title="验收问题"
                description="这些问题覆盖列文件、分页读、glob 和 grep 四类 MCP 能力。"
              />
              <div className="space-y-2">
                {PROMPTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDraft(item.prompt)}
                    className="w-full border border-stone-300 bg-white px-3 py-3 text-left transition-colors hover:bg-stone-200"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-stone-900">
                        {item.label}
                      </span>
                      <SearchIcon className="size-4 text-stone-500" />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </aside>

        <main className="border border-stone-300/80 bg-stone-50/90">
          <div className="grid min-h-[calc(100vh-40px)] lg:grid-rows-[auto_minmax(0,1fr)_220px]">
            <header className="border-b border-stone-300 px-5 py-4 lg:px-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-stone-500">
                    Published Support Agent
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-stone-950">
                    {agentName || "未指定 Agent"}
                  </h2>
                </div>
                <div className="flex items-center gap-3 text-sm text-stone-600">
                  <span>响应链：{previousResponseID || "新会话"}</span>
                  <span>
                    状态：
                    {runState === "streaming"
                      ? "流式输出中"
                      : runState === "failed"
                        ? "失败"
                        : runState === "waiting"
                          ? "等待用户输入"
                          : "就绪"}
                  </span>
                </div>
              </div>
            </header>

            <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-h-0 border-b border-stone-300 lg:border-r lg:border-b-0">
                <div className="h-full overflow-y-auto px-5 py-5 lg:px-6">
                  {messages.length === 0 ? (
                    <div className="flex h-full min-h-[420px] items-center justify-center">
                      <div className="max-w-lg">
                        <p className="text-2xl font-semibold tracking-tight text-stone-950">
                          这里会真实显示客服对话和 MCP 步骤。
                        </p>
                        <p className="mt-3 text-sm leading-7 text-stone-600">
                          选一个验收问题，或者直接发问。和之前 docs 里的示例不同，
                          这里会在流式过程中持续显示工具步骤，而不是等答案结束后才补出来。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {messages.map((message) => (
                        <article
                          key={message.id}
                          className={
                            message.role === "user"
                              ? "ml-auto max-w-[780px] border border-stone-900 bg-stone-900 px-4 py-4 text-stone-50"
                              : message.status === "error"
                                ? "max-w-[780px] border border-rose-200 bg-rose-50 px-4 py-4 text-rose-950"
                                : "max-w-[780px] border border-stone-300 bg-white px-4 py-4 text-stone-900"
                          }
                        >
                          <div className="mb-3 flex items-center justify-between gap-3 text-xs font-medium">
                            <span>{message.role === "user" ? "用户" : "助手"}</span>
                            {message.status === "streaming" ? (
                              <Loader2Icon className="size-4 animate-spin" />
                            ) : null}
                          </div>
                          {message.role === "assistant" ? (
                            <div className="space-y-4">
                              <div className="prose prose-stone max-w-none text-sm leading-7">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {message.content || "处理中..."}
                                </ReactMarkdown>
                              </div>
                              <div className="border-t border-stone-200 pt-4">
                                <div className="flex flex-wrap items-center gap-4 text-xs text-stone-500">
                                  <span>步骤</span>
                                  <span>工具调用：{message.toolCallCount ?? 0}</span>
                                  {message.responseId ? (
                                    <span className="font-mono text-[11px] text-stone-700">
                                      {message.responseId}
                                    </span>
                                  ) : null}
                                </div>
                                {message.activity?.length ? (
                                  <div className="mt-3 space-y-2">
                                    {message.activity.map((item, index) => (
                                      <div
                                        key={`${message.id}-${item.title}-${item.timestamp}-${index}`}
                                        className="border border-stone-200 bg-stone-50 px-3 py-3"
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <p className="text-sm font-medium text-stone-900">
                                            {formatActivityTitle(item.title)}
                                          </p>
                                          <span className="text-xs text-stone-500">
                                            {formatTime(item.timestamp)}
                                          </span>
                                        </div>
                                        {item.detail ? (
                                          <p className="mt-1 text-sm leading-6 text-stone-600">
                                            {item.detail}
                                          </p>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-3 text-sm leading-6 text-stone-500">
                                    运行步骤会在这里持续出现。
                                  </p>
                                )}
                              </div>
                              <div className="border-t border-stone-200 pt-4">
                                <p className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">
                                  Reasoning summary
                                </p>
                                <p className="mt-2 text-sm leading-6 whitespace-pre-wrap text-stone-700">
                                  {message.reasoningSummary ||
                                    "开启思考后，会在响应完成后显示公开可见的思考摘要。"}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm leading-7 whitespace-pre-wrap">
                              {message.content}
                            </p>
                          )}
                        </article>
                      ))}
                      <div ref={transcriptEndRef} />
                    </div>
                  )}
                </div>
              </div>

              <aside className="border-t border-stone-300 px-5 py-5 lg:border-t-0 lg:px-6">
                <div className="space-y-5">
                  <SectionTitle
                    title="最近一次运行"
                    description="这里保留最近一条助手回复的响应 ID、步骤计数和 reasoning summary。"
                  />
                  <div className="border border-stone-300 bg-white px-4 py-4">
                    <div className="space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-stone-500">Response</span>
                        <span className="max-w-[180px] break-all text-right font-medium text-stone-900">
                          {lastResponse?.id || "—"}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-stone-500">状态</span>
                        <span className="text-right font-medium text-stone-900">
                          {lastResponse?.status || "—"}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-stone-500">工具调用</span>
                        <span className="text-right font-medium text-stone-900">
                          {latestAssistant?.toolCallCount ?? 0}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="border border-stone-300 bg-white px-4 py-4">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-stone-500">
                      Reasoning summary
                    </p>
                    <p className="mt-2 text-sm leading-6 whitespace-pre-wrap text-stone-700">
                      {latestAssistant?.reasoningSummary ||
                        "运行完成后，这里会显示最近一次公开 reasoning summary。"}
                    </p>
                  </div>
                </div>
              </aside>
            </div>

            <footer className="border-t border-stone-300 px-5 py-5 lg:px-6">
              <label className="block text-sm font-medium text-stone-800">
                输入问题
              </label>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="直接问已发布的客服 Agent，或使用左侧预置问题。"
                className="mt-2 min-h-[120px] w-full border border-stone-300 bg-white px-3 py-3 text-sm leading-7 text-stone-900"
              />
              <div className="mt-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-sm text-stone-500">
                  <NetworkIcon className="size-4" />
                  <span>Official OpenAI JS SDK {"->"} Deer Flow /v1/responses</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetSession}
                    className="border border-stone-300 bg-white px-4 py-2 text-sm text-stone-800 transition-colors hover:bg-stone-200"
                  >
                    重置会话
                  </button>
                  {runState === "streaming" ? (
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      className="border border-stone-300 bg-white px-4 py-2 text-sm text-stone-800 transition-colors hover:bg-stone-200"
                    >
                      停止
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={runState === "streaming"}
                    className="inline-flex items-center gap-2 border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    {runState === "streaming" ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <TerminalSquareIcon className="size-4" />
                    )}
                    {runState === "streaming" ? "执行中" : "发送"}
                  </button>
                </div>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
