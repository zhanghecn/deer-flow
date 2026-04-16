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
  type PublicAPIRunEvent,
  type PublicAPIResponseEnvelope,
} from "@/core/public-api/api";
import {
  buildTraceFromRunEvent,
  type PlaygroundTraceItem,
} from "@/core/public-api/events";
import {
  coercePublicAPIResponse,
  createBrowserPublicAPIClient,
  normalizeSDKResponseEvent,
} from "@/core/public-api/sdk-compat";
import { workspaceMessageRehypePlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

import { getSupportSDKChatDemoText } from "./support-sdk-chat-demo.i18n";

type DemoMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  responseId?: string;
  activity?: PlaygroundTraceItem[];
  toolCallCount?: number;
};

function nextMessageID() {
  return crypto.randomUUID();
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function truncate(value: string, limit = 18) {
  if (!value) {
    return "—";
  }
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function countToolCalls(events: PublicAPIRunEvent[]) {
  return events.filter((event) => event.type === "tool_started").length;
}

function buildActivity(
  events: PublicAPIRunEvent[],
  labels: {
    assistantMessage: string;
    toolCall: string;
    toolResult: string;
    runCompleted: string;
  },
) {
  return events
    .filter((event) => event.type !== "assistant_delta")
    .map((event) =>
      buildTraceFromRunEvent(event, labels),
    );
}

export function SupportSDKChatDemo({
  agentName,
  defaultBaseURL,
}: {
  agentName: string;
  defaultBaseURL: string;
}) {
  const { locale } = useI18n();
  const text = getSupportSDKChatDemoText(locale);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [apiBaseURL, setAPIBaseURL] = useState(defaultBaseURL);
  const [apiToken, setAPIToken] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<PublicAPIResponseEnvelope | null>(
    null,
  );
  const [previousResponseID, setPreviousResponseID] = useState("");
  const [runState, setRunState] = useState<"ready" | "streaming" | "failed" | "waiting">(
    "ready",
  );

  useEffect(() => {
    setAPIBaseURL(defaultBaseURL);
  }, [defaultBaseURL]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      block: "end",
    });
  }, [messages]);

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
      },
    ]);

    try {
      const client = createBrowserPublicAPIClient({
        apiToken: trimmedToken,
        baseURL: apiBaseURL,
      });

      let terminalResponseID = "";

      const stream = await client.responses.create(
        {
          model: agentName,
          input: prompt,
          previous_response_id: previousResponseID || undefined,
          metadata: {
            source: "docs_support_sdk_demo",
            surface: "support_demo",
          },
          stream: true,
        },
        {
          signal: controller.signal,
        },
      );

      // The SDK yields parsed SSE payloads, but Deer Flow still emits
      // `response.run_event` as the canonical live signal. Adapt those events
      // into the same normalized vocabulary the internal playground uses.
      for await (const rawEvent of stream) {
        for (const normalizedEvent of normalizeSDKResponseEvent(rawEvent)) {
          if (normalizedEvent.kind === "assistant_delta") {
            replaceMessage(assistantMessageID, (message) => ({
              ...message,
              content: `${message.content}${normalizedEvent.delta}`,
            }));
            continue;
          }

          if (normalizedEvent.kind === "run_started") {
            terminalResponseID = normalizedEvent.responseId || terminalResponseID;
            continue;
          }

          if (normalizedEvent.kind === "run_completed") {
            terminalResponseID = normalizedEvent.responseId || terminalResponseID;
            continue;
          }

          if (normalizedEvent.kind === "ledger_event") {
            if (normalizedEvent.event.type === "assistant_message") {
              replaceMessage(assistantMessageID, (message) => ({
                ...message,
                content:
                  asString(
                    (
                      normalizedEvent.event as PublicAPIRunEvent & {
                        text?: unknown;
                      }
                    ).text,
                  ) || message.content,
              }));
            }
            continue;
          }

          if (normalizedEvent.kind === "run_failed") {
            setRunState("failed");
            replaceMessage(assistantMessageID, (message) => ({
              ...message,
              content:
                message.content ||
                `${text.requestFailed}: ${normalizedEvent.detail}`,
              status: "error",
            }));
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
        await client.responses.retrieve(
          terminalResponseID,
          undefined,
          {
            signal: controller.signal,
          },
        ),
      );
      if (!finalizedResponse) {
        throw new Error("Retrieved response payload is invalid.");
      }

      setLastResponse(finalizedResponse);
      setPreviousResponseID(finalizedResponse.id);

      const finalText = finalizedResponse.output_text?.trim();
      replaceMessage(assistantMessageID, (message) => ({
        ...message,
        content: finalText || message.content || text.responseWaiting,
        status:
          finalizedResponse.status === "completed" ? "done" : "error",
      }));

      const runEvents = finalizedResponse.openagents?.run_events ?? [];
      const activity = buildActivity(runEvents, {
        assistantMessage: text.assistantReplyTitle,
        toolCall: text.toolStartedTitle,
        toolResult: text.toolFinishedTitle,
        runCompleted: text.runCompleted,
      });
      const toolCallCount = countToolCalls(runEvents);
      replaceMessage(assistantMessageID, (message) => ({
        ...message,
        responseId: finalizedResponse.id,
        activity,
        toolCallCount,
      }));

      if (finalizedResponse.status === "incomplete") {
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
            stage: "error",
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
                    {truncate(lastResponse?.id ?? "")}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-stone-500">
                    {text.previousResponseIdLabel}
                  </dt>
                  <dd className="font-mono text-[12px] text-stone-900">
                    {truncate(previousResponseID)}
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
                              {message.responseId ? (
                                <span>
                                  {text.responseMetaLabel}:{" "}
                                  <span className="font-mono text-[11px] text-stone-700">
                                    {truncate(message.responseId, 28)}
                                  </span>
                                </span>
                              ) : null}
                              <span>
                                {text.toolCallsMetaLabel}: {message.toolCallCount ?? 0}
                              </span>
                            </div>
                            {message.activity && message.activity.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                {message.activity.map((item, index) => (
                                  <div
                                    key={`${message.id}-${item.title}-${item.timestamp}-${index}`}
                                    className="border border-stone-200 bg-white px-3 py-2"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <p className="text-sm font-medium text-stone-900">
                                        {item.title}
                                      </p>
                                      <span className="text-xs text-stone-500">
                                        {new Intl.DateTimeFormat(locale, {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          second: "2-digit",
                                        }).format(item.timestamp)}
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
                              <p className="mt-2 text-sm leading-6 text-stone-500">
                                {text.stepsEmpty}
                              </p>
                            )}
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
                  {latestActivity.length === 0 ? (
                    <p className="text-sm leading-6 text-stone-500">
                      {text.activityEmpty}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {latestActivity.map((item, index) => (
                        <div
                          key={`${item.title}-${item.timestamp}-${index}`}
                          className="border border-stone-200 px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium text-stone-900">
                              {item.title}
                            </p>
                            <span className="text-xs text-stone-500">
                              {new Intl.DateTimeFormat(locale, {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              }).format(item.timestamp)}
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
                  )}
                </ScrollArea>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
