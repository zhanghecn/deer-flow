import type {
  PublicAPITurnEvent,
  PublicAPITurnEventType,
  PublicAPITurnStreamEvent,
} from "./public-api";
import { normalizeThreadError } from "./thread-error";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isTurnEventType(value: string): value is PublicAPITurnEventType {
  return [
    "turn.started",
    "assistant.message.started",
    "assistant.text.delta",
    "assistant.reasoning.delta",
    "tool.call.started",
    "tool.call.completed",
    "context.compacted",
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
          detail: normalizeThreadError(event.data),
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
        detail: normalizeThreadError(event.data),
        raw: event.data,
      });
      break;
  }

  // The chat UI consumes ledger events directly for tool activity cards, so the
  // standalone demo keeps the raw event instead of depending on app trace code.
  normalized.push({ kind: "ledger_event", event: turnEvent, raw: event.data });
  return normalized;
}
