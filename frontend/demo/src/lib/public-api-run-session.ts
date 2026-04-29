import type { PublicAPITurnSnapshot } from "./public-api";
import type { PublicAPINormalizedRunEvent } from "./public-api-events";

export type PublicAPIRunPhase = "ready" | "streaming" | "failed" | "waiting";

export type PublicAPIRunReadModel = {
  liveOutput: string;
  liveReasoning: string;
  turnId: string;
  turn: PublicAPITurnSnapshot | null;
  phase: PublicAPIRunPhase;
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

  if (
    (isSentenceBoundary(last) || last === '"' || last === "”") &&
    isAsciiWordChar(first)
  ) {
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
    if (compactDelta === compactCurrent && delta.length >= current.length) {
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

export function createPublicAPIRunReadModel(): PublicAPIRunReadModel {
  return {
    liveOutput: "",
    liveReasoning: "",
    turnId: "",
    turn: null,
    phase: "ready",
  };
}

export function applyNormalizedPublicAPIRunEvent(params: {
  current: PublicAPIRunReadModel;
  event: PublicAPINormalizedRunEvent;
}): PublicAPIRunReadModel {
  const { current, event } = params;

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
        liveOutput: mergeStreamingText(current.liveOutput, event.delta),
      };
    case "assistant_reasoning_delta":
      // Preserve streamed reasoning verbatim. Trimming chunks destroys
      // meaningful spaces/newlines until the final turn snapshot arrives.
      return {
        ...current,
        liveReasoning: mergeStreamingText(current.liveReasoning, event.delta),
      };
    case "ledger_event": {
      const turnId = event.event.turn_id?.trim();
      let phase = current.phase;
      if (event.event.type === "turn.requires_input") {
        phase = "waiting";
      } else if (event.event.type === "turn.failed") {
        phase = "failed";
      } else if (event.event.type === "turn.completed") {
        phase = "ready";
      }
      return {
        ...current,
        turnId: turnId || current.turnId,
        liveOutput:
          event.event.type === "assistant.message.completed"
            ? (event.event.text ?? current.liveOutput)
            : current.liveOutput,
        liveReasoning:
          event.event.type === "assistant.message.completed"
            ? (event.event.reasoning ?? current.liveReasoning)
            : current.liveReasoning,
        phase,
      };
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
      };
  }
}

export function applyPublicAPITurnSnapshot(params: {
  current: PublicAPIRunReadModel;
  turn: PublicAPITurnSnapshot;
}): PublicAPIRunReadModel {
  return {
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
}
