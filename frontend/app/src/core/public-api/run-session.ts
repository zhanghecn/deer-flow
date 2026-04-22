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

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, "");
}

function isAsciiWordChar(value: string) {
  return /[A-Za-z0-9]/.test(value);
}

function isSentenceBoundary(value: string) {
  return /[.!?;:]/.test(value);
}

function isTightPunctuation(value: string) {
  return /[.,!?;:，。！？；：)\]}>%”"'`]/.test(value);
}

function isOpenPunctuation(value: string) {
  return /[(\[{<“"'`]/.test(value);
}

function inferStreamingSeparator(current: string, delta: string) {
  if (!current || !delta) {
    return "";
  }

  const last = current.slice(-1);
  const first = delta[0];

  if (!last || !first || /\s/.test(last) || /\s/.test(first)) {
    return "";
  }

  if (last === "-" || first === "-" || last === "/" || first === "/") {
    return "";
  }

  if (isAsciiWordChar(last) && isOpenPunctuation(first)) {
    return " ";
  }

  if (isTightPunctuation(first) || isOpenPunctuation(last)) {
    return "";
  }

  if (isAsciiWordChar(last) && isAsciiWordChar(first)) {
    return " ";
  }

  if ((isSentenceBoundary(last) || last === '"' || last === "”") && isAsciiWordChar(first)) {
    return " ";
  }

  return "";
}

export function mergeStreamingText(current: string, delta: string) {
  if (!delta) {
    return current;
  }

  if (!current) {
    return delta;
  }

  if (delta.startsWith(current)) {
    return delta;
  }

  if (current.startsWith(delta)) {
    return current;
  }

  const compactCurrent = compactWhitespace(current);
  const compactDelta = compactWhitespace(delta);

  if (compactDelta && compactCurrent) {
    if (
      compactDelta === compactCurrent &&
      delta.length >= current.length
    ) {
      return delta;
    }

    if (compactDelta.startsWith(compactCurrent)) {
      return delta;
    }

    if (compactCurrent.startsWith(compactDelta)) {
      return current;
    }
  }

  return `${current}${inferStreamingSeparator(current, delta)}${delta}`;
}

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
    previous?.stage === params.stage &&
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
      const nextOutput = mergeStreamingText(current.liveOutput, event.delta);
      return {
        ...current,
        liveOutput: nextOutput,
        traceItems: upsertTrace(current, {
          stage: "assistant",
          title: traceText.assistantMessage,
          detail: nextOutput,
          raw: {
            kind: "assistant_text_stream",
            text: nextOutput,
          },
        }),
      };
    case "assistant_reasoning_delta":
      // Preserve the streamed reasoning text verbatim. Trimming each chunk
      // destroys meaningful spaces/newlines and makes the intermediate UI look
      // corrupted until the final turn snapshot replaces it.
      const nextReasoning = mergeStreamingText(
        current.liveReasoning,
        event.delta,
      );
      return {
        ...current,
        liveReasoning: nextReasoning,
        traceItems: upsertTrace(current, {
          stage: "assistant",
          title: traceText.assistantThinking,
          detail: nextReasoning,
          raw: {
            kind: "assistant_reasoning_stream",
            text: nextReasoning,
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
          liveOutput: event.event.text ?? next.liveOutput,
          liveReasoning: event.event.reasoning ?? next.liveReasoning,
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
    liveReasoning: params.turn.reasoning_text || params.current.liveReasoning,
    phase:
      params.turn.status === "requires_input"
        ? "waiting"
        : params.turn.status === "failed"
          ? "failed"
          : "ready",
  };

  // Some failed turns currently come back without a normalized `events` array.
  // Keep the playground usable and show the real backend error instead of
  // throwing while hydrating the final turn snapshot.
  const turnEvents = Array.isArray(params.turn.events) ? params.turn.events : [];
  for (const event of turnEvents) {
    next = pushTraceItemIfNeeded(next, event, params.traceText);
  }

  return next;
}
