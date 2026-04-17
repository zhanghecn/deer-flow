import type {
  PublicAPITurnEvent,
  PublicAPITurnEventType,
  PublicAPITurnSnapshot,
  PublicAPITurnStreamEvent,
} from "./api";

export type PublicAPINormalizedRunEvent =
  | {
      kind: "turn_started";
      turnId: string;
      raw: unknown;
    }
  | {
      kind: "assistant_text_delta";
      delta: string;
      raw: unknown;
    }
  | {
      kind: "assistant_reasoning_delta";
      delta: string;
      raw: unknown;
    }
  | {
      kind: "ledger_event";
      event: PublicAPITurnEvent;
      raw: unknown;
    }
  | {
      kind: "turn_completed";
      turnId: string;
      raw: unknown;
    }
  | {
      kind: "turn_failed";
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
  assistantThinking: string;
  toolCall: string;
  toolResult: string;
  turnCompleted: string;
  turnStarted: string;
  turnWaiting: string;
  turnFailed: string;
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
  const messageCount =
    typeof payload.message_count === "number" ? payload.message_count : 0;
  if (messageCount > 0) {
    parts.push(`messages: ${messageCount}`);
  }
  return parts.join(" | ");
}

function isTurnEventType(value: string): value is PublicAPITurnEventType {
  return [
    "turn.started",
    "assistant.message.started",
    "assistant.text.delta",
    "assistant.reasoning.delta",
    "tool.call.started",
    "tool.call.completed",
    "turn.requires_input",
    "assistant.message.completed",
    "turn.completed",
    "turn.failed",
  ].includes(value);
}

export function normalizePublicAPIStreamEvent(
  event: PublicAPITurnStreamEvent,
): PublicAPINormalizedRunEvent[] {
  if (event.event === "done") {
    return [];
  }

  const payload = asRecord(event.data);
  const eventType = event.event.trim();
  if (!isTurnEventType(eventType) || !payload) {
    if (event.event === "error") {
      return [
        {
          kind: "turn_failed",
          detail: prettyJSON(event.data),
          raw: event.data,
        },
      ];
    }
    return [];
  }

  const turnEvent = payload as unknown as PublicAPITurnEvent;
  const normalized: PublicAPINormalizedRunEvent[] = [];

  switch (turnEvent.type) {
    case "turn.started":
      normalized.push({
        kind: "turn_started",
        turnId: asString(turnEvent.turn_id),
        raw: event.data,
      });
      break;
    case "assistant.text.delta":
      normalized.push({
        kind: "assistant_text_delta",
        delta: asString(turnEvent.delta),
        raw: event.data,
      });
      break;
    case "assistant.reasoning.delta":
      normalized.push({
        kind: "assistant_reasoning_delta",
        delta: asString(turnEvent.delta),
        raw: event.data,
      });
      break;
    case "turn.completed":
      normalized.push({
        kind: "turn_completed",
        turnId: asString(turnEvent.turn_id),
        raw: event.data,
      });
      break;
    case "turn.failed":
      normalized.push({
        kind: "turn_failed",
        detail: asString(turnEvent.error),
        raw: event.data,
      });
      break;
  }

  normalized.push({ kind: "ledger_event", event: turnEvent, raw: event.data });
  return normalized;
}

export function buildTraceFromRunEvent(
  event: PublicAPITurnEvent,
  text: PlaygroundTraceText,
): PlaygroundTraceItem {
  switch (event.type) {
    case "assistant.text.delta":
    case "assistant.message.completed":
      return {
        stage: "assistant",
        tone: "assistant",
        title: text.assistantMessage,
        detail: asString(event.text || event.delta),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "assistant.reasoning.delta":
      return {
        stage: "assistant",
        tone: "assistant",
        title: text.assistantThinking,
        detail: asString(event.reasoning || event.delta),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "tool.call.started": {
      const parts = [`**方法**：\`${asString(event.tool_name)}\``];
      if (event.tool_arguments !== undefined) {
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
    case "tool.call.completed": {
      const parts: string[] = [];
      const toolName = asString(event.tool_name);
      if (toolName) {
        parts.push(`**方法**：\`${toolName}\``);
      }
      if (event.tool_output !== undefined) {
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
        title: text.toolResult,
        detail: parts.join("\n\n"),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    }
    case "turn.started":
      return {
        stage: "run",
        tone: "system",
        title: text.turnStarted,
        detail: asString(event.turn_id),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "turn.requires_input":
      return {
        stage: "run",
        tone: "system",
        title: text.turnWaiting,
        detail: asString(event.text || event.message_id),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "turn.completed":
      return {
        stage: "complete",
        tone: "system",
        title: text.turnCompleted,
        detail: asString(event.turn_id),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    case "turn.failed":
      return {
        stage: "error",
        tone: "error",
        title: text.turnFailed,
        detail: asString(event.error),
        timestamp: event.created_at * 1000,
        raw: event,
      };
    default:
      return {
        stage: "run",
        tone: "system",
        title: event.type,
        detail: buildSnapshotDetail(asRecord(event)),
        timestamp: event.created_at * 1000,
        raw: event,
      };
  }
}

export function traceToneClass(tone: PlaygroundTraceTone) {
  switch (tone) {
    case "assistant":
      return "border-emerald-200 bg-emerald-50/70";
    case "tool":
      return "border-amber-200 bg-amber-50/80";
    case "artifact":
      return "border-sky-200 bg-sky-50";
    case "error":
      return "border-rose-200 bg-rose-50";
    default:
      return "border-slate-200 bg-slate-50/70";
  }
}

export function traceToneDotClass(tone: PlaygroundTraceTone) {
  switch (tone) {
    case "assistant":
      return "bg-emerald-500";
    case "tool":
      return "bg-amber-500";
    case "artifact":
      return "bg-sky-500";
    case "error":
      return "bg-rose-500";
    default:
      return "bg-slate-400";
  }
}

export function isPublicAPITurnSnapshot(
  value: unknown,
): value is PublicAPITurnSnapshot {
  const record = asRecord(value);
  return (
    record !== null &&
    record.object === "turn" &&
    typeof record.id === "string" &&
    Array.isArray(record.events)
  );
}
