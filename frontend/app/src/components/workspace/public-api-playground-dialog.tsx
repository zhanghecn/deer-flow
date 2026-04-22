import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  PaperclipIcon,
  PlayIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import { useI18n } from "@/core/i18n/hooks";
import {
  createPublicAPITurn,
  downloadPublicAPIArtifact,
  getPublicAPITurn,
  resolvePublicAPIBaseURL,
  streamPublicAPITurn,
  uploadPublicAPIFile,
  type PublicAPIFileObject,
  type PublicAPITurnArtifact,
  type PublicAPITurnRequestBody,
  type PublicAPITurnSnapshot,
  type PublicAPITurnStreamEvent,
} from "@/core/public-api/api";
import {
  buildTraceFromRunEvent,
  normalizePublicAPIStreamEvent,
  prettyJSON,
  traceToneClass,
  traceToneDotClass,
  type PlaygroundTraceFilter as TraceFilter,
  type PlaygroundTraceItem,
  type PlaygroundTraceStage as TraceStage,
  type PlaygroundTraceText,
} from "@/core/public-api/events";
import {
  extractPublicAPIReasoningSummary,
  formatPublicAPIOutputText,
  mergeStreamingText,
} from "@/core/public-api/run-session";
import { workspaceMessageRehypePlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

import { getPublicAPIPlaygroundText } from "./public-api-playground-dialog.i18n";

type ResponseMode = "text" | "json_object" | "json_schema";
type ReasoningEffort = "low" | "medium" | "high" | "max";
type PlaygroundHeaderMode = "hero" | "compact" | "hidden";

type TraceItem = PlaygroundTraceItem & {
  id: string;
};

interface PublicAPIPlaygroundPanelProps {
  agentName: string;
  defaultBaseURL?: string | null;
  documentationURL?: string | null;
  accessMode?: "workspace" | "public";
  // Key lifecycle moved to `/workspace/keys` so the runtime console only
  // executes published contracts and does not grow a second token manager.
  apiKeysURL?: string | null;
  // The same playground panel is embedded both as a standalone workspace tool
  // and inside the public docs shell, so the header must be optional instead
  // of forcing every host page to render a second title band.
  headerMode?: PlaygroundHeaderMode;
  hideDocumentationButton?: boolean;
}

const TRACE_STAGE_ORDER: TraceStage[] = [
  "prepare",
  "upload",
  "run",
  "assistant",
  "artifact",
  "complete",
  "error",
];

let traceCounter = 0;

function nextTraceID() {
  traceCounter += 1;
  return `playground-trace-${traceCounter}`;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function formatTimestamp(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}


function PaneHeader({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow: string;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-primary text-[10px] font-semibold tracking-wider uppercase">{eyebrow}</p>
      <h2 className="text-sm font-semibold">
        {title}
      </h2>
      <p className="text-muted-foreground text-xs leading-4">
        {description}
      </p>
    </div>
  );
}

function MetaPill({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 max-w-[320px] truncate text-sm font-medium",
          mono && "font-mono text-[12px]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function FieldLabel({
  children,
  action,
  htmlFor,
}: {
  children: string;
  action?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium text-muted-foreground">
          {children}
        </label>
      ) : (
        <p className="text-sm font-medium text-muted-foreground">{children}</p>
      )}
      {action}
    </div>
  );
}

function buildTurnRequestBody(params: {
  agentName: string;
  message: string;
  uploadedFiles: PublicAPIFileObject[];
  responseMode: ResponseMode;
  schemaName: string;
  schemaBody: string;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  previousTurnID: string;
  maxOutputTokens: string;
}): PublicAPITurnRequestBody {
  const fileIDs = params.uploadedFiles.map((file) => file.id);
  const requestBody: PublicAPITurnRequestBody = {
    agent: params.agentName,
    input: {
      text: params.message.trim(),
      file_ids: fileIDs.length > 0 ? fileIDs : undefined,
    },
    metadata: {
      source: "workspace_public_api_playground",
      surface: "playground_page",
    },
  };

  if (params.previousTurnID.trim()) {
    requestBody.previous_turn_id = params.previousTurnID.trim();
  }
  if (params.reasoningEnabled) {
    requestBody.thinking = {
      enabled: true,
      effort: params.reasoningEffort,
    };
  }
  if (params.maxOutputTokens.trim()) {
    requestBody.max_output_tokens = Number(params.maxOutputTokens);
  }
  if (params.responseMode === "json_object") {
    requestBody.text = {
      format: {
        type: "json_schema",
        name: "json_object",
        schema: { type: "object" },
        strict: true,
      },
    };
  }
  if (params.responseMode === "json_schema") {
    requestBody.text = {
      format: {
        type: "json_schema",
        name: params.schemaName.trim() || "response_payload",
        schema: JSON.parse(params.schemaBody) as unknown,
        strict: true,
      },
    };
  }

  return requestBody;
}

