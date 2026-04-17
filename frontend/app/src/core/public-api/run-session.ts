import type {
  PublicAPIResponseEnvelope,
  PublicAPIRunEvent,
} from "./api";
import {
  buildTraceFromRunEvent,
  type PlaygroundTraceItem,
  type PlaygroundTraceText,
  type PublicAPINormalizedRunEvent,
} from "./events";

export type PublicAPIRunPhase = "ready" | "streaming" | "failed" | "waiting";

export type PublicAPIRunReadModel = {
  liveOutput: string;
  traceItems: PlaygroundTraceItem[];
  toolCallCount: number;
  responseId: string;
  response: PublicAPIResponseEnvelope | null;
  reasoningSummary: string;
  phase: PublicAPIRunPhase;
  seenEventKeys: string[];
};

export type PublicAPIReasoningEffort = "minimal" | "low" | "medium" | "high";

function buildFailedTraceItem(
  detail: string,
  raw: unknown,
): PlaygroundTraceItem {
  return {
    stage: "error",
    tone: "error",
    title: detail || "Run failed",
    detail: detail || undefined,
    timestamp: Date.now(),
    raw,
  };
}

function eventKey(event: PublicAPIRunEvent) {
  return `${event.type}:${event.event_index}`;
}

function shouldSkipLedgerTrace(event: PublicAPIRunEvent) {
  // Assistant deltas can arrive twice on the public SSE surface:
  // once as the OpenAI-compatible `response.output_text.delta`, and again
  // inside the canonical `response.run_event` ledger. The UI wants one
  // growing assistant block, not two parallel delta streams.
  return event.type === "assistant_delta";
}

function upsertAssistantDeltaTrace(
  current: PublicAPIRunReadModel,
  delta: string,
  traceText: PlaygroundTraceText,
) {
  const nextDetail = `${current.liveOutput}${delta}`;
  const nextTimestamp = Date.now();
  const previous = current.traceItems[current.traceItems.length - 1];

  if (
    previous &&
    previous.stage === "assistant" &&
    previous.tone === "assistant" &&
    previous.title === traceText.assistantMessage
  ) {
    const nextTraceItems = [...current.traceItems];
    nextTraceItems[nextTraceItems.length - 1] = {
      ...previous,
      detail: nextDetail,
      timestamp: nextTimestamp,
      raw: {
        kind: "assistant_delta_stream",
        text: nextDetail,
      },
    };
    return nextTraceItems;
  }

  return [
    ...current.traceItems,
    {
      stage: "assistant" as const,
      tone: "assistant" as const,
      title: traceText.assistantMessage,
      detail: nextDetail,
      timestamp: nextTimestamp,
      raw: {
        kind: "assistant_delta_stream",
        text: nextDetail,
      },
    },
  ];
}

function pushTraceItemIfNeeded(
  current: PublicAPIRunReadModel,
  event: PublicAPIRunEvent,
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
      event.type === "tool_started"
        ? current.toolCallCount + 1
        : current.toolCallCount,
  };
}

export function createPublicAPIRunReadModel(): PublicAPIRunReadModel {
  return {
    liveOutput: "",
    traceItems: [],
    toolCallCount: 0,
    responseId: "",
    response: null,
    reasoningSummary: "",
    phase: "ready",
    seenEventKeys: [],
  };
}

export function buildPublicAPIReasoningRequest(
  reasoningEnabled: boolean,
  reasoningEffort: PublicAPIReasoningEffort,
) {
  if (!reasoningEnabled) {
    return undefined;
  }

  return {
    effort: reasoningEffort,
    summary: "detailed" as const,
  };
}

export function extractPublicAPIReasoningSummary(
  response: PublicAPIResponseEnvelope | null | undefined,
) {
  if (!response?.output?.length) {
    return "";
  }

  const segments: string[] = [];
  for (const item of response.output) {
    if (item.type !== "reasoning" || !Array.isArray(item.summary)) {
      continue;
    }
    for (const summaryItem of item.summary) {
      if (summaryItem.type !== "summary_text") {
        continue;
      }
      const text = summaryItem.text?.trim();
      if (text) {
        segments.push(text);
      }
    }
  }
  return segments.join("\n\n").trim();
}

export function formatPublicAPIOutputText(
  response: PublicAPIResponseEnvelope | null,
  liveOutput: string,
) {
  if (!response?.output_text) {
    return liveOutput;
  }

  try {
    const parsed = JSON.parse(response.output_text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return response.output_text;
  }
}

export function applyNormalizedPublicAPIRunEvent(params: {
  current: PublicAPIRunReadModel;
  event: PublicAPINormalizedRunEvent;
  traceText: PlaygroundTraceText;
}): PublicAPIRunReadModel {
  const { current, event, traceText } = params;

  switch (event.kind) {
    case "run_started":
      return {
        ...current,
        responseId: event.responseId || current.responseId,
      };
    case "assistant_delta":
      return {
        ...current,
        liveOutput: `${current.liveOutput}${event.delta}`,
        traceItems: upsertAssistantDeltaTrace(
          current,
          event.delta,
          traceText,
        ),
      };
    case "ledger_event": {
      let next = pushTraceItemIfNeeded(current, event.event, traceText);
      if (event.event.type === "assistant_message" && event.event.text?.trim()) {
        next = {
          ...next,
          liveOutput: event.event.text.trim(),
        };
      }
      if (event.event.response_id?.trim()) {
        next = {
          ...next,
          responseId: event.event.response_id.trim(),
        };
      }
      if (event.event.type === "run_failed") {
        next = {
          ...next,
          phase: "failed",
        };
      }
      return next;
    }
    case "run_completed":
      return {
        ...current,
        responseId: event.responseId || current.responseId,
      };
    case "run_failed":
      // Some streaming paths surface only the normalized failure and omit a
      // matching ledger event, so synthesize one visible terminal trace item.
      return {
        ...current,
        phase: "failed",
        traceItems: [...current.traceItems, buildFailedTraceItem(event.detail, event.raw)],
      };
  }
}

export function applyPublicAPIResponseEnvelope(params: {
  current: PublicAPIRunReadModel;
  response: PublicAPIResponseEnvelope;
  traceText: PlaygroundTraceText;
}): PublicAPIRunReadModel {
  let next: PublicAPIRunReadModel = {
    ...params.current,
    response: params.response,
    responseId: params.response.id,
    reasoningSummary: extractPublicAPIReasoningSummary(params.response),
  };

  // Final response hydration may include the same run ledger the live stream
  // already carried. Keep the trace stable by only appending unseen events.
  for (const event of params.response.openagents?.run_events ?? []) {
    next = pushTraceItemIfNeeded(next, event, params.traceText);
  }

  if (params.response.output_text?.trim()) {
    next = {
      ...next,
      liveOutput: params.response.output_text.trim(),
    };
  }

  next = {
    ...next,
    phase:
      params.response.status === "incomplete"
        ? "waiting"
        : params.response.status === "completed"
          ? "ready"
          : params.current.phase,
  };

  return next;
}
