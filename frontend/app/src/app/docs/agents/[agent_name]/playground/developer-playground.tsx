import {
  ChevronDownIcon,
  DownloadIcon,
  Loader2Icon,
  PaperclipIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getPublicAPIPlaygroundText } from "@/components/workspace/public-api-playground-dialog.i18n";
import { useI18n } from "@/core/i18n/hooks";
import {
  createPublicAPIResponse,
  downloadPublicAPIArtifact,
  getPublicAPIResponse,
  resolvePublicAPIBaseURL,
  streamPublicAPIResponse,
  uploadPublicAPIFile,
  type PublicAPIFileObject,
  type PublicAPIRequestBody,
  type PublicAPIResponseArtifact,
  type PublicAPIResponseEnvelope,
  type PublicAPIStreamEvent,
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
import { cn } from "@/lib/utils";

import { DocsSurface } from "../shared";

type ResponseMode = "text" | "json_object" | "json_schema";
type ReasoningEffort = "minimal" | "low" | "medium" | "high";

type TraceItem = PlaygroundTraceItem & {
  id: string;
};

interface DeveloperPublicAPIPlaygroundProps {
  agentName: string;
  defaultBaseURL?: string | null;
}

const DEFAULT_SCHEMA_BODY =
  '{\n  "type": "object",\n  "properties": {\n    "summary": { "type": "string" }\n  },\n  "required": ["summary"],\n  "additionalProperties": false\n}';

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
  return `docs-playground-trace-${traceCounter}`;
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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildResponsesRequestBody(params: {
  agentName: string;
  message: string;
  uploadedFiles: PublicAPIFileObject[];
  responseMode: ResponseMode;
  schemaName: string;
  schemaBody: string;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  previousResponseID: string;
  maxOutputTokens: string;
}): PublicAPIRequestBody {
  const content: Array<Record<string, unknown>> = [];
  if (params.message.trim()) {
    content.push({ type: "input_text", text: params.message.trim() });
  }
  for (const file of params.uploadedFiles) {
    content.push({ type: "input_file", file_id: file.id });
  }

  const requestBody: PublicAPIRequestBody = {
    model: params.agentName,
    input: [{ role: "user", content }],
    // Docs traffic needs its own explicit source marker so operators can
    // distinguish playground debugging from the workspace-owned console.
    metadata: {
      source: "docs_public_api_playground",
      surface: "developer_docs",
    },
  };

  if (params.previousResponseID.trim()) {
    requestBody.previous_response_id = params.previousResponseID.trim();
  }
  if (params.reasoningEnabled) {
    requestBody.reasoning = {
      effort: params.reasoningEffort,
      summary: "detailed",
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

function formatOutputText(
  response: PublicAPIResponseEnvelope | null,
  liveOutput: string,
) {
  if (!response?.output_text) {
    return liveOutput;
  }

  try {
    return JSON.stringify(JSON.parse(response.output_text), null, 2);
  } catch {
    return response.output_text;
  }
}

function FieldBlock({
  label,
  hint,
  htmlFor,
  action,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  action?: React.ReactNode;
}) {
  const labelClassName =
    "text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClassName}>
            {label}
          </label>
        ) : (
          <p className={labelClassName}>{label}</p>
        )}
        {action}
      </div>
      {hint ? <p className="text-sm leading-6 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function SegmentedButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "justify-center rounded-md border-slate-200 bg-white text-slate-600",
        active &&
          "border-slate-950 bg-slate-950 text-white hover:bg-slate-950 hover:text-white",
      )}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium break-all text-slate-950">
        {value}
      </p>
    </div>
  );
}

