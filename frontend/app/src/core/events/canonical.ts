export const CANONICAL_RUN_EVENT_TYPES = [
  "run_started",
  "assistant_delta",
  "assistant_message",
  "tool_started",
  "tool_finished",
  "question_requested",
  "question_answered",
  "run_completed",
  "run_failed",
] as const;

export type CanonicalRunEventType =
  (typeof CANONICAL_RUN_EVENT_TYPES)[number];

type CanonicalRunEventBase = {
  event_index: number;
  created_at: number;
  type: CanonicalRunEventType;
  response_id?: string;
};

export type CanonicalRunStartedEvent = CanonicalRunEventBase & {
  type: "run_started";
  response_id: string;
};

export type CanonicalAssistantDeltaEvent = CanonicalRunEventBase & {
  type: "assistant_delta";
  delta: string;
};

export type CanonicalAssistantMessageEvent = CanonicalRunEventBase & {
  type: "assistant_message";
  text: string;
  response_id: string;
};

export type CanonicalToolStartedEvent = CanonicalRunEventBase & {
  type: "tool_started";
  tool_name: string;
};

export type CanonicalToolFinishedEvent = CanonicalRunEventBase & {
  type: "tool_finished";
  tool_name?: string;
};

export type CanonicalQuestionRequestedEvent = CanonicalRunEventBase & {
  type: "question_requested";
  question_id?: string;
  text?: string;
};

export type CanonicalQuestionAnsweredEvent = CanonicalRunEventBase & {
  type: "question_answered";
  question_id?: string;
  text?: string;
};

export type CanonicalRunCompletedEvent = CanonicalRunEventBase & {
  type: "run_completed";
  response_id: string;
};

export type CanonicalRunFailedEvent = CanonicalRunEventBase & {
  type: "run_failed";
  error?: string;
  response_id?: string;
};

// Keep the frontend's first canonical event union small and serializable so
// public adapters and later QueryEngine-backed workspace consumers can share
// one naming contract before the deeper runtime migration lands.
export type CanonicalRunEvent =
  | CanonicalRunStartedEvent
  | CanonicalAssistantDeltaEvent
  | CanonicalAssistantMessageEvent
  | CanonicalToolStartedEvent
  | CanonicalToolFinishedEvent
  | CanonicalQuestionRequestedEvent
  | CanonicalQuestionAnsweredEvent
  | CanonicalRunCompletedEvent
  | CanonicalRunFailedEvent;

export function isCanonicalRunEventType(
  value: string,
): value is CanonicalRunEventType {
  return (CANONICAL_RUN_EVENT_TYPES as readonly string[]).includes(value);
}
