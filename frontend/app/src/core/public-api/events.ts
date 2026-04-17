import type {
  PublicAPIRunEvent,
  PublicAPIResponseEnvelope,
  PublicAPIStreamEvent,
} from "./api";

export type PublicAPINormalizedRunEvent =
  | {
      kind: "run_started";
      responseId: string;
      raw: unknown;
    }
  | {
      kind: "assistant_delta";
      delta: string;
      raw: unknown;
    }
  | {
      kind: "ledger_event";
      event: PublicAPIRunEvent;
      raw: unknown;
    }
  | {
      kind: "run_completed";
      responseId: string;
      raw: unknown;
    }
  | {
      kind: "run_failed";
      detail: string;
      raw: unknown;
    };

export type PlaygroundTraceTone =
  | "system"
  | "assistant"
  | "tool"
  | "artifact"
  | "error";

export type PlaygroundTraceStage =
  | "prepare"
  | "upload"
  | "run"
  | "assistant"
  | "artifact"
  | "complete"
  | "error";

export type PlaygroundTraceFilter = "all" | PlaygroundTraceTone;

export type PlaygroundTraceItem = {
  stage: PlaygroundTraceStage;
  tone: PlaygroundTraceTone;
  title: string;
  detail?: string;
  timestamp: number;
  raw?: unknown;
};

export type PlaygroundTraceText = {
  assistantMessage: string;
  toolCall: string;
  toolResult: string;
  runCompleted: string;
};

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

function formatJSONCodeBlock(value: unknown) {
  if (value === undefined) {
    return "";
  }
  return ["```json", prettyJSON(value), "```"].join("\n");
}

export function prettyJSON(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildSnapshotDetail(payload: Record<string, unknown> | null) {
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

// The playgrounds still receive the legacy public SSE surface today. Normalize
// that transport into a smaller first-party event stream before the UI renders
// timelines so the eventual SDKMessage contract has one frontend entry point.
export function normalizePublicAPIStreamEvent(
  event: PublicAPIStreamEvent,
): PublicAPINormalizedRunEvent[] {
  const record = asRecord(event.data);

  if (event.event === "response.created") {
    const responseId = asString(asRecord(record?.response)?.id);
    return responseId
      ? [{ kind: "run_started", responseId, raw: event.data }]
      : [];
  }

  if (event.event === "response.output_text.delta") {
    const delta = asString(record?.delta);
    return delta ? [{ kind: "assistant_delta", delta, raw: event.data }] : [];
  }

  if (event.event === "response.run_event") {
    const runEvent = record?.event as PublicAPIRunEvent | undefined;
    if (!runEvent) {
      return [];
    }

    const normalized: PublicAPINormalizedRunEvent[] = [];
    switch (runEvent.type) {
      case "run_started":
        normalized.push({
          kind: "run_started",
          responseId: asString(runEvent.response_id),
          raw: event.data,
        });
        break;
      case "assistant_delta":
        normalized.push({
          kind: "assistant_delta",
          delta: asString(runEvent.delta),
          raw: event.data,
        });
        break;
      case "run_completed":
        normalized.push({
          kind: "run_completed",
          responseId: asString(runEvent.response_id),
          raw: event.data,
        });
        break;
      case "run_failed":
        normalized.push({
          kind: "run_failed",
          detail: asString(runEvent.error),
          raw: event.data,
        });
        break;
    }
    normalized.push({ kind: "ledger_event", event: runEvent, raw: event.data });
    return normalized;
  }

  if (event.event === "response.completed") {
    const responsePayload = asRecord(record?.response) as PublicAPIResponseEnvelope | null;
    return responsePayload
      ? [{ kind: "run_completed", responseId: responsePayload.id, raw: event.data }]
      : [];
  }

  if (event.event === "error") {
    return [
      {
        kind: "run_failed",
        detail: prettyJSON(event.data),
        raw: event.data,
      },
    ];
  }

  return [];
}

export function buildTraceFromRunEvent(
  event: PublicAPIRunEvent,
  text: PlaygroundTraceText,
): PlaygroundTraceItem {
  switch (event.type) {
    case "assistant_delta":
      return {
        stage: "assistant",
        tone: "assistant",
        title: text.assistantMessage,
        detail: asString(event.delta),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "assistant_message":
      return {
        stage: "assistant",
        tone: "assistant",
        title: text.assistantMessage,
        detail: asString(event.text),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "tool_started":
      {
        const parts = [
          `**方法**：\`${asString(event.tool_name)}\``,
        ];
        if ("tool_arguments" in event && event.tool_arguments !== undefined) {
          parts.push("**参数**");
          parts.push(formatJSONCodeBlock(event.tool_arguments));
        }
        return {
          stage: "run",
          tone: "tool",
          title: text.toolCall,
          detail: parts.join("\n\n"),
          timestamp: event.created_at * 1000,
          raw: event,
        };
      }
    case "tool_finished":
      {
        const parts: string[] = [];
        const toolName = asString(event.tool_name);
        if (toolName) {
          parts.push(`**方法**：\`${toolName}\``);
        }
        if ("tool_output" in event && event.tool_output !== undefined) {
          parts.push("**返回**");
          if (typeof event.tool_output === "string") {
            parts.push(event.tool_output.trim() ? event.tool_output : "```text\n\n```");
          } else {
            parts.push(formatJSONCodeBlock(event.tool_output));
          }
        }
        return {
          stage: "run",
          tone: "tool",
          title: event.tool_name
            ? `${text.toolResult}: ${asString(event.tool_name)}`
            : text.toolResult,
          detail: parts.join("\n\n") || undefined,
          timestamp: event.created_at * 1000,
          raw: event,
        };
      }
    case "question_requested":
      return {
        stage: "run",
        tone: "system",
        title: "Question requested",
        detail: asString(event.question_id),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "question_answered":
      return {
        stage: "run",
        tone: "system",
        title: "Question answered",
        detail: asString(event.question_id),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "run_completed":
      return {
        stage: "complete",
        tone: "system",
        title: text.runCompleted,
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "run_failed":
      return {
        stage: "error",
        tone: "error",
        title: event.error ?? "Run failed",
        detail: event.error,
        timestamp: event.created_at * 1000,
        raw: event,
      };
    default:
      return {
        stage: "run",
        tone: "system",
        title: event.type,
        detail: prettyJSON(event),
        timestamp: event.created_at * 1000,
        raw: event,
      };
  }
}

export function traceToneClass(tone: PlaygroundTraceTone) {
  switch (tone) {
    case "assistant":
      return "border-emerald-200 bg-emerald-50/80";
    case "tool":
      return "border-amber-200 bg-amber-50/80";
    case "artifact":
      return "border-stone-300 bg-stone-50";
    case "error":
      return "border-rose-200 bg-rose-50/90";
    default:
      return "border-slate-200 bg-white";
  }
}

export function traceToneDotClass(tone: PlaygroundTraceTone) {
  switch (tone) {
    case "assistant":
      return "bg-emerald-600";
    case "tool":
      return "bg-amber-600";
    case "artifact":
      return "bg-stone-500";
    case "error":
      return "bg-rose-600";
    default:
      return "bg-slate-400";
  }
}
