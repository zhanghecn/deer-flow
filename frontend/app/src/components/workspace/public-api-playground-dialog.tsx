import {
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  Loader2Icon,
  PaperclipIcon,
  PlayIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  createAPIToken,
  listAPITokens,
  type APITokenRecord,
} from "@/core/auth/tokens";
import { useI18n } from "@/core/i18n/hooks";
import {
  createPublicAPIResponse,
  downloadPublicAPIArtifact,
  resolvePublicAPIBaseURL,
  streamPublicAPIResponse,
  uploadPublicAPIFile,
  type PublicAPIFileObject,
  type PublicAPIOpenAgentsEvent,
  type PublicAPIRequestBody,
  type PublicAPIResponseArtifact,
  type PublicAPIResponseEnvelope,
  type PublicAPIStreamEvent,
} from "@/core/public-api/api";
import { cn } from "@/lib/utils";

import { getPublicAPIPlaygroundText } from "./public-api-playground-dialog.i18n";

type ResponseMode = "text" | "json_object" | "json_schema";
type ReasoningEffort = "minimal" | "low" | "medium" | "high";
type TraceTone = "system" | "assistant" | "tool" | "artifact" | "error";
type DocExample = "responses" | "chat" | "files" | "models";

type TraceItem = {
  id: string;
  tone: TraceTone;
  title: string;
  detail?: string;
  timestamp: number;
  raw?: unknown;
};

interface PublicAPIPlaygroundPanelProps {
  agentName: string;
  defaultBaseURL?: string | null;
  documentationURL?: string | null;
  accessMode?: "workspace" | "public";
  showHero?: boolean;
  hideDocumentationButton?: boolean;
}

let traceCounter = 0;