function responseModeLabel(
  responseMode: ResponseMode,
  text: ReturnType<typeof getPublicAPIPlaygroundText>,
) {
  switch (responseMode) {
    case "json_object":
      return text.jsonObject;
    case "json_schema":
      return text.jsonSchema;
    default:
      return text.plainText;
  }
}

function traceStageLabel(
  stage: TraceStage,
  text: ReturnType<typeof getPublicAPIPlaygroundText>,
) {
  switch (stage) {
    case "prepare":
      return text.stagePrepare;
    case "upload":
      return text.stageUpload;
    case "run":
      return text.stageRun;
    case "assistant":
      return text.stageAssistant;
    case "artifact":
      return text.stageArtifact;
    case "complete":
      return text.stageComplete;
    default:
      return text.stageError;
  }
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border/70 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <p className="text-sm text-muted-foreground">
        {label}
      </p>
      <p className="max-w-[220px] text-right text-sm font-medium break-all text-foreground">
        {value}
      </p>
    </div>
  );
}

function TraceItemCard({
  item,
  locale,
  text,
}: {
  item: TraceItem;
  locale: string;
  text: ReturnType<typeof getPublicAPIPlaygroundText>;
}) {
  const rawPayload = item.raw === undefined ? "" : prettyJSON(item.raw);

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        traceToneClass(item.tone),
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1.5 size-2.5 shrink-0 rounded-full",
            traceToneDotClass(item.tone),
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {traceStageLabel(item.stage, text)}
            </span>
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatTimestamp(item.timestamp, locale)}
            </span>
          </div>
          {item.detail ? (
            <div className="mt-2 rounded-md bg-muted/20 px-3 py-3">
              <MarkdownContent
                content={item.detail}
                isLoading={false}
                rehypePlugins={workspaceMessageRehypePlugins}
                className="text-sm leading-6 break-words text-muted-foreground"
              />
            </div>
          ) : null}

          {rawPayload ? (
            <Collapsible className="mt-3">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/20"
                >
                  <ChevronDownIcon className="size-4" />
                  {text.rawPayload}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="rounded-md border border-border/70 bg-background px-3 py-3">
                  <pre className="font-mono text-xs leading-6 break-words whitespace-pre-wrap text-muted-foreground">
                    {rawPayload}
                  </pre>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PublicAPIPlaygroundPanel({
  agentName,
  defaultBaseURL,
  documentationURL,
  accessMode = "workspace",
  apiKeysURL = null,
  headerMode = "hero",
  hideDocumentationButton = false,
}: PublicAPIPlaygroundPanelProps) {
  const { locale } = useI18n();
  const text = getPublicAPIPlaygroundText(locale);
  const isWorkspaceMode = accessMode === "workspace";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stable ids keep the public playground accessible and make browser
  // verification target the same labels real users rely on.
  const baseURLInputID = useId();
  const apiTokenInputID = useId();
  const previousTurnInputID = useId();
  const messageInputID = useId();
  const fileInputID = useId();
  const maxOutputTokensInputID = useId();
  const schemaNameInputID = useId();
  const schemaBodyInputID = useId();

  const [apiBaseURL, setAPIBaseURL] = useState(
    resolvePublicAPIBaseURL(defaultBaseURL),
  );
  const [apiToken, setAPIToken] = useState("");
  const [message, setMessage] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [responseMode, setResponseMode] = useState<ResponseMode>("text");
  const [schemaName, setSchemaName] = useState("response_payload");
  const [schemaBody, setSchemaBody] = useState(
    '{\n  "type": "object",\n  "properties": {\n    "summary": { "type": "string" }\n  },\n  "required": ["summary"],\n  "additionalProperties": false\n}',
  );
  const [streamMode, setStreamMode] = useState(true);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("high");
  const [previousTurnID, setPreviousTurnID] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [traceFilter, setTraceFilter] = useState<TraceFilter>("all");
  const [submitting, setSubmitting] = useState(false);
  const [traceItems, setTraceItems] = useState<TraceItem[]>([]);
  const [turn, setTurn] = useState<PublicAPITurnSnapshot | null>(
    null,
  );
  const [liveOutput, setLiveOutput] = useState("");
  const [liveReasoning, setLiveReasoning] = useState("");
  const [lastRunMode, setLastRunMode] = useState<"stream" | "blocking" | null>(
    null,
  );

  useEffect(() => {
    setAPIBaseURL(resolvePublicAPIBaseURL(defaultBaseURL));
  }, [defaultBaseURL]);

  const filteredTraceItems = useMemo(() => {
    if (traceFilter === "all") {
      return traceItems;
    }
    return traceItems.filter((item) => item.tone === traceFilter);
  }, [traceFilter, traceItems]);

  const groupedTraceItems = useMemo(
    () =>
      TRACE_STAGE_ORDER.map((stage) => ({
        stage,
        items: filteredTraceItems.filter((item) => item.stage === stage),
      })).filter((group) => group.items.length > 0),
    [filteredTraceItems],
  );

  const formattedResponseJSON = useMemo(
    () => (turn ? prettyJSON(turn) : ""),
    [turn],
  );

  const formattedOutputText = useMemo(
    () => formatPublicAPIOutputText(turn, liveOutput),
    [liveOutput, turn],
  );
  const reasoningSummary = useMemo(
    () => extractPublicAPIReasoningSummary(turn) || liveReasoning,
    [liveReasoning, turn],
  );

  function appendTrace(
    item: Omit<TraceItem, "id" | "timestamp"> & {
      timestamp?: number;
    },
  ) {
    setTraceItems((current) => [
      ...current,
      {
        id: nextTraceID(),
        timestamp: item.timestamp ?? Date.now(),
        ...item,
      },
    ]);
  }

  async function hydrateCompletedTurn(turnId: string, apiToken: string) {
    if (!turnId) {
      return;
    }
    try {
      const payload = await getPublicAPITurn({
        baseURL: apiBaseURL,
        apiToken,
        turnId,
      });
      setTurn(payload);
      setPreviousTurnID(payload.id);
      setLiveOutput(payload.output_text);
      setLiveReasoning(payload.reasoning_text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      appendTrace({
        stage: "error",
        tone: "error",
        title: text.requestFailed,
        detail,
        raw: error,
      });
      toast.error(detail);
    }
  }

  async function handleCopy(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(text.copyFailed);
    }
  }

  function handleQueueFiles(files: FileList | null) {
    if (!files) {
      return;
    }
    const incoming = Array.from(files);
    setQueuedFiles((current) => {
      const seen = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      );
      const next = [...current];
      for (const file of incoming) {
        const signature = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        next.push(file);
      }
      return next;
    });
  }

  function handleRemoveFile(index: number) {
    setQueuedFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  async function uploadQueuedFiles(trimmedToken: string) {
    const uploadedFiles: PublicAPIFileObject[] = [];
    for (const file of queuedFiles) {
      appendTrace({
        stage: "upload",
        tone: "system",
        title: text.uploadStarted(file.name),
        detail: `${file.size} bytes`,
        raw: {
          filename: file.name,
          size: file.size,
          last_modified: file.lastModified,
        },
      });
      const uploadedFile = await uploadPublicAPIFile({
        baseURL: apiBaseURL,
        apiToken: trimmedToken,
        file,
      });
      uploadedFiles.push(uploadedFile);
      appendTrace({
        stage: "upload",
        tone: "artifact",
        title: text.uploadFinished(uploadedFile.filename, uploadedFile.id),
        raw: uploadedFile,
      });
    }
    return uploadedFiles;
  }

  function handleStreamingEvent(
    event: PublicAPITurnStreamEvent,
    trimmedToken: string,
  ) {
    const traceText: PlaygroundTraceText = {
      assistantMessage: text.assistantMessage,
      assistantThinking: text.reasoningTab,
      toolCall: text.toolCall,
      toolResult: text.toolResult,
      turnCompleted: text.runCompleted,
      turnStarted: text.turnStartedTitle,
      turnWaiting: text.turnWaitingTitle,
      turnFailed: text.turnFailedTitle,
    };

    for (const normalizedEvent of normalizePublicAPIStreamEvent(event)) {
      if (normalizedEvent.kind === "turn_started") {
        if (normalizedEvent.turnId) {
          setPreviousTurnID(normalizedEvent.turnId);
        }
        appendTrace({
          stage: "run",
          tone: "system",
          title: text.streamStarted,
          detail: normalizedEvent.turnId,
          raw: normalizedEvent.raw,
        });
        continue;
      }

      if (normalizedEvent.kind === "assistant_text_delta") {
        setLiveOutput((current) =>
          mergeStreamingText(current, normalizedEvent.delta),
        );
        continue;
      }

      if (normalizedEvent.kind === "assistant_reasoning_delta") {
        setLiveReasoning((current) =>
          mergeStreamingText(current, normalizedEvent.delta),
        );
        continue;
      }

      if (normalizedEvent.kind === "ledger_event") {
        appendTrace(buildTraceFromRunEvent(normalizedEvent.event, traceText));
        continue;
      }

      if (normalizedEvent.kind === "turn_completed") {
        void hydrateCompletedTurn(normalizedEvent.turnId, trimmedToken);
        appendTrace({
          stage: "complete",
          tone: "system",
          title: text.requestFinished(normalizedEvent.turnId),
          raw: normalizedEvent.raw,
        });
        continue;
      }

      if (normalizedEvent.kind === "turn_failed") {
        appendTrace({
          stage: "error",
          tone: "error",
          title: text.requestFailed,
          detail: normalizedEvent.detail,
          raw: normalizedEvent.raw,
        });
      }
    }
  }

  async function handleRun() {
    const trimmedToken = apiToken.trim();
    if (!trimmedToken) {
      toast.error(text.missingKey);
      return;
    }
    if (message.trim() === "" && queuedFiles.length === 0) {
      toast.error(text.missingInput);
      return;
    }

    if (responseMode === "json_schema") {
      try {
        JSON.parse(schemaBody);
      } catch {
        toast.error(text.invalidSchema);
        return;
      }
    }

    setSubmitting(true);
    setTurn(null);
    setTraceItems([]);
    setLiveOutput("");
    setLiveReasoning("");
    setLastRunMode(streamMode ? "stream" : "blocking");

    appendTrace({
      stage: "prepare",
      tone: "system",
      title: text.requestPrepared,
      detail: `${streamMode ? text.sseMode : text.blockingMode} · ${responseModeLabel(responseMode, text)}`,
      raw: {
        agent: agentName,
        response_mode: responseMode,
        stream: streamMode,
      },
    });

    try {
      const uploadedFiles = await uploadQueuedFiles(trimmedToken);
      const requestBody = buildTurnRequestBody({
        agentName,
        message,
        uploadedFiles,
        responseMode,
        schemaName,
        schemaBody,
        reasoningEnabled,
        reasoningEffort,
        previousTurnID,
        maxOutputTokens,
      });

      if (streamMode) {
        await streamPublicAPITurn({
          baseURL: apiBaseURL,
          apiToken: trimmedToken,
          body: requestBody,
          onEvent: (event) => handleStreamingEvent(event, trimmedToken),
        });
      } else {
        const payload = await createPublicAPITurn({
          baseURL: apiBaseURL,
          apiToken: trimmedToken,
          body: requestBody,
        });
        setTurn(payload);
        setPreviousTurnID(payload.id);
        setLiveOutput(payload.output_text);
        setLiveReasoning(payload.reasoning_text);

        // Blocking turns already contain the full event ledger, so the console
        // replays that ledger into the same grouped trace UI instead of
        // maintaining a second blocking-only presentation.
        const traceText: PlaygroundTraceText = {
          assistantMessage: text.assistantMessage,
          assistantThinking: text.reasoningTab,
          toolCall: text.toolCall,
          toolResult: text.toolResult,
          turnCompleted: text.runCompleted,
          turnStarted: text.turnStartedTitle,
          turnWaiting: text.turnWaitingTitle,
          turnFailed: text.turnFailedTitle,
        };
        for (const event of payload.events ?? []) {
          appendTrace(buildTraceFromRunEvent(event, traceText));
        }
        appendTrace(
          payload.status === "requires_input"
            ? {
                stage: "run",
                tone: "system" as const,
                title: text.requestIncomplete(payload.id),
                raw: payload,
              }
            : {
                stage: "complete",
                tone: "system" as const,
                title: text.requestFinished(payload.id),
                raw: payload,
              },
        );
        for (const artifact of payload.artifacts ?? []) {
          appendTrace({
            stage: "artifact",
            tone: "artifact",
            title: text.artifactReady(artifact.filename),
            raw: artifact,
          });
        }
      }

      setQueuedFiles([]);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : text.requestFailed;
      appendTrace({
        stage: "error",
        tone: "error",
        title: text.requestFailed,
        detail,
      });
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownloadArtifact(artifact: PublicAPITurnArtifact) {
    try {
      const filename = await downloadPublicAPIArtifact({
        baseURL: apiBaseURL,
        apiToken: apiToken.trim(),
        artifact,
      });
      appendTrace({
        stage: "artifact",
        tone: "artifact",
        title: `${filename} · ${text.download}`,
        raw: artifact,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.requestFailed);
    }
  }

  const traceFilterOptions: Array<{ value: TraceFilter; label: string }> = [
    { value: "all", label: text.filterAll },
    { value: "system", label: text.filterSystem },
    { value: "assistant", label: text.filterAssistant },
    { value: "tool", label: text.filterTool },
    { value: "artifact", label: text.filterArtifact },
    { value: "error", label: text.filterError },
  ];

  const currentResponseID = turn?.id ?? "—";
  const currentTraceID = asString(turn?.trace_id) || "—";
  const currentStatus =
    turn?.status ?? (submitting ? text.statusRunning : text.statusIdle);
  const currentTokenCount = turn?.usage?.total_tokens ?? "—";
  const responseArtifacts = turn?.artifacts ?? [];
  const showHeader = headerMode !== "hidden";
  const showHero = headerMode === "hero";

  return (
    <section className={cn(
      "relative overflow-hidden rounded-xl bg-background",
      isWorkspaceMode && "border border-border/70 shadow-sm",
    )}>
      {showHeader ? (
        <div className="border-b border-border/70 bg-muted/10">
          <div className="flex flex-col gap-3 px-4 py-3 lg:px-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
              >
                {text.heroEyebrow}
              </Badge>
              <Badge
                variant="secondary"
                className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
              >
                {streamMode ? text.sseMode : text.blockingMode}
              </Badge>
              {showHero && (
                <h1 className="ml-2 text-lg font-bold tracking-tight">{agentName}</h1>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill label={text.baseURL} value={apiBaseURL} mono />
              <MetaPill label={text.agentLabel} value={agentName} mono />
              <MetaPill
                label={text.activeMode}
                value={streamMode ? text.sseMode : text.blockingMode}
              />
              {documentationURL && !hideDocumentationButton ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full text-xs"
                  onClick={() => window.open(documentationURL, "_blank")}
                >
                  <WandSparklesIcon className="size-3.5" />
                  {text.openReference}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        <aside className="border-b border-border/70 bg-muted/5 px-4 py-4 lg:px-5 xl:border-r xl:border-b-0">
          <div className="flex h-full min-h-[680px] flex-col">
            <PaneHeader
              eyebrow={text.runEyebrow}
              title={text.requestTitle}
              description={text.requestDescription}
            />

            <div className="mt-4 space-y-4">
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {text.credentialsTitle}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-4">
                      {isWorkspaceMode
                        ? text.credentialsDescription
                        : text.publicCredentialsDescription}
                    </p>
                  </div>
                  {isWorkspaceMode && apiKeysURL ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 rounded-md"
                      asChild
                    >
                      <Link to={apiKeysURL}>{text.manageKeys}</Link>
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor={baseURLInputID}>
                    {text.baseURL}
                  </FieldLabel>
                  <Input
                    id={baseURLInputID}
                    aria-label={text.baseURL}
                    value={apiBaseURL}
                    onChange={(event) => setAPIBaseURL(event.target.value)}
                    className="h-10 rounded-xl"
                  />
                  <p className="text-muted-foreground text-xs leading-5">
                    {text.baseURLHint}
                  </p>
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor={apiTokenInputID}>
                    {text.userKey}
                  </FieldLabel>
                  <Input
                    id={apiTokenInputID}
                    aria-label={text.userKey}
                    value={apiToken}
                    onChange={(event) => setAPIToken(event.target.value)}
                    placeholder="df_..."
                    className="h-11 rounded-md border-border/70 bg-background font-mono"
                  />
                  <p className="text-muted-foreground text-xs leading-5">
                    {isWorkspaceMode
                      ? text.userKeyHint
                      : text.publicUserKeyHint}
                  </p>
                </div>
              </section>

              <Separator className="bg-slate-200" />

              <section className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-xl border border-border/70 bg-muted/10 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium">
                          {text.streamLabel}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
                          {text.streamDescription}
                        </p>
                      </div>
                      <Switch
                        aria-label={text.streamLabel}
                        checked={streamMode}
                        onCheckedChange={setStreamMode}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <FieldLabel>{text.responseMode}</FieldLabel>
                    <Select
                      value={responseMode}
                      onValueChange={(value) => {
                        const nextValue = value as ResponseMode;
                        setResponseMode(nextValue);
                        // Custom schemas live in Advanced controls. Auto-opening
                        // that panel prevents the required schema fields from
                        // being hidden right after the user selects the mode.
                        if (nextValue === "json_schema") {
                          setAdvancedOpen(true);
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label={text.responseMode}
                        className="h-11 w-full rounded-md border-border/70 bg-background"
                      >
                        <SelectValue placeholder={text.responseMode} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">{text.plainText}</SelectItem>
                        <SelectItem value="json_object">
                          {text.jsonObject}
                        </SelectItem>
                        <SelectItem value="json_schema">
                          {text.jsonSchema}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs leading-5">
                      {responseMode === "json_schema"
                        ? text.customSchemaHint
                        : text.responseModeHint}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor={messageInputID}>
                    {text.message}
                  </FieldLabel>
                  <Textarea
                    id={messageInputID}
                    aria-label={text.message}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={text.messagePlaceholder}
                    className="min-h-[160px] rounded-xl"
                  />
                </div>

                <div className="space-y-2">
                  <FieldLabel
                    action={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <PaperclipIcon className="size-4" />
                        {text.addFiles}
                      </Button>
                    }
                  >
                    {text.files}
                  </FieldLabel>
                  <input
                    id={fileInputID}
                    aria-label={text.files}
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => handleQueueFiles(event.target.files)}
                  />
                  <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-3">
                    {queuedFiles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{text.noFiles}</p>
                    ) : (
                      <div className="space-y-2">
                        {queuedFiles.map((file, index) => (
                          <div
                            key={`${file.name}:${file.size}:${file.lastModified}`}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {file.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {file.size} bytes
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="rounded-full"
                              onClick={() => handleRemoveFile(index)}
                            >
                              <Trash2Icon className="size-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs leading-5">
                    {text.filesHint}
                  </p>
                </div>
              </section>

              <Separator className="bg-slate-200" />

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <div className="rounded-xl border border-border/70 bg-muted/10">
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="flex h-auto w-full items-center justify-between rounded-xl px-3 py-3"
                    >
                      <div className="text-left">
                        <p className="text-[13px] font-medium">
                          {text.advancedTitle}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
                          {text.advancedDescription}
                        </p>
                      </div>
                      <ChevronDownIcon
                        className={cn(
                          "size-4 shrink-0 transition-transform",
                          advancedOpen ? "rotate-180" : "rotate-0",
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="border-t border-border/70 px-4 py-4">
                    <div className="grid gap-3">
                      <div className="rounded-xl border border-border/70 bg-muted/10 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-medium">
                              {text.reasoningLabel}
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
                              {text.reasoningDescription}
                            </p>
                          </div>
                          <Switch
                            aria-label={text.reasoningLabel}
                            checked={reasoningEnabled}
                            onCheckedChange={setReasoningEnabled}
                          />
                        </div>
                        <div className="mt-4 space-y-2">
                          <FieldLabel>{text.reasoningEffort}</FieldLabel>
                          <Select
                            value={reasoningEffort}
                            onValueChange={(value) =>
                              setReasoningEffort(value as ReasoningEffort)
                            }
                            disabled={!reasoningEnabled}
                          >
                            <SelectTrigger
                              aria-label={text.reasoningEffort}
                              className="h-11 w-full rounded-xl border-border/70 bg-background"
                            >
                              <SelectValue placeholder={text.reasoningEffort} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">low</SelectItem>
                              <SelectItem value="medium">medium</SelectItem>
                              <SelectItem value="high">high</SelectItem>
                              <SelectItem value="max">max</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <FieldLabel
                          htmlFor={previousTurnInputID}
                          action={
                            turn?.id ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="rounded-full px-2"
                                onClick={() => setPreviousTurnID(turn.id)}
                              >
                                {text.useLatestResponse}
                              </Button>
                            ) : null
                          }
                        >
                          {text.previousResponse}
                        </FieldLabel>
                        <Input
                          id={previousTurnInputID}
                          aria-label={text.previousResponse}
                          value={previousTurnID}
                          onChange={(event) => setPreviousTurnID(event.target.value)}
                          className="h-10 rounded-xl font-mono"
                        />
                        <p className="text-muted-foreground text-xs leading-5">
                          {text.previousResponseHint}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <FieldLabel htmlFor={maxOutputTokensInputID}>
                          {text.maxOutputTokens}
                        </FieldLabel>
                        <Input
                          id={maxOutputTokensInputID}
                          aria-label={text.maxOutputTokens}
                          value={maxOutputTokens}
                          onChange={(event) =>
                            setMaxOutputTokens(event.target.value)
                          }
                          placeholder="1024"
                          className="h-10 rounded-xl"
                        />
                      </div>

                      {responseMode === "json_schema" ? (
                        <div className="grid gap-3">
                          <div className="space-y-2">
                            <FieldLabel htmlFor={schemaNameInputID}>
                              {text.schemaName}
                            </FieldLabel>
                            <Input
                              id={schemaNameInputID}
                              aria-label={text.schemaName}
                              value={schemaName}
                              onChange={(event) =>
                                setSchemaName(event.target.value)
                              }
                              className="h-10 rounded-xl"
                            />
                          </div>
                          <div className="space-y-2">
                            <FieldLabel htmlFor={schemaBodyInputID}>
                              {text.schemaBody}
                            </FieldLabel>
                            <Textarea
                              id={schemaBodyInputID}
                              aria-label={text.schemaBody}
                              value={schemaBody}
                              onChange={(event) =>
                                setSchemaBody(event.target.value)
                              }
                              className="min-h-[220px] rounded-md border-foreground bg-foreground font-mono text-xs text-background"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </div>

            <div className="mt-auto border-t border-border/70 pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="rounded-xl px-5"
                  onClick={handleRun}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <PlayIcon className="size-4" />
                  )}
                  {submitting ? text.running : text.run}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => {
                    setTraceItems([]);
                    setTurn(null);
                    setLiveOutput("");
                    setLiveReasoning("");
                    setLastRunMode(null);
                  }}
                >
                  {text.clear}
                </Button>
              </div>
            </div>
          </div>
        </aside>

        <main className="border-b border-border/70 px-4 py-4 lg:px-5 xl:border-r xl:border-b-0">
          <div className="flex h-full min-h-[680px] flex-col">
            <div className="border-b border-border/70 pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <PaneHeader
                  eyebrow={text.traceEyebrow}
                  title={text.traceTitle}
                  description={text.traceDescription}
                />
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={traceFilter}
                  onValueChange={(value) => {
                    if (value) {
                      setTraceFilter(value as TraceFilter);
                    }
                  }}
                  className="flex-wrap justify-start rounded-xl bg-muted/20 p-0.5"
                >
                  {traceFilterOptions.map((option) => (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      className="rounded-lg border-0 px-2.5 text-[11px]"
                    >
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {lastRunMode === "blocking" && turn ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                  <p className="text-sm font-medium text-amber-950">
                    {text.blockingReplayTitle}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-amber-900/80">
                    {text.blockingReplayDescription}
                  </p>
                </div>
              ) : null}
            </div>

            <ScrollArea className="mt-5 min-h-0 flex-1 pr-3 xl:h-[680px]">
              <div className="space-y-6 pb-1">
                {groupedTraceItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                    {traceItems.length === 0
                      ? text.noTrace
                      : text.noFilteredTrace}
                  </div>
                ) : (
                  groupedTraceItems.map((group) => (
                    <section key={group.stage} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <Badge
                          variant="secondary"
                          className="rounded-full border border-border/70 bg-muted/30 text-muted-foreground"
                        >
                          {traceStageLabel(group.stage, text)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {group.items.length}
                        </span>
                        <div className="h-px flex-1 bg-slate-200" />
                      </div>
                      <div className="space-y-3">
                        {group.items.map((item) => (
                          <TraceItemCard
                            key={item.id}
                            item={item}
                            locale={locale}
                            text={text}
                          />
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </main>

        <aside className="bg-muted/5 px-4 py-4 lg:px-5">
          <div className="flex h-full min-h-[680px] flex-col">
            <PaneHeader
              eyebrow={text.resultEyebrow}
              title={text.resultTitle}
              description={text.resultDescription}
            />

            <ScrollArea className="mt-4 min-h-0 flex-1 pr-1 xl:h-[680px]">
              <div className="space-y-4 pb-1">
                <section className="rounded-xl border border-border/70 bg-muted/10 px-3 py-3">
                  <SummaryRow
                    label={text.responseID}
                    value={currentResponseID}
                  />
                  <SummaryRow label={text.traceID} value={currentTraceID} />
                  <SummaryRow label={text.finalStatus} value={currentStatus} />
                  <SummaryRow
                    label={text.totalTokens}
                    value={currentTokenCount}
                  />
                </section>

                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel>{text.liveOutput}</FieldLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full px-2"
                      disabled={!formattedOutputText}
                      onClick={() =>
                        handleCopy(formattedOutputText, text.copied)
                      }
                    >
                      <CopyIcon className="size-4" />
                      {text.copy}
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-foreground bg-foreground">
                    <ScrollArea className="h-[260px] px-4 py-4">
                      <MarkdownContent
                        content={formattedOutputText || text.noResponse}
                        isLoading={false}
                        rehypePlugins={workspaceMessageRehypePlugins}
                        className="text-sm leading-7 text-background"
                      />
                    </ScrollArea>
                  </div>
                </section>

                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {text.reasoningTab}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm leading-6">
                      {text.reasoningDescription}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
                    <ScrollArea className="h-[180px] px-4 py-4">
                      <MarkdownContent
                        content={reasoningSummary || text.noResponse}
                        isLoading={false}
                        rehypePlugins={workspaceMessageRehypePlugins}
                        className="text-sm leading-6 text-muted-foreground"
                      />
                    </ScrollArea>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {text.jsonTab}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm leading-6">
                        {text.resultDescription}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full bg-background"
                      disabled={!formattedResponseJSON}
                      onClick={() =>
                        handleCopy(formattedResponseJSON, text.copied)
                      }
                    >
                      <CopyIcon className="size-4" />
                      {text.copy}
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
                    <ScrollArea className="h-[260px] px-4 py-4">
                      <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
                        {formattedResponseJSON || text.noResponse}
                      </pre>
                    </ScrollArea>
                  </div>
                </section>

                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {text.filesTab}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm leading-6">
                      {text.resultDescription}
                    </p>
                  </div>
                  {responseArtifacts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                      {text.noResponse}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {responseArtifacts.map((artifact) => (
                        <div
                          key={artifact.id}
                          className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background px-4 py-4"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {artifact.filename}
                            </p>
                            <p className="mt-1 text-xs break-all text-muted-foreground">
                              {artifact.id}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 rounded-full bg-background"
                            onClick={() => handleDownloadArtifact(artifact)}
                          >
                            <DownloadIcon className="size-4" />
                            {text.download}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </ScrollArea>
          </div>
        </aside>
      </div>
    </section>
  );
}
