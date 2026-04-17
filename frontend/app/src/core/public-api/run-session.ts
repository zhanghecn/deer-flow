import type { PublicAPITurnEvent, PublicAPITurnSnapshot } from "./api";
import {
  buildTraceFromRunEvent,
  type PlaygroundTraceItem,
  type PlaygroundTraceText,
  type PublicAPINormalizedRunEvent,
} from "./events";

export type PublicAPIRunPhase = "ready" | "streaming" | "failed" | "waiting";

export type PublicAPIRunReadModel = {
  liveOutput: string;
  liveReasoning: string;
  traceItems: PlaygroundTraceItem[];
  toolCallCount: number;
  turnId: string;
  turn: PublicAPITurnSnapshot | null;
  phase: PublicAPIRunPhase;
  seenEventKeys: string[];
};

function buildFailedTraceItem(
  detail: string,
  raw: unknown,
): PlaygroundTraceItem {
  return {
    stage: "error",
    tone: "error",
    title: detail || "Turn failed",
    detail: detail || undefined,
    timestamp: Date.now(),
    raw,
  };
}

function eventKey(event: PublicAPITurnEvent) {
  return `${event.type}:${event.sequence}`;
}

function shouldSkipLedgerTrace(event: PublicAPITurnEvent) {
  // Streaming assistant text/reasoning deltas are rendered as one growing card.
  // Replaying those same deltas again from the ledger would fragment the UI.
  return (
    event.type === "assistant.text.delta" ||
    event.type === "assistant.reasoning.delta"
  );
}

function upsertTrace(
  current: PublicAPIRunReadModel,
  params: {
    stage: "assistant";
    title: string;
    detail: string;
    raw: unknown;
  },
) {
  const previous = current.traceItems[current.traceItems.length - 1];
  const nextTimestamp = Date.now();
  if (
    previous &&
    previous.stage === params.stage &&
    previous.tone === "assistant" &&
    previous.title === params.title
  ) {
    const nextTraceItems = [...current.traceItems];
    nextTraceItems[nextTraceItems.length - 1] = {
      ...previous,
      detail: params.detail,
      timestamp: nextTimestamp,
      raw: params.raw,
    };
    return nextTraceItems;
  }

  return [
    ...current.traceItems,
    {
      stage: params.stage,
      tone: "assistant" as const,
      title: params.title,
      detail: params.detail,
      timestamp: nextTimestamp,
      raw: params.raw,
    },
  ];
}

function pushTraceItemIfNeeded(
  current: PublicAPIRunReadModel,
  event: PublicAPITurnEvent,
  traceText: PlaygroundTraceText,
): PublicAPIRunReadModel {
  if (shouldSkipLedgerTrace(event)) {
    return current;
  }

  const key = eventKey(event);
  if (current.seenEventKeys.includes(key)) {
    return current;
  }

  return {
    ...current,
    traceItems: [...current.traceItems, buildTraceFromRunEvent(event, traceText)],
    seenEventKeys: [...current.seenEventKeys, key],
    toolCallCount:
      event.type === "tool.call.started"
        ? current.toolCallCount + 1
        : current.toolCallCount,
  };
}

export function createPublicAPIRunReadModel(): PublicAPIRunReadModel {
  return {
    liveOutput: "",
    liveReasoning: "",
    traceItems: [],
    toolCallCount: 0,
    turnId: "",
    turn: null,
    phase: "ready",
    seenEventKeys: [],
  };
}

export function extractPublicAPIReasoningSummary(
  turn: PublicAPITurnSnapshot | null | undefined,
) {
  return turn?.reasoning_text?.trim() ?? "";
}

export function formatPublicAPIOutputText(
  turn: PublicAPITurnSnapshot | null,
  liveOutput: string,
) {
  if (!turn?.output_text) {
    return liveOutput;
  }

  try {
    const parsed = JSON.parse(turn.output_text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return turn.output_text;
  }
}

export function applyNormalizedPublicAPIRunEvent(params: {
  current: PublicAPIRunReadModel;
  event: PublicAPINormalizedRunEvent;
  traceText: PlaygroundTraceText;
}): PublicAPIRunReadModel {
  const { current, event, traceText } = params;

  switch (event.kind) {
    case "turn_started":
      return {
        ...current,
        turnId: event.turnId || current.turnId,
        phase: "streaming",
      };
    case "assistant_text_delta":
      return {
        ...current,
        liveOutput: `${current.liveOutput}${event.delta}`,
        traceItems: upsertTrace(current, {
          stage: "assistant",
          title: traceText.assistantMessage,
          detail: `${current.liveOutput}${event.delta}`,
          raw: {
            kind: "assistant_text_stream",
            text: `${current.liveOutput}${event.delta}`,
          },
        }),
      };
    case "assistant_reasoning_delta":
      return {
        ...current,
        liveReasoning: `${current.liveReasoning}${event.delta}`.trim(),
        traceItems: upsertTrace(current, {
          stage: "assistant",
          title: traceText.assistantThinking,
          detail: `${current.liveReasoning}${event.delta}`.trim(),
          raw: {
            kind: "assistant_reasoning_stream",
            text: `${current.liveReasoning}${event.delta}`.trim(),
          },
        }),
      };
    case "ledger_event": {
      let next = pushTraceItemIfNeeded(current, event.event, traceText);
      if (event.event.turn_id?.trim()) {
        next = {
          ...next,
          turnId: event.event.turn_id.trim(),
        };
      }
      if (event.event.type === "assistant.message.completed") {
        next = {
          ...next,
          liveOutput: event.event.text?.trim() || next.liveOutput,
          liveReasoning: event.event.reasoning?.trim() || next.liveReasoning,
        };
      }
      if (event.event.type === "turn.requires_input") {
        next = {
          ...next,
          phase: "waiting",
        };
      }
      if (event.event.type === "turn.failed") {
        next = {
          ...next,
          phase: "failed",
        };
      }
      if (event.event.type === "turn.completed") {
        next = {
          ...next,
          phase: "ready",
        };
      }
      return next;
    }
    case "turn_completed":
      return {
        ...current,
        turnId: event.turnId || current.turnId,
        phase: "ready",
      };
    case "turn_failed":
      return {
        ...current,
        phase: "failed",
        traceItems: [...current.traceItems, buildFailedTraceItem(event.detail, event.raw)],
      };
  }
}

export function applyPublicAPITurnSnapshot(params: {
  current: PublicAPIRunReadModel;
  turn: PublicAPITurnSnapshot;
  traceText: PlaygroundTraceText;
}): PublicAPIRunReadModel {
  let next: PublicAPIRunReadModel = {
    ...params.current,
    turn: params.turn,
    turnId: params.turn.id,
    liveOutput: params.turn.output_text || params.current.liveOutput,
    liveReasoning:
      params.turn.reasoning_text || params.current.liveReasoning,
    phase:
      params.turn.status === "requires_input"
        ? "waiting"
        : params.turn.status === "failed"
          ? "failed"
          : "ready",
  };

  for (const event of params.turn.events) {
    next = pushTraceItemIfNeeded(next, event, params.traceText);
  }

  return next;
}