function nextTraceID() {
  traceCounter += 1;
  return `playground-trace-${traceCounter}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function stringifyJSON(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function prettyJSON(value: unknown) {
  try {
    return stringifyJSON(value);
  } catch {
    return String(value);
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json" });
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1_000);
}

function formatTimestamp(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function traceToneClass(tone: TraceTone) {
  switch (tone) {
    case "assistant":
      return "border-cyan-400/25 bg-cyan-400/8 text-cyan-950";
    case "tool":
      return "border-amber-400/30 bg-amber-400/10 text-amber-950";
    case "artifact":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-950";
    case "error":
      return "border-rose-400/30 bg-rose-400/12 text-rose-950";
    default:
      return "border-border/70 bg-background/80 text-foreground";
  }
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
        {eyebrow}
      </p>
      <div>
        <h2 className="text-[1.08rem] font-semibold tracking-[-0.03em]">
          {title}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {description}
        </p>
      </div>
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
  const labelClassName =
    "text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase";

  return (
    <div className="flex items-center justify-between gap-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClassName}>
          {children}
        </label>
      ) : (
        <p className={labelClassName}>{children}</p>
      )}
      {action}
    </div>
  );
}

function buildTraceFromOpenAgentsEvent(
  event: PublicAPIOpenAgentsEvent,
  text: ReturnType<typeof getPublicAPIPlaygroundText>,
): TraceItem {
  const payload = asRecord(event.payload);

  switch (event.category) {
    case "assistant.message":
      return {
        id: nextTraceID(),
        tone: "assistant",
        title: text.assistantMessage,
        detail: asString(payload?.content),
        timestamp: event.created_at * 1000,
        raw: event.payload,
      };
    case "assistant.tool_calls":
      return {
        id: nextTraceID(),
        tone: "tool",
        title: text.toolCall,
        detail: Array.isArray(payload?.tool_calls)
          ? payload?.tool_calls
              .map((item) => asString(asRecord(item)?.name))
              .filter(Boolean)
              .join(", ")
          : undefined,
        timestamp: event.created_at * 1000,
        raw: event.payload,
      };
    case "tool.result":
      return {
        id: nextTraceID(),
        tone: "tool",
        title: payload?.name
          ? `${text.toolResult}: ${asString(payload.name)}`
          : text.toolResult,
        detail: asString(payload?.content),
        timestamp: event.created_at * 1000,
        raw: event.payload,
      };
    case "state.snapshot":
      return {
        id: nextTraceID(),
        tone: "system",
        title: text.stateSnapshot,
        detail: buildSnapshotDetail(payload),
        timestamp: event.created_at * 1000,
        raw: event.payload,
      };
    case "runtime.custom":
      return {
        id: nextTraceID(),
        tone: "system",
        title: text.customEvent,
        detail: prettyJSON(event.payload),
        timestamp: event.created_at * 1000,
        raw: event.payload,
      };
    case "run.completed":
      return {
        id: nextTraceID(),
        tone: "system",
        title: text.runCompleted,
        timestamp: event.created_at * 1000,
        raw: event.payload,
      };
    default:
      return {
        id: nextTraceID(),
        tone: "system",
        title: event.category,
        detail: prettyJSON(event.payload),
        timestamp: event.created_at * 1000,
        raw: event.payload,
      };
  }
}

function buildSnapshotDetail(payload: Record<string, unknown> | null) {
  if (!payload) {
    return "";
  }

  const parts: string[] = [];
  const title = asString(payload.title);
  if (title) {
    parts.push(title);
  }
  const newArtifacts = Array.isArray(payload.new_artifacts)
    ? payload.new_artifacts.map((item) => asString(item)).filter(Boolean)
    : [];
  if (newArtifacts.length > 0) {
    parts.push(`new artifacts: ${newArtifacts.join(", ")}`);
  }
  const messageCount = asNumber(payload.message_count);
  if (messageCount > 0) {
    parts.push(`messages: ${messageCount}`);
  }
  return parts.join(" | ");
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
    metadata: {
      source: "workspace_public_api_playground",
      surface: "playground_page",
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

function quoteForShell(value: string) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildCurlExample(params: {
  baseURL: string;
  apiToken: string;
  body: PublicAPIRequestBody;
  mode: "blocking" | "stream";
  route: "responses" | "chat";
}) {
  const routePath =
    params.route === "responses" ? "/responses" : "/chat/completions";
  const payload =
    params.route === "responses"
      ? {
          ...params.body,
          stream: params.mode === "stream",
        }
      : {
          model: params.body.model,
          messages: [
            {
              role: "user",
              content:
                typeof params.body.input === "string"
                  ? params.body.input
                  : "Use the published agent contract.",
            },
          ],
          stream: params.mode === "stream",
          ...(params.body.text?.format
            ? {
                response_format:
                  params.body.text.format.type === "json_schema"
                    ? {
                        type: "json_schema",
                        json_schema: {
                          name:
                            params.body.text.format.name ?? "response_payload",
                          schema: params.body.text.format.schema ?? {
                            type: "object",
                          },
                          strict: params.body.text.format.strict ?? true,
                        },
                      }
                    : undefined,
              }
            : {}),
          ...(params.body.reasoning?.effort
            ? { reasoning_effort: params.body.reasoning.effort }
            : {}),
          ...(params.body.max_output_tokens
            ? { max_completion_tokens: params.body.max_output_tokens }
            : {}),
        };

  return [
    `curl ${params.mode === "stream" ? "-N " : ""}-X POST ${quoteForShell(`${params.baseURL}${routePath}`)}`,
    `  -H ${quoteForShell(`Authorization: Bearer ${params.apiToken || "<api_key>"}`)}`,
    `  -H ${quoteForShell("Content-Type: application/json")}`,
    `  -d ${quoteForShell(JSON.stringify(payload, null, 2))}`,
  ].join(" \\\n");
}

function buildFilesCurl(baseURL: string, apiToken: string) {
  return [
    `curl -X POST ${quoteForShell(`${baseURL}/files`)}`,
    `  -H ${quoteForShell(`Authorization: Bearer ${apiToken || "<api_key>"}`)}`,
    `  -F ${quoteForShell("purpose=assistants")}`,
    `  -F ${quoteForShell("file=@/absolute/path/to/document.pdf")}`,
  ].join(" \\\n");
}

function buildModelsCurl(baseURL: string, apiToken: string) {
  return [
    `curl ${quoteForShell(`${baseURL}/models`)}`,
    `  -H ${quoteForShell(`Authorization: Bearer ${apiToken || "<api_key>"}`)}`,
  ].join(" \\\n");
}

function buildOpenAPISpec(
  baseURL: string,
  agentName: string,
  body: PublicAPIRequestBody,
) {
  return {
    openapi: "3.1.0",
    info: {
      title: `${agentName} Public API`,
      version: "1.0.0",
      description:
        "OpenAI-compatible surface for a published OpenAgents contract.",
    },
    servers: [{ url: baseURL }],
    paths: {
      "/models": {
        get: {
          summary: "List published agents",
        },
      },
      "/files": {
        post: {
          summary: "Upload an input file",
        },
      },
      "/responses": {
        post: {
          summary: "Run the published agent",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                example: {
                  ...body,
                  stream: false,
                },
              },
            },
          },
        },
      },
      "/chat/completions": {
        post: {
          summary: "Compatibility adapter for chat completions",
        },
      },
      "/files/{file_id}": {
        get: {
          summary: "Retrieve file metadata",
        },
      },
      "/files/{file_id}/content": {
        get: {
          summary: "Download file content",
        },
      },
    },
  };
}

function buildPostmanCollection(
  baseURL: string,
  apiToken: string,
  responsesBlockingCurl: string,
  responsesStreamingCurl: string,
) {
  return {
    info: {
      name: "OpenAgents Public API",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "base_url", value: baseURL },
      { key: "api_key", value: apiToken || "<api_key>" },
    ],
    item: [
      {
        name: "List Models",
        request: {
          method: "GET",
          header: [{ key: "Authorization", value: "Bearer {{api_key}}" }],
          url: "{{base_url}}/models",
        },
      },
      {
        name: "Upload File",
        request: {
          method: "POST",
          header: [{ key: "Authorization", value: "Bearer {{api_key}}" }],
          body: {
            mode: "formdata",
            formdata: [
              { key: "purpose", value: "assistants", type: "text" },
              { key: "file", value: "", type: "file" },
            ],
          },
          url: "{{base_url}}/files",
        },
      },
      {
        name: "Responses Blocking",
        request: {
          method: "POST",
          header: [
            { key: "Authorization", value: "Bearer {{api_key}}" },
            { key: "Content-Type", value: "application/json" },
          ],
          body: {
            mode: "raw",
            raw: responsesBlockingCurl,
          },
          url: "{{base_url}}/responses",
        },
      },
      {
        name: "Responses Streaming",
        request: {
          method: "POST",
          header: [
            { key: "Authorization", value: "Bearer {{api_key}}" },
            { key: "Content-Type", value: "application/json" },
            { key: "Accept", value: "text/event-stream" },
          ],
          body: {
            mode: "raw",
            raw: responsesStreamingCurl,
          },
          url: "{{base_url}}/responses",
        },
      },
    ],
  };
}

export function PublicAPIPlaygroundPanel({
  agentName,
  defaultBaseURL,
  documentationURL,
  accessMode = "workspace",
  showHero = true,
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
  const previousResponseInputID = useId();
  const messageInputID = useId();
  const fileInputID = useId();
  const maxOutputTokensInputID = useId();
  const schemaNameInputID = useId();
  const schemaBodyInputID = useId();
  const [apiBaseURL, setAPIBaseURL] = useState(
    resolvePublicAPIBaseURL(defaultBaseURL),
  );
  const [apiToken, setAPIToken] = useState("");
  const [createdToken, setCreatedToken] = useState("");
  const [tokens, setTokens] = useState<APITokenRecord[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [creatingToken, setCreatingToken] = useState(false);
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
    useState<ReasoningEffort>("medium");
  const [previousResponseID, setPreviousResponseID] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [traceItems, setTraceItems] = useState<TraceItem[]>([]);
  const [response, setResponse] = useState<PublicAPIResponseEnvelope | null>(
    null,
  );
  const [liveOutput, setLiveOutput] = useState("");
  const [docExample, setDocExample] = useState<DocExample>("responses");

  useEffect(() => {
    setAPIBaseURL(resolvePublicAPIBaseURL(defaultBaseURL));
    if (!isWorkspaceMode) {
      return;
    }

    let cancelled = false;

    async function loadTokens() {
      setLoadingTokens(true);
      try {
        const items = await listAPITokens();
        if (!cancelled) {
          setTokens(items);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : text.loadKeysFailed,
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingTokens(false);
        }
      }
    }

    void loadTokens();
    return () => {
      cancelled = true;
    };
  }, [defaultBaseURL, isWorkspaceMode, text.loadKeysFailed]);

  const recentScopedTokens = useMemo(
    () =>
      tokens
        .filter((token) => token.allowed_agents.includes(agentName))
        .slice(0, 4),
    [agentName, tokens],
  );

  const requestBodyPreview = useMemo(() => {
    try {
      return buildResponsesRequestBody({
        agentName,
        message: message.trim() || "Summarize the uploaded materials.",
        uploadedFiles: [],
        responseMode,
        schemaName,
        schemaBody,
        reasoningEnabled,
        reasoningEffort,
        previousResponseID,
        maxOutputTokens,
      });
    } catch {
      return {
        model: agentName,
        input: "invalid_schema_placeholder",
      } satisfies PublicAPIRequestBody;
    }
  }, [
    agentName,
    maxOutputTokens,
    message,
    previousResponseID,
    reasoningEffort,
    reasoningEnabled,
    responseMode,
    schemaBody,
    schemaName,
  ]);

  const docsPayload = useMemo(
    () => prettyJSON({ ...requestBodyPreview, stream: false }),
    [requestBodyPreview],
  );
  const openAPISpec = useMemo(
    () =>
      buildOpenAPISpec(apiBaseURL, agentName, {
        ...requestBodyPreview,
        stream: false,
      }),
    [agentName, apiBaseURL, requestBodyPreview],
  );
  const postmanCollection = useMemo(
    () =>
      buildPostmanCollection(
        apiBaseURL,
        apiToken,
        docsPayload,
        prettyJSON({ ...requestBodyPreview, stream: true }),
      ),
    [apiBaseURL, apiToken, docsPayload, requestBodyPreview],
  );

  const docsExamples = useMemo(
    () => ({
      responses: {
        blocking: buildCurlExample({
          baseURL: apiBaseURL,
          apiToken,
          body: requestBodyPreview,
          mode: "blocking",
          route: "responses",
        }),
        stream: buildCurlExample({
          baseURL: apiBaseURL,
          apiToken,
          body: requestBodyPreview,
          mode: "stream",
          route: "responses",
        }),
      },
      chat: {
        blocking: buildCurlExample({
          baseURL: apiBaseURL,
          apiToken,
          body: requestBodyPreview,
          mode: "blocking",
          route: "chat",
        }),
        stream: buildCurlExample({
          baseURL: apiBaseURL,
          apiToken,
          body: requestBodyPreview,
          mode: "stream",
          route: "chat",
        }),
      },
      files: buildFilesCurl(apiBaseURL, apiToken),
      models: buildModelsCurl(apiBaseURL, apiToken),
    }),
    [apiBaseURL, apiToken, requestBodyPreview],
  );

  const formattedResponseJSON = useMemo(
    () => (response ? prettyJSON(response) : ""),
    [response],
  );

  const formattedOutputText = useMemo(() => {
    if (!response?.output_text) {
      return liveOutput;
    }
    try {
      const parsed = JSON.parse(response.output_text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return response.output_text;
    }
  }, [liveOutput, response?.output_text]);

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

  async function handleCopy(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(text.copyFailed);
    }
  }

  async function handleCreateScopedKey() {
    setCreatingToken(true);
    try {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
      const token = await createAPIToken({
        name: `${agentName}-playground-${new Date().toISOString().slice(0, 10)}`,
        scopes: ["responses:create", "responses:read", "artifacts:read"],
        allowed_agents: [agentName],
        expires_at: expiresAt.toISOString(),
        metadata: {
          source: "public_api_playground",
          agent_name: agentName,
        },
      });

      if (token.token) {
        setAPIToken(token.token);
        setCreatedToken(token.token);
      }
      setTokens((current) => [token, ...current]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : text.keyCreateFailed,
      );
    } finally {
      setCreatingToken(false);
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
        tone: "system",
        title: text.uploadStarted(file.name),
        detail: `${file.size} bytes`,
      });
      const uploadedFile = await uploadPublicAPIFile({
        baseURL: apiBaseURL,
        apiToken: trimmedToken,
        file,
      });
      uploadedFiles.push(uploadedFile);
      appendTrace({
        tone: "artifact",
        title: text.uploadFinished(uploadedFile.filename, uploadedFile.id),
      });
    }
    return uploadedFiles;
  }

  function handleStreamingEvent(event: PublicAPIStreamEvent) {
    const record = asRecord(event.data);

    if (event.event === "response.created") {
      appendTrace({
        tone: "system",
        title: text.streamStarted,
        detail: asString(asRecord(record?.response)?.id),
      });
      return;
    }

    if (event.event === "response.output_text.delta") {
      const delta = asString(record?.delta);
      if (delta) {
        setLiveOutput((current) => `${current}${delta}`);
      }
      return;
    }

    if (event.event === "response.openagents.event") {
      const openEvent = record?.event as PublicAPIOpenAgentsEvent | undefined;
      if (!openEvent) {
        return;
      }
      const trace = buildTraceFromOpenAgentsEvent(openEvent, text);
      appendTrace(trace);

      const payload = asRecord(openEvent.payload);
      const newArtifacts = Array.isArray(payload?.new_artifacts)
        ? payload?.new_artifacts.map((item) => asString(item)).filter(Boolean)
        : [];
      for (const artifact of newArtifacts) {
        appendTrace({
          tone: "artifact",
          title: text.artifactReady(artifact.split("/").at(-1) ?? artifact),
        });
      }
      return;
    }

    if (event.event === "response.completed") {
      const responsePayload = asRecord(record?.response) as unknown as
        | PublicAPIResponseEnvelope
        | undefined;
      if (responsePayload) {
        setResponse(responsePayload);
        setPreviousResponseID(responsePayload.id);
        appendTrace({
          tone: "system",
          title: text.requestFinished(responsePayload.id),
        });
      }
      return;
    }

    if (event.event === "error") {
      appendTrace({
        tone: "error",
        title: text.requestFailed,
        detail: prettyJSON(event.data),
      });
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
          onEvent: handleStreamingEvent,
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
        for (const event of payload.openagents?.events ?? []) {
          appendTrace(buildTraceFromOpenAgentsEvent(event, text));
        }
        appendTrace({
          tone: "system",
          title: text.requestFinished(payload.id),
        });
        for (const artifact of payload.artifacts ?? []) {
          appendTrace({
            tone: "artifact",
            title: text.artifactReady(artifact.filename),
          });
        }
      }

      setQueuedFiles([]);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : text.requestFailed;
      appendTrace({
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
        tone: "artifact",
        title: `${filename} · ${text.download}`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.requestFailed);
    }
  }

  const docsBody =
    docExample === "responses"
      ? docsExamples.responses[streamMode ? "stream" : "blocking"]
      : docExample === "chat"
        ? docsExamples.chat[streamMode ? "stream" : "blocking"]
        : docExample === "files"
          ? docsExamples.files
          : docsExamples.models;

  return (
    <section className="border-border/70 relative overflow-hidden rounded-[36px] border bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_26%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.98))] shadow-[0_30px_120px_-56px_rgba(15,23,42,0.38)]">
      <div className="border-border/60 border-b px-6 py-6 lg:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <Badge
              variant="outline"
              className="rounded-full px-3 py-1 text-[11px] tracking-[0.22em] uppercase"
            >
              {text.heroEyebrow}
            </Badge>
            <h1 className="mt-4 max-w-4xl text-[clamp(2rem,4vw,3.5rem)] leading-[0.96] font-semibold tracking-[-0.06em]">
              {agentName}
            </h1>
            {showHero ? (
              <>
                <p className="text-muted-foreground mt-4 max-w-3xl text-base leading-7">
                  {text.heroTitle}
                </p>
                <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
                  {text.heroDescription}
                </p>
              </>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[500px]">
            <div className="border-border/70 rounded-[24px] border bg-white/70 px-4 py-4 shadow-xs">
              <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                Agent
              </p>
              <p className="mt-2 text-sm font-medium break-all">{agentName}</p>
            </div>
            <div className="border-border/70 rounded-[24px] border bg-white/70 px-4 py-4 shadow-xs">
              <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                Base URL
              </p>
              <p className="mt-2 text-sm font-medium break-all">{apiBaseURL}</p>
            </div>
            <div className="border-border/70 rounded-[24px] border bg-white/70 px-4 py-4 shadow-xs">
              <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                Surface
              </p>
              <p className="mt-2 text-sm font-medium break-all">
                `/v1/models` `/v1/files` `/v1/responses` `/v1/chat/completions`
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 lg:px-8 xl:grid-cols-[420px_minmax(0,1fr)]">
        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <section className="border-border/70 rounded-[28px] border bg-white/75 p-5 shadow-xs">
            <SectionTitle
              eyebrow="Identity"
              title={text.credentialsTitle}
              description={
                isWorkspaceMode
                  ? text.credentialsDescription
                  : text.publicCredentialsDescription
              }
            />

            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <FieldLabel htmlFor={baseURLInputID}>{text.baseURL}</FieldLabel>
                <Input
                  id={baseURLInputID}
                  aria-label={text.baseURL}
                  value={apiBaseURL}
                  onChange={(event) => setAPIBaseURL(event.target.value)}
                  className="border-border/80 h-11 rounded-2xl bg-white/80"
                />
                <p className="text-muted-foreground text-xs leading-5">
                  {text.baseURLHint}
                </p>
              </div>

              <div className="space-y-2">
                <FieldLabel
                  htmlFor={apiTokenInputID}
                  action={
                    isWorkspaceMode ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={handleCreateScopedKey}
                        disabled={creatingToken}
                      >
                        {creatingToken ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <KeyRoundIcon className="size-4" />
                        )}
                        {creatingToken
                          ? text.creatingKey
                          : text.createScopedKey}
                      </Button>
                    ) : null
                  }
                >
                  {text.userKey}
                </FieldLabel>
                <Input
                  id={apiTokenInputID}
                  aria-label={text.userKey}
                  value={apiToken}
                  onChange={(event) => setAPIToken(event.target.value)}
                  placeholder="df_..."
                  className="border-border/80 h-11 rounded-2xl bg-white/80 font-mono"
                />
                <p className="text-muted-foreground text-xs leading-5">
                  {isWorkspaceMode ? text.userKeyHint : text.publicUserKeyHint}
                </p>
              </div>

              {isWorkspaceMode && createdToken ? (
                <div className="rounded-[24px] border border-emerald-400/25 bg-emerald-400/8 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CheckCircle2Icon className="size-4 text-emerald-700" />
                        <p className="text-sm font-medium text-emerald-950">
                          {text.keyReadyTitle}
                        </p>
                      </div>
                      <p className="text-xs leading-5 text-emerald-900/80">
                        {text.keyReadyDescription}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full border-emerald-400/30 bg-white/75"
                      onClick={() =>
                        handleCopy(createdToken, text.keyReadyCopied)
                      }
                    >
                      <CopyIcon className="size-4" />
                      {text.keyReadyCopy}
                    </Button>
                  </div>
                </div>
              ) : null}

              {isWorkspaceMode ? (
                <div className="border-border/70 rounded-[24px] border bg-slate-950 px-4 py-4 text-white">
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel>{text.recentKeys}</FieldLabel>
                    {loadingTokens ? (
                      <Loader2Icon className="size-4 animate-spin text-slate-300" />
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-2">
                    {recentScopedTokens.length === 0 ? (
                      <p className="text-xs leading-5 text-slate-400">
                        {text.noRecentKeys}
                      </p>
                    ) : (
                      recentScopedTokens.map((token) => (
                        <div
                          key={token.id}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left"
                        >
                          <p className="font-mono text-xs text-slate-100">
                            {token.token_prefix}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {token.name}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="border-border/70 rounded-[28px] border bg-white/75 p-5 shadow-xs">
            <SectionTitle
              eyebrow="Run"
              title={text.requestTitle}
              description={text.requestDescription}
            />

            <div className="mt-5 space-y-4">
              <div className="border-border/70 grid gap-3 rounded-[24px] border bg-white/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{text.streamLabel}</p>
                  </div>
                  <Switch
                    aria-label={text.streamLabel}
                    checked={streamMode}
                    onCheckedChange={setStreamMode}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{text.reasoningLabel}</p>
                  </div>
                  <Switch
                    aria-label={text.reasoningLabel}
                    checked={reasoningEnabled}
                    onCheckedChange={setReasoningEnabled}
                  />
                </div>
                <div className="space-y-2">
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
                      className="border-border/80 h-11 w-full rounded-2xl bg-white/80"
                    >
                      <SelectValue placeholder={text.reasoningEffort} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minimal">minimal</SelectItem>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <FieldLabel
                    htmlFor={previousResponseInputID}
                    action={
                      response?.id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-full px-2"
                          onClick={() => setPreviousResponseID(response.id)}
                        >
                          {text.useLatestResponse}
                        </Button>
                      ) : null
                    }
                  >
                    {text.previousResponse}
                  </FieldLabel>
                  <Input
                    id={previousResponseInputID}
                    aria-label={text.previousResponse}
                    value={previousResponseID}
                    onChange={(event) =>
                      setPreviousResponseID(event.target.value)
                    }
                    className="border-border/80 h-11 rounded-2xl bg-white/80 font-mono"
                  />
                  <p className="text-muted-foreground text-xs leading-5">
                    {text.previousResponseHint}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <FieldLabel htmlFor={messageInputID}>{text.message}</FieldLabel>
                <Textarea
                  id={messageInputID}
                  aria-label={text.message}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={text.messagePlaceholder}
                  className="border-border/80 min-h-[180px] rounded-[24px] bg-white/80"
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
                <div className="border-border/80 rounded-[24px] border border-dashed bg-white/60 p-3">
                  {queuedFiles.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {text.noFiles}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {queuedFiles.map((file, index) => (
                        <div
                          key={`${file.name}:${file.size}:${file.lastModified}`}
                          className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border bg-white/80 px-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {file.name}
                            </p>
                            <p className="text-muted-foreground text-xs">
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

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabel>{text.responseMode}</FieldLabel>
                  <Select
                    value={responseMode}
                    onValueChange={(value) =>
                      setResponseMode(value as ResponseMode)
                    }
                  >
                    <SelectTrigger
                      aria-label={text.responseMode}
                      className="border-border/80 h-11 w-full rounded-2xl bg-white/80"
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
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor={maxOutputTokensInputID}>
                    {text.maxOutputTokens}
                  </FieldLabel>
                  <Input
                    id={maxOutputTokensInputID}
                    aria-label={text.maxOutputTokens}
                    value={maxOutputTokens}
                    onChange={(event) => setMaxOutputTokens(event.target.value)}
                    placeholder="1024"
                    className="border-border/80 h-11 rounded-2xl bg-white/80"
                  />
                </div>
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
                      onChange={(event) => setSchemaName(event.target.value)}
                      className="border-border/80 h-11 rounded-2xl bg-white/80"
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
                      onChange={(event) => setSchemaBody(event.target.value)}
                      className="border-border/80 min-h-[180px] rounded-[24px] bg-slate-950 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="rounded-full px-5"
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
                  className="rounded-full"
                  onClick={() => {
                    setTraceItems([]);
                    setResponse(null);
                    setLiveOutput("");
                  }}
                >
                  {text.clear}
                </Button>
                {documentationURL && !hideDocumentationButton ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full"
                    onClick={() => window.open(documentationURL, "_blank")}
                  >
                    <WandSparklesIcon className="size-4" />
                    Developer docs
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </aside>

        <div className="space-y-6">
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24 }}
            className="border-border/70 rounded-[32px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(248,250,252,0.94))] p-5 shadow-xs"
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_360px]">
              <div className="space-y-4">
                <SectionTitle
                  eyebrow="Trace"
                  title={text.traceTitle}
                  description={text.traceDescription}
                />
                <ScrollArea className="h-[520px] pr-3">
                  <div className="space-y-3">
                    {traceItems.length === 0 ? (
                      <div className="border-border/80 text-muted-foreground rounded-[24px] border border-dashed bg-white/70 px-4 py-6 text-sm">
                        {text.noTrace}
                      </div>
                    ) : (
                      traceItems.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "rounded-[24px] border px-4 py-4 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.35)]",
                            traceToneClass(item.tone),
                          )}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">
                                {item.title}
                              </p>
                              {item.detail ? (
                                <p className="mt-1 text-sm leading-6 break-words opacity-80">
                                  {item.detail}
                                </p>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-[11px] tracking-[0.18em] uppercase opacity-60">
                              {formatTimestamp(item.timestamp, locale)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="space-y-4">
                <div className="border-border/70 rounded-[28px] border bg-slate-950 px-5 py-5 text-slate-100">
                  <FieldLabel>{text.liveOutput}</FieldLabel>
                  <ScrollArea className="mt-3 h-[280px]">
                    <pre className="font-mono text-xs leading-6 whitespace-pre-wrap">
                      {formattedOutputText || text.noResponse}
                    </pre>
                  </ScrollArea>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="border-border/70 rounded-[24px] border bg-white/80 px-4 py-4">
                    <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                      {text.responseID}
                    </p>
                    <p className="mt-2 text-sm font-medium break-all">
                      {response?.id ?? "—"}
                    </p>
                  </div>
                  <div className="border-border/70 rounded-[24px] border bg-white/80 px-4 py-4">
                    <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                      {text.traceID}
                    </p>
                    <p className="mt-2 text-sm font-medium break-all">
                      {asString(response?.openagents?.trace_id) || "—"}
                    </p>
                  </div>
                  <div className="border-border/70 rounded-[24px] border bg-white/80 px-4 py-4">
                    <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                      {text.totalTokens}
                    </p>
                    <p className="mt-2 text-sm font-medium break-all">
                      {response?.usage?.total_tokens ?? "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.section>

          <section className="border-border/70 rounded-[32px] border bg-white/78 p-5 shadow-xs">
            <SectionTitle
              eyebrow="Result"
              title={text.resultTitle}
              description={text.docsDescription}
            />
            <Tabs defaultValue="output" className="mt-5">
              <TabsList className="grid w-full grid-cols-4 rounded-2xl">
                <TabsTrigger value="output">{text.outputTab}</TabsTrigger>
                <TabsTrigger value="json">{text.jsonTab}</TabsTrigger>
                <TabsTrigger value="files">{text.filesTab}</TabsTrigger>
                <TabsTrigger value="docs">{text.docsTab}</TabsTrigger>
              </TabsList>

              <TabsContent value="output" className="mt-4">
                <div className="border-border/70 rounded-[24px] border bg-slate-950 px-5 py-5">
                  <ScrollArea className="h-[300px]">
                    <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-slate-100">
                      {formattedOutputText || text.noResponse}
                    </pre>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="json" className="mt-4">
                <div className="border-border/70 rounded-[24px] border bg-slate-950 px-5 py-5">
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                      disabled={!formattedResponseJSON}
                      onClick={() =>
                        handleCopy(formattedResponseJSON, text.copied)
                      }
                    >
                      <CopyIcon className="size-4" />
                      {text.copy}
                    </Button>
                  </div>
                  <ScrollArea className="mt-3 h-[300px]">
                    <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-slate-100">
                      {formattedResponseJSON || text.noResponse}
                    </pre>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="files" className="mt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {(response?.artifacts ?? []).length === 0 ? (
                    <div className="border-border/80 text-muted-foreground rounded-[24px] border border-dashed bg-white/80 px-4 py-6 text-sm">
                      {text.noResponse}
                    </div>
                  ) : (
                    (response?.artifacts ?? []).map((artifact) => (
                      <div
                        key={artifact.id}
                        className="border-border/70 rounded-[24px] border bg-white/85 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {artifact.filename}
                            </p>
                            <p className="text-muted-foreground mt-1 text-xs break-all">
                              {artifact.id}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() => handleDownloadArtifact(artifact)}
                          >
                            <DownloadIcon className="size-4" />
                            {text.download}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="docs" className="mt-4">
                <SectionTitle
                  eyebrow="Docs"
                  title={text.docsTitle}
                  description={text.docsDescription}
                />

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant={docExample === "responses" ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setDocExample("responses")}
                  >
                    {text.responsesExample}
                  </Button>
                  <Button
                    type="button"
                    variant={docExample === "chat" ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setDocExample("chat")}
                  >
                    {text.chatExample}
                  </Button>
                  <Button
                    type="button"
                    variant={docExample === "files" ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setDocExample("files")}
                  >
                    {text.filesExample}
                  </Button>
                  <Button
                    type="button"
                    variant={docExample === "models" ? "default" : "outline"}
                    className="rounded-full"
                    onClick={() => setDocExample("models")}
                  >
                    {text.modelsExample}
                  </Button>
                </div>

                <Tabs defaultValue="curl" className="mt-4">
                  <TabsList className="grid w-full grid-cols-3 rounded-2xl">
                    <TabsTrigger value="curl">{text.curlTab}</TabsTrigger>
                    <TabsTrigger value="openapi">{text.openapiTab}</TabsTrigger>
                    <TabsTrigger value="postman">{text.postmanTab}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="curl" className="mt-4">
                    <div className="border-border/70 rounded-[24px] border bg-slate-950 px-5 py-5">
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          onClick={() => handleCopy(docsBody, text.copied)}
                        >
                          <CopyIcon className="size-4" />
                          {text.copy}
                        </Button>
                      </div>
                      <ScrollArea className="mt-3 h-[320px]">
                        <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-slate-100">
                          {docsBody}
                        </pre>
                      </ScrollArea>
                    </div>
                  </TabsContent>

                  <TabsContent value="openapi" className="mt-4">
                    <div className="border-border/70 rounded-[24px] border bg-slate-950 px-5 py-5">
                      <div className="flex justify-end gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          onClick={() =>
                            handleCopy(prettyJSON(openAPISpec), text.copied)
                          }
                        >
                          <CopyIcon className="size-4" />
                          {text.copy}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          onClick={() =>
                            downloadTextFile(
                              `${agentName}-openapi.json`,
                              prettyJSON(openAPISpec),
                            )
                          }
                        >
                          <DownloadIcon className="size-4" />
                          {text.downloadSpec}
                        </Button>
                      </div>
                      <ScrollArea className="mt-3 h-[320px]">
                        <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-slate-100">
                          {prettyJSON(openAPISpec)}
                        </pre>
                      </ScrollArea>
                    </div>
                  </TabsContent>

                  <TabsContent value="postman" className="mt-4">
                    <div className="border-border/70 rounded-[24px] border bg-slate-950 px-5 py-5">
                      <div className="flex justify-end gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          onClick={() =>
                            handleCopy(
                              prettyJSON(postmanCollection),
                              text.copied,
                            )
                          }
                        >
                          <CopyIcon className="size-4" />
                          {text.copy}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                          onClick={() =>
                            downloadTextFile(
                              `${agentName}-postman-collection.json`,
                              prettyJSON(postmanCollection),
                            )
                          }
                        >
                          <DownloadIcon className="size-4" />
                          {text.downloadCollection}
                        </Button>
                      </div>
                      <ScrollArea className="mt-3 h-[320px]">
                        <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-slate-100">
                          {prettyJSON(postmanCollection)}
                        </pre>
                      </ScrollArea>
                    </div>
                  </TabsContent>
                </Tabs>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </section>
  );
}
