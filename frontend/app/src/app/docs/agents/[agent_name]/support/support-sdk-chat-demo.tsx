import {
  Loader2Icon,
  RotateCcwIcon,
  SquareIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import { useI18n } from "@/core/i18n/hooks";
import {
  type PublicAPIReasoningEffort,
  type PublicAPITurnEvent,
  type PublicAPITurnSnapshot,
} from "@/core/public-api/api";
import { createPublicAPISession } from "@/core/public-api/session";
import { workspaceMessageRehypePlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

import { getSupportHTTPChatDemoText } from "./support-sdk-chat-demo.i18n";

type DemoActivityItem = {
  title: string;
  detail?: string;
  timestamp: number;
  tone: "system" | "tool" | "error";
};

type DemoMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  turnId?: string;
  activity?: DemoActivityItem[];
  toolCallCount?: number;
  reasoningText?: string;
};

function nextMessageID() {
  return crypto.randomUUID();
}

function truncate(value: string, limit = 18) {
  if (!value) {
    return "—";
  }
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function formatTimestamp(locale: string, timestamp: number) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function formatActivityTitle(
  title: string,
  text: ReturnType<typeof getSupportHTTPChatDemoText>,
) {
  if (title === "tool.call.started") {
    return text.toolStartedTitle;
  }
  if (title === "tool.call.completed") {
    return text.toolFinishedTitle;
  }
  return title;
}

function getTimelineAccent(item: DemoActivityItem) {
  switch (item.tone) {
    case "tool":
      return "border-amber-300 bg-amber-50/80";
    case "error":
      return "border-rose-300 bg-rose-50";
    default:
      return "border-stone-300 bg-stone-50";
  }
}

function formatToolDetail(params: {
  label: string;
  jsonLabel: string;
  toolName: string;
  payload: unknown;
}) {
  return [
    `**${params.label}**：\`${params.toolName}\``,
    params.payload === undefined
      ? ""
      : `**${params.jsonLabel}**\n\n\`\`\`json\n${JSON.stringify(params.payload, null, 2)}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildActivityItem(
  event: PublicAPITurnEvent,
  text: ReturnType<typeof getSupportHTTPChatDemoText>,
): DemoActivityItem | null {
  const timestamp = event.created_at * 1000;
  switch (event.type) {
    case "turn.started":
      return {
        title: text.turnStartedTitle,
        timestamp,
        tone: "system",
        detail: event.turn_id,
      };
    case "tool.call.started":
      return {
        title: "tool.call.started",
        timestamp,
        tone: "tool",
        detail: formatToolDetail({
          label: text.toolMethodLabel,
          jsonLabel: text.toolArgumentsLabel,
          toolName: event.tool_name ?? "tool",
          payload: event.tool_arguments,
        }),
      };
    case "tool.call.completed":
      return {
        title: "tool.call.completed",
        timestamp,
        tone: "tool",
        detail: formatToolDetail({
          label: text.toolMethodLabel,
          jsonLabel: text.toolOutputLabel,
          toolName: event.tool_name ?? "tool",
          payload: event.tool_output,
        }),
      };
    case "turn.requires_input":
      return {
        title: text.responseWaiting,
        timestamp,
        tone: "system",
        detail: event.text,
      };
    case "turn.failed":
      return {
        title: text.turnFailedTitle,
        timestamp,
        tone: "error",
        detail: event.error,
      };
    default:
      return null;
  }
}

function TimelineItems({
  items,
  locale,
  text,
  empty,
  className,
}: {
  items: DemoActivityItem[];
  locale: string;
  text: ReturnType<typeof getSupportHTTPChatDemoText>;
  empty: string;
  className?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm leading-6 text-stone-500">{empty}</p>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item, index) => (
        <div
          key={`${item.title}-${item.timestamp}-${index}`}
          className={cn("rounded-md border px-3 py-3", getTimelineAccent(item))}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-stone-900">
              {formatActivityTitle(item.title, text)}
            </p>
            <span className="text-xs text-stone-500">
              {formatTimestamp(locale, item.timestamp)}
            </span>
          </div>
          {item.detail ? (
            <div className="mt-2 rounded-sm bg-white/70 px-3 py-2">
              <MarkdownContent
                content={item.detail}
                isLoading={false}
                rehypePlugins={workspaceMessageRehypePlugins}
                className="text-sm leading-6 text-stone-700"
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function SupportHTTPChatDemo({
  agentName,
  defaultBaseURL,
}: {
  agentName: string;
  defaultBaseURL: string;
}) {
  const { locale } = useI18n();
  const text = getSupportHTTPChatDemoText(locale);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ReturnType<typeof createPublicAPISession> | null>(
    null,
  );
  const sessionConfigKeyRef = useRef("");

  const [apiBaseURL, setAPIBaseURL] = useState(defaultBaseURL);
  const [apiToken, setAPIToken] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [lastTurn, setLastTurn] = useState<PublicAPITurnSnapshot | null>(
    null,
  );
  const [previousTurnID, setPreviousTurnID] = useState("");
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] =
    useState<PublicAPIReasoningEffort>("medium");
  const [runState, setRunState] = useState<"ready" | "streaming" | "failed" | "waiting">(
    "ready",
  );

  const traceText = {
    assistantMessage: text.assistantReplyTitle,
    assistantThinking: text.reasoningSummaryLabel,
    toolCall: text.toolStartedTitle,
    toolResult: text.toolFinishedTitle,
    turnCompleted: text.runCompleted,
    turnStarted: text.turnStartedTitle,
    turnWaiting: text.responseWaiting,
    turnFailed: text.turnFailedTitle,
  };

  useEffect(() => {
    setAPIBaseURL(defaultBaseURL);
  }, [defaultBaseURL]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      block: "end",
    });
  }, [messages]);

  function ensureSession() {
    const configKey = [apiBaseURL.trim(), apiToken.trim(), agentName.trim()].join("\n");
    if (!sessionRef.current || sessionConfigKeyRef.current !== configKey) {
      sessionRef.current = createPublicAPISession({
        baseURL: apiBaseURL,
        apiToken: apiToken.trim(),
        agent: agentName.trim(),
        traceText,
      });
      sessionConfigKeyRef.current = configKey;
    }
    return sessionRef.current;
  }

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
    sessionRef.current?.reset();
    setMessages([]);
    setLastTurn(null);
    setPreviousTurnID("");
    setRunState("ready");
  }

  async function handleSend(promptOverride?: string) {
    const prompt = (promptOverride ?? draft).trim();
    const trimmedToken = apiToken.trim();

    if (!trimmedToken) {
      toast.error(text.missingToken);
      return;
    }
    if (!prompt) {
      toast.error(text.missingPrompt);
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
        reasoningText: "",
      },
    ]);

    try {
      const session = ensureSession();
      const result = await session.prompt({
        text: prompt,
        signal: controller.signal,
        metadata: {
          source: "docs_support_http_demo",
          surface: "support_demo",
        },
        thinking: {
          enabled: reasoningEnabled,
          effort: reasoningEffort,
        },
        onUpdate: ({ event, readModel }) => {
          const nextActivity =
            event.kind === "ledger_event"
              ? buildActivityItem(event.event, text)
              : null;

          replaceMessage(assistantMessageID, (message) => ({
            ...message,
            content: readModel.liveOutput || message.content,
            activity: nextActivity
              ? [...(message.activity ?? []), nextActivity]
              : message.activity,
            toolCallCount: readModel.toolCallCount,
            turnId: readModel.turnId || message.turnId,
            reasoningText: readModel.liveReasoning || message.reasoningText,
            status: readModel.phase === "failed" ? "error" : message.status,
          }));

          if (readModel.phase === "failed") {
            setRunState("failed");
          } else if (readModel.phase === "waiting") {
            setRunState("waiting");
          }
        },
      });

      if (!result.turn) {
        setRunState("ready");
        replaceMessage(assistantMessageID, (message) => ({
          ...message,
          status: "done",
        }));
        return;
      }

      const finalizedTurn = result.turn;
      setLastTurn(finalizedTurn);
      setPreviousTurnID(session.getPreviousTurnId());
      replaceMessage(assistantMessageID, (message) => ({
        ...message,
        content:
          finalizedTurn.output_text?.trim() || message.content || text.responseWaiting,
        status:
          finalizedTurn.status === "completed" ||
          finalizedTurn.status === "requires_input"
            ? "done"
            : "error",
        turnId: finalizedTurn.id,
        toolCallCount: finalizedTurn.events.filter(
          (turnEvent) => turnEvent.type === "tool.call.started",
        ).length,
        reasoningText:
          result.readModel.liveReasoning || finalizedTurn.reasoning_text,
      }));

      if (finalizedTurn.status === "requires_input") {
        setRunState("waiting");
        toast.message(text.responseWaiting);
        return;
      }

      setRunState("ready");
      toast.success(text.runCompleted);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setRunState("ready");
        replaceMessage(assistantMessageID, (message) => ({
          ...message,
          status: message.content ? "done" : "error",
          content: message.content || text.requestFailed,
        }));
        return;
      }

      const detail = error instanceof Error ? error.message : String(error);
      setRunState("failed");
      replaceMessage(assistantMessageID, (message) => ({
        ...message,
        content: `${text.requestFailed}: ${detail}`,
        status: "error",
        activity: [
          {
            tone: "error",
            title: text.requestFailed,
            detail,
            timestamp: Date.now(),
          },
        ],
      }));
      toast.error(detail);
    } finally {
      abortRef.current = null;
    }
  }

  // Keep the latest run summary in the side rail while each assistant message
  // retains its own per-turn step history inside the transcript.
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const latestActivity = latestAssistantMessage?.activity ?? [];
  const latestReasoningText = latestAssistantMessage?.reasoningText ?? "";

  return (
    <section
      id="console"
      className="overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-stone-200 bg-stone-50/70 p-5 lg:border-r lg:border-b-0">
          <div className="space-y-6">
            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-stone-950">
                  {text.connectionTitle}
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {text.connectionDescription}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-800">
                  {text.baseURLLabel}
                </label>
                <Input
                  value={apiBaseURL}
                  onChange={(event) => setAPIBaseURL(event.target.value)}
                  placeholder={text.baseURLPlaceholder}
                  className="border-stone-300 bg-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-800">
                  {text.apiKeyLabel}
                </label>
                <Input
                  type="password"
                  value={apiToken}
                  onChange={(event) => setAPIToken(event.target.value)}
                  placeholder={text.apiKeyPlaceholder}
                  className="border-stone-300 bg-white"
                />
                <p className="text-xs leading-5 text-stone-500">
                  {text.apiKeyHint}
                </p>
              </div>
            </section>

            <section className="space-y-3 border-t border-stone-200 pt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-stone-950">
                  {text.sessionTitle}
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-stone-300 bg-white text-stone-700"
                  onClick={resetSession}
                >
                  <RotateCcwIcon className="size-4" />
                  {text.newSession}
                </Button>
              </div>

              <dl className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-stone-500">{text.agentLabel}</dt>
                  <dd className="max-w-[180px] text-right font-medium break-all text-stone-900">
                    {agentName}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-stone-500">{text.responseIdLabel}</dt>
                  <dd className="font-mono text-[12px] text-stone-900">
                    {truncate(lastTurn?.id ?? "")}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-stone-500">
                    {text.previousResponseIdLabel}
                  </dt>
                  <dd className="font-mono text-[12px] text-stone-900">
                    {truncate(previousTurnID)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-stone-500">{text.statusLabel}</dt>
                  <dd className="font-medium text-stone-900">
                    {runState === "streaming"
                      ? text.statusStreaming
                      : runState === "failed"
                        ? text.statusFailed
                        : runState === "waiting"
                          ? text.statusWaiting
                          : text.statusReady}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-stone-500">{text.toolsLabel}</dt>
                  <dd className="font-medium text-stone-900">
                    {latestAssistantMessage?.toolCallCount ?? 0}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="space-y-3 border-t border-stone-200 pt-5">
              <div>
                <h2 className="text-base font-semibold text-stone-950">
                  {text.promptsTitle}
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {text.promptsDescription}
                </p>
              </div>

              <div className="space-y-2">
                {text.prompts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDraft(item.prompt)}
                    className="w-full border border-stone-200 bg-white px-3 py-3 text-left transition-colors hover:bg-stone-100"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-stone-900">
                        {item.label}
                      </span>
                      <span className="text-xs text-stone-500">
                        {text.usePrompt}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3 border-t border-stone-200 pt-5">
              <div>
                <h2 className="text-base font-semibold text-stone-950">
                  {text.reasoningLabel}
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {text.reasoningHint}
                </p>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm font-medium text-stone-800">
                <span>{text.reasoningLabel}</span>
                <input
                  type="checkbox"
                  checked={reasoningEnabled}
                  onChange={(event) =>
                    setReasoningEnabled(event.target.checked)
                  }
                />
              </label>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-800">
                  {text.reasoningEffortLabel}
                </label>
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
              </div>
            </section>

            <section className="space-y-2 border-t border-stone-200 pt-5">
              <h2 className="text-base font-semibold text-stone-950">
                {text.securityTitle}
              </h2>
              <p className="text-sm leading-6 text-stone-600">
                {text.securityDescription}
              </p>
            </section>
          </div>
        </aside>

        <div className="flex min-h-[760px] flex-col">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-stone-950">
                {text.chatTitle}
              </h2>
              <p className="mt-1 text-sm text-stone-500">{text.sdkLabel}</p>
            </div>
            <div className="text-sm font-medium text-stone-700">
              {runState === "streaming"
                ? text.statusStreaming
                : runState === "failed"
                  ? text.statusFailed
                  : runState === "waiting"
                    ? text.statusWaiting
                    : text.statusReady}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 lg:grid-rows-[minmax(0,1fr)_250px]">
            <ScrollArea className="min-h-0 border-b border-stone-200">
              <div className="space-y-4 px-5 py-5">
                {messages.length === 0 ? (
                  <div className="flex min-h-[360px] items-center justify-center">
                    <div className="max-w-md text-center">
                      <p className="text-base font-semibold text-stone-950">
                        {text.chatEmptyTitle}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-stone-600">
                        {text.chatEmptyDescription}
                      </p>
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[760px] border px-4 py-3",
                        message.role === "user"
                          ? "ml-auto border-stone-900 bg-stone-900 text-white"
                          : message.status === "error"
                            ? "border-rose-200 bg-rose-50 text-rose-950"
                            : "border-stone-200 bg-stone-50 text-stone-900",
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium">
                          {message.role === "user"
                            ? text.userLabel
                            : text.assistantLabel}
                        </span>
                        {message.status === "streaming" ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : null}
                      </div>
                      {message.role === "assistant" ? (
                        <>
                          <MarkdownContent
                            content={message.content}
                            isLoading={message.status === "streaming"}
                            rehypePlugins={workspaceMessageRehypePlugins}
                            className="text-sm leading-7"
                          />
                          <div className="mt-4 border-t border-stone-200 pt-3">
                            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                              <span>{text.stepsTitle}</span>
                              {message.turnId ? (
                                <span>
                                  {text.responseMetaLabel}:{" "}
                                  <span className="font-mono text-[11px] text-stone-700">
                                    {truncate(message.turnId, 28)}
                                  </span>
                                </span>
                              ) : null}
                              <span>
                                {text.toolCallsMetaLabel}: {message.toolCallCount ?? 0}
                              </span>
                            </div>
                            <div className="mt-3">
                              <TimelineItems
                                items={message.activity ?? []}
                                locale={locale}
                                text={text}
                                empty={text.stepsEmpty}
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm leading-7 whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </ScrollArea>

            <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="border-b border-stone-200 p-5 lg:border-r lg:border-b-0">
                <label className="text-sm font-medium text-stone-800">
                  {text.composerLabel}
                </label>
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={text.composerPlaceholder}
                  className="mt-2 min-h-[140px] border-stone-300 bg-white"
                />
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-stone-500">{text.sdkLabel}</p>
                  <div className="flex items-center gap-2">
                    {runState === "streaming" ? (
                      <Button
                        variant="outline"
                        className="border-stone-300 bg-white text-stone-700"
                        onClick={() => abortRef.current?.abort()}
                      >
                        <SquareIcon className="size-4" />
                        {text.stop}
                      </Button>
                    ) : null}
                    <Button
                      className="bg-stone-900 text-white hover:bg-stone-800"
                      onClick={() => void handleSend()}
                      disabled={runState === "streaming"}
                    >
                      {runState === "streaming" ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <TerminalSquareIcon className="size-4" />
                      )}
                      {runState === "streaming" ? text.sending : text.send}
                    </Button>
                  </div>
                </div>
              </div>

              <div id="activity" className="min-h-0 p-5">
                <h2 className="text-sm font-semibold text-stone-950">
                  {text.activityTitle}
                </h2>
                <ScrollArea className="mt-3 h-[176px]">
                  <TimelineItems
                    items={latestActivity}
                    locale={locale}
                    text={text}
                    empty={text.activityEmpty}
                    className="space-y-2"
                  />
                </ScrollArea>
                <div className="mt-4 border-t border-stone-200 pt-4">
                  <h3 className="text-sm font-medium text-stone-950">
                    {text.reasoningSummaryLabel}
                  </h3>
                  <div className="mt-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
                    <MarkdownContent
                      content={latestReasoningText || text.reasoningSummaryEmpty}
                      isLoading={runState === "streaming"}
                      rehypePlugins={workspaceMessageRehypePlugins}
                      className="text-sm leading-6 text-stone-600"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
