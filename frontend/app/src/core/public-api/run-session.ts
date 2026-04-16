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

function pushTraceItemIfNeeded(
  current: PublicAPIRunReadModel,
  event: PublicAPIRunEvent,
  traceText: PlaygroundTraceText,
): PublicAPIRunReadModel {
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