function TraceCard({
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
        "rounded-lg border px-4 py-4",
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
            <span className="text-xs font-medium text-slate-500">
              {traceStageLabel(item.stage, text)}
            </span>
            <p className="text-sm font-medium text-slate-950">{item.title}</p>
            <span className="ml-auto shrink-0 text-xs text-slate-500">
              {formatTimestamp(item.timestamp, locale)}
            </span>
          </div>
          {item.detail ? (
            <p className="mt-2 text-sm leading-6 break-words text-slate-700">
              {item.detail}
            </p>
          ) : null}

          {rawPayload ? (
            <Collapsible className="mt-3">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-md px-2 text-xs text-slate-700 hover:bg-white/70"
                >
                  <ChevronDownIcon className="size-4" />
                  {text.rawPayload}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <pre className="font-mono text-xs leading-6 break-words whitespace-pre-wrap text-slate-800">
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

export function DeveloperPublicAPIPlayground({
  agentName,
  defaultBaseURL,
}: DeveloperPublicAPIPlaygroundProps) {
  const { locale } = useI18n();
  const text = getPublicAPIPlaygroundText(locale);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const baseURLInputID = useId();
  const apiTokenInputID = useId();
  const messageInputID = useId();
  const previousResponseInputID = useId();
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
  const [schemaBody, setSchemaBody] = useState(DEFAULT_SCHEMA_BODY);
  const [streamMode, setStreamMode] = useState(true);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("medium");
  const [previousResponseID, setPreviousResponseID] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [traceFilter, setTraceFilter] = useState<TraceFilter>("all");
  const [submitting, setSubmitting] = useState(false);
  const [traceItems, setTraceItems] = useState<TraceItem[]>([]);
  const [response, setResponse] = useState<PublicAPIResponseEnvelope | null>(
    null,
  );
  const [liveOutput, setLiveOutput] = useState("");
  const [lastRunMode, setLastRunMode] = useState<"stream" | "blocking" | null>(
    null,
  );

  useEffect(() => {
    setAPIBaseURL(resolvePublicAPIBaseURL(defaultBaseURL));
  }, [defaultBaseURL]);

  function appendTrace(
    item: Omit<TraceItem, "id" | "timestamp"> & { timestamp?: number },
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

  async function hydrateCompletedResponse(responseId: string, apiToken: string) {
    if (!responseId) {
      return;
    }
    try {
      const payload = await getPublicAPIResponse({
        baseURL: apiBaseURL,
        apiToken,
        responseId,
      });
      setResponse(payload);
      setPreviousResponseID(payload.id);
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

  function handleQueueFiles(files: FileList | null) {
    if (!files) {
      return;
    }

    setQueuedFiles((current) => {
      // The docs surface should not silently upload duplicates if the same file
      // is re-selected during a manual debugging session.
      const seen = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      );
      const next = [...current];

      for (const file of Array.from(files)) {
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
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  }

  async function uploadQueuedFiles(trimmedToken: string) {
    const uploadedFiles: PublicAPIFileObject[] = [];

    for (const file of queuedFiles) {
      appendTrace({
        stage: "upload",
        tone: "system",
        title: text.uploadStarted(file.name),
        detail: formatBytes(file.size),
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

  function handleStreamingEvent(event: PublicAPIStreamEvent, trimmedToken: string) {
    const traceText: PlaygroundTraceText = {
      assistantMessage: text.assistantMessage,
      toolCall: text.toolCall,
      toolResult: text.toolResult,
      runCompleted: text.runCompleted,
    };

    for (const normalizedEvent of normalizePublicAPIStreamEvent(event)) {
      if (normalizedEvent.kind === "run_started") {
        if (normalizedEvent.responseId) {
          setPreviousResponseID(normalizedEvent.responseId);
        }
        appendTrace({
          stage: "run",
          tone: "system",
          title: text.streamStarted,
          detail: normalizedEvent.responseId,
          raw: normalizedEvent.raw,
        });
        continue;
      }

      if (normalizedEvent.kind === "assistant_delta") {
        setLiveOutput((current) => `${current}${normalizedEvent.delta}`);
        continue;
      }

      if (normalizedEvent.kind === "ledger_event") {
        appendTrace(buildTraceFromRunEvent(normalizedEvent.event, traceText));
        continue;
      }

      if (normalizedEvent.kind === "run_completed") {
        void hydrateCompletedResponse(normalizedEvent.responseId, trimmedToken);
        appendTrace({
          stage: "complete",
          tone: "system",
          title: text.requestFinished(normalizedEvent.responseId),
          raw: normalizedEvent.raw,
        });
        continue;
      }

      if (normalizedEvent.kind === "run_failed") {
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
    setResponse(null);
    setTraceItems([]);
    setLiveOutput("");
    setLastRunMode(streamMode ? "stream" : "blocking");

    appendTrace({
      stage: "prepare",
      tone: "system",
      title: text.requestPrepared,
      detail: `${streamMode ? text.sseMode : text.blockingMode} · ${responseModeLabel(responseMode, text)}`,
      raw: {
        model: agentName,
        response_mode: responseMode,
        stream: streamMode,
      },
    });

    try {
      const uploadedFiles = await uploadQueuedFiles(trimmedToken);
      const requestBody = buildResponsesRequestBody({
        agentName,
        message,
        uploadedFiles,
        responseMode,
        schemaName,
        schemaBody,
        reasoningEnabled,
        reasoningEffort,
        previousResponseID,
        maxOutputTokens,
      });

      if (streamMode) {
        await streamPublicAPIResponse({
          baseURL: apiBaseURL,
          apiToken: trimmedToken,
          body: requestBody,
          onEvent: (event) => handleStreamingEvent(event, trimmedToken),
        });
      } else {
        const payload = await createPublicAPIResponse({
          baseURL: apiBaseURL,
          apiToken: trimmedToken,
          body: requestBody,
        });

        setResponse(payload);
        setPreviousResponseID(payload.id);
        setLiveOutput(payload.output_text);

        // Blocking mode still surfaces the full event ledger. Replay it into
        // the same timeline so the docs page has one consistent trace view.
        const traceText: PlaygroundTraceText = {
          assistantMessage: text.assistantMessage,
          toolCall: text.toolCall,
          toolResult: text.toolResult,
          runCompleted: text.runCompleted,
        };
        for (const event of payload.openagents?.run_events ?? []) {
          appendTrace(buildTraceFromRunEvent(event, traceText));
        }
        appendTrace(
          payload.status === "incomplete"
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

  async function handleDownloadArtifact(artifact: PublicAPIResponseArtifact) {
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

  function handleClearConsole() {
    setTraceItems([]);
    setResponse(null);
    setLiveOutput("");
    setLastRunMode(null);
  }

  const filteredTraceItems =
    traceFilter === "all"
      ? traceItems
      : traceItems.filter((item) => item.tone === traceFilter);
  const groupedTraceItems = TRACE_STAGE_ORDER.map((stage) => ({
    stage,
    items: filteredTraceItems.filter((item) => item.stage === stage),
  })).filter((group) => group.items.length > 0);
  const responseArtifacts = response?.artifacts ?? [];
  const formattedResponseJSON = response ? prettyJSON(response) : "";
  const formattedOutputText = formatOutputText(response, liveOutput);
  const currentStatus =
    response?.status ?? (submitting ? text.statusRunning : text.statusIdle);
  const traceFilters: Array<{ value: TraceFilter; label: string }> = [
    { value: "all", label: text.filterAll },
    { value: "system", label: text.filterSystem },
    { value: "assistant", label: text.filterAssistant },
    { value: "tool", label: text.filterTool },
    { value: "artifact", label: text.filterArtifact },
    { value: "error", label: text.filterError },
  ];

  return (
    <div className="space-y-6">
      <DocsSurface className="overflow-hidden border-slate-200 bg-white">
        <div
          id="connect"
          className="scroll-mt-28 border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(226,232,240,0.45),transparent_55%),linear-gradient(180deg,#ffffff,#fbfdff)] px-6 py-6 lg:px-8"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full bg-slate-950 px-3 py-1 text-[11px] tracking-[0.16em] uppercase text-white hover:bg-slate-950">
              POST /v1/responses
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-white px-3 py-1 font-mono text-[11px] tracking-[0.12em]"
            >
              {agentName}
            </Badge>
          </div>

          <div className="mt-4 max-w-3xl">
            <h2 className="text-[1.6rem] leading-[1.05] font-semibold tracking-[-0.04em] text-slate-950">
              {text.requestTitle}
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-slate-600">
              {text.publicCredentialsDescription}
            </p>
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            <div className="space-y-3">
              <FieldBlock
                label={text.baseURL}
                hint={text.baseURLHint}
                htmlFor={baseURLInputID}
              />
              <Input
                id={baseURLInputID}
                value={apiBaseURL}
                onChange={(event) => setAPIBaseURL(event.target.value)}
                className="h-11 rounded-xl border-slate-200 font-mono text-[13px]"
                spellCheck={false}
              />
            </div>

            <div className="space-y-3">
              <FieldBlock
                label={text.userKey}
                hint={text.publicUserKeyHint}
                htmlFor={apiTokenInputID}
              />
              <Input
                id={apiTokenInputID}
                value={apiToken}
                onChange={(event) => setAPIToken(event.target.value)}
                placeholder="sk-..."
                className="h-11 rounded-xl border-slate-200 font-mono text-[13px]"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        <div
          id="run"
          className="scroll-mt-28 grid gap-8 px-6 py-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div className="space-y-6">
            <div className="space-y-3">
              <FieldBlock
                label={text.message}
                hint={text.messagePlaceholder}
                htmlFor={messageInputID}
              />
              <Textarea
                id={messageInputID}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={text.messagePlaceholder}
                className="min-h-[220px] rounded-2xl border-slate-200 px-4 py-3 text-[15px] leading-7 shadow-none"
              />
            </div>

            <div className="space-y-3">
              <FieldBlock label={text.files} hint={text.filesHint} />
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    handleQueueFiles(event.target.files);
                    // Reset the native input so re-selecting the same file
                    // still emits a change event during manual debugging.
                    event.currentTarget.value = "";
                  }}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-950">
                      {queuedFiles.length > 0
                        ? `${queuedFiles.length} ${text.files}`
                        : text.noFiles}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {text.filesHint}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full bg-white"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <PaperclipIcon className="size-4" />
                    {text.addFiles}
                  </Button>
                </div>

                {queuedFiles.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    {queuedFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${file.lastModified}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-950">
                            {file.name}
                          </p>
                          <p className="mt-1 text-xs tracking-[0.12em] text-slate-500 uppercase">
                            {formatBytes(file.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="rounded-full text-slate-500 hover:text-slate-950"
                          onClick={() => handleRemoveFile(index)}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                {text.streamLabel}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {text.streamDescription}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <SegmentedButton
                  active={streamMode}
                  label={text.sseMode}
                  onClick={() => setStreamMode(true)}
                />
                <SegmentedButton
                  active={!streamMode}
                  label={text.blockingMode}
                  onClick={() => setStreamMode(false)}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <FieldBlock label={text.responseMode} hint={text.responseModeHint} />
              <div className="mt-4 grid gap-2">
                <SegmentedButton
                  active={responseMode === "text"}
                  label={text.plainText}
                  onClick={() => setResponseMode("text")}
                />
                <SegmentedButton
                  active={responseMode === "json_object"}
                  label={text.jsonObject}
                  onClick={() => setResponseMode("json_object")}
                />
                <SegmentedButton
                  active={responseMode === "json_schema"}
                  label={text.jsonSchema}
                  onClick={() => setResponseMode("json_schema")}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    {text.reasoningLabel}
                  </p>
                  <p className="text-sm leading-6 text-slate-600">
                    {text.reasoningDescription}
                  </p>
                </div>
                <Switch
                  checked={reasoningEnabled}
                  onCheckedChange={setReasoningEnabled}
                />
              </div>

              {reasoningEnabled ? (
                <div className="mt-4 space-y-3">
                  <FieldBlock label={text.reasoningEffort} />
                  <Select
                    value={reasoningEffort}
                    onValueChange={(value) =>
                      setReasoningEffort(value as ReasoningEffort)
                    }
                  >
                    <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minimal">minimal</SelectItem>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <FieldBlock
                label={text.previousResponse}
                hint={text.previousResponseHint}
                htmlFor={previousResponseInputID}
                action={
                  response?.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full px-2 text-xs"
                      onClick={() => setPreviousResponseID(response.id)}
                    >
                      {text.useLatestResponse}
                    </Button>
                  ) : null
                }
              />
              <Input
                id={previousResponseInputID}
                value={previousResponseID}
                onChange={(event) => setPreviousResponseID(event.target.value)}
                className="mt-3 rounded-xl border-slate-200 font-mono text-[13px]"
                spellCheck={false}
              />
            </div>

            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              className="rounded-2xl border border-slate-200 bg-white"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    {text.advancedTitle}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {text.advancedDescription}
                  </p>
                </div>
                <ChevronDownIcon className="size-4 shrink-0 text-slate-500" />
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-slate-200 px-4 py-4">
                <div className="space-y-5">
                  <div className="space-y-3">
                    <FieldBlock
                      label={text.maxOutputTokens}
                      htmlFor={maxOutputTokensInputID}
                    />
                    <Input
                      id={maxOutputTokensInputID}
                      value={maxOutputTokens}
                      onChange={(event) => setMaxOutputTokens(event.target.value)}
                      className="rounded-xl border-slate-200 font-mono text-[13px]"
                      inputMode="numeric"
                    />
                  </div>

                  {responseMode === "json_schema" ? (
                    <div className="space-y-5 border-t border-slate-200 pt-5">
                      <div className="space-y-3">
                        <FieldBlock
                          label={text.schemaName}
                          hint={text.customSchemaHint}
                          htmlFor={schemaNameInputID}
                        />
                        <Input
                          id={schemaNameInputID}
                          value={schemaName}
                          onChange={(event) => setSchemaName(event.target.value)}
                          className="rounded-xl border-slate-200 font-mono text-[13px]"
                          spellCheck={false}
                        />
                      </div>

                      <div className="space-y-3">
                        <FieldBlock
                          label={text.schemaBody}
                          htmlFor={schemaBodyInputID}
                        />
                        <Textarea
                          id={schemaBodyInputID}
                          value={schemaBody}
                          onChange={(event) => setSchemaBody(event.target.value)}
                          className="min-h-[220px] rounded-2xl border-slate-200 font-mono text-[13px] leading-6"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="grid gap-3">
              <Button
                type="button"
                className="h-11 rounded-full bg-slate-950 text-white hover:bg-slate-900"
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
                className="h-11 rounded-full"
                onClick={handleClearConsole}
              >
                {text.clear}
              </Button>
            </div>
          </div>
        </div>
      </DocsSurface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <DocsSurface className="overflow-hidden border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.traceEyebrow}
                </p>
                <h3 className="mt-2 text-[1.35rem] leading-tight font-semibold tracking-[-0.03em] text-slate-950">
                  {text.traceTitle}
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  {text.traceDescription}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {traceFilters.map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "rounded-full border-slate-200 bg-white",
                      traceFilter === item.value &&
                        "border-slate-950 bg-slate-950 text-white hover:bg-slate-950 hover:text-white",
                    )}
                    onClick={() => setTraceFilter(item.value)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5 px-6 py-5">
            {formattedOutputText ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.liveOutput}
                </p>
                <pre className="mt-3 font-mono text-[13px] leading-6 break-words whitespace-pre-wrap text-slate-900">
                  {formattedOutputText}
                </pre>
              </div>
            ) : null}

            {lastRunMode === "blocking" ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                <p className="text-sm font-medium text-amber-950">
                  {text.blockingReplayTitle}
                </p>
                <p className="mt-2 text-sm leading-6 text-amber-900">
                  {text.blockingReplayDescription}
                </p>
              </div>
            ) : null}

            <ScrollArea className="h-[760px] pr-3">
              {groupedTraceItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-10 text-center">
                  <p className="text-sm leading-7 text-slate-500">
                    {traceItems.length === 0 ? text.noTrace : text.noFilteredTrace}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedTraceItems.map((group) => (
                    <section key={group.stage} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                          {traceStageLabel(group.stage, text)}
                        </p>
                        <div className="h-px flex-1 bg-slate-200" />
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium tracking-[0.16em] text-slate-500 uppercase">
                          {group.items.length}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {group.items.map((item) => (
                          <TraceCard
                            key={item.id}
                            item={item}
                            locale={locale}
                            text={text}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </DocsSurface>

        <DocsSurface className="overflow-hidden border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-5">
            <p className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
              {text.resultEyebrow}
            </p>
            <h3 className="mt-2 text-[1.35rem] leading-tight font-semibold tracking-[-0.03em] text-slate-950">
              {text.resultTitle}
            </h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              {text.resultDescription}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SummaryTile label={text.responseID} value={response?.id ?? "—"} />
              <SummaryTile
                label={text.traceID}
                value={asString(response?.openagents?.trace_id) || "—"}
              />
              <SummaryTile label={text.finalStatus} value={currentStatus} />
              <SummaryTile
                label={text.totalTokens}
                value={response?.usage?.total_tokens ?? "—"}
              />
            </div>
          </div>

          <div className="px-6 py-5">
            <Tabs defaultValue="output" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3 rounded-full bg-slate-100 p-1">
                <TabsTrigger value="output" className="rounded-full">
                  {text.outputTab}
                </TabsTrigger>
                <TabsTrigger value="json" className="rounded-full">
                  {text.jsonTab}
                </TabsTrigger>
                <TabsTrigger value="files" className="rounded-full">
                  {text.filesTab}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="output" className="mt-0">
                <div className="rounded-2xl border border-slate-200 bg-slate-50">
                  <ScrollArea className="h-[680px] px-4 py-4">
                    <pre className="font-mono text-[13px] leading-6 break-words whitespace-pre-wrap text-slate-900">
                      {formattedOutputText || text.noResponse}
                    </pre>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="json" className="mt-0">
                <div className="rounded-2xl border border-slate-200 bg-slate-50">
                  <ScrollArea className="h-[680px] px-4 py-4">
                    <pre className="font-mono text-[13px] leading-6 break-words whitespace-pre-wrap text-slate-900">
                      {formattedResponseJSON || text.noResponse}
                    </pre>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="files" className="mt-0">
                <div className="space-y-3">
                  {responseArtifacts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-10 text-center">
                      <p className="text-sm leading-7 text-slate-500">
                        {text.noResponse}
                      </p>
                    </div>
                  ) : (
                    responseArtifacts.map((artifact) => (
                      <div
                        key={artifact.id}
                        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-950">
                            {artifact.filename}
                          </p>
                          <p className="mt-1 text-xs tracking-[0.12em] text-slate-500 uppercase">
                            {artifact.mime_type ?? "application/octet-stream"}
                            {artifact.bytes ? ` · ${formatBytes(artifact.bytes)}` : ""}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full bg-white"
                          onClick={() => handleDownloadArtifact(artifact)}
                        >
                          <DownloadIcon className="size-4" />
                          {text.download}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </DocsSurface>
      </div>
    </div>
  );
}
