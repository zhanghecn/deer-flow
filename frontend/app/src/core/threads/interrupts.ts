import type { AgentInterrupt, AgentInterruptValue } from "./types";

export type ClarificationRequest = {
  question: string;
  context?: string;
  options: string[];
  clarificationType?: string;
};

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RecordValue;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item))
    .filter((item): item is string => typeof item === "string");
}

function getActionRequests(
  interrupt: AgentInterrupt | AgentInterruptValue | unknown,
): RecordValue[] {
  const root = asRecord(interrupt);
  if (!root) {
    return [];
  }

  const value = "value" in root ? asRecord(root.value) : root;
  if (!value) {
    return [];
  }

  const actionRequests = value.action_requests;
  if (!Array.isArray(actionRequests)) {
    return [];
  }

  return actionRequests
    .map((request) => asRecord(request))
    .filter((request): request is RecordValue => request !== null);
}

export function extractClarificationRequestFromArgs(
  args: Record<string, unknown> | unknown,
): ClarificationRequest | null {
  const values = asRecord(args);
  if (!values) {
    return null;
  }

  const question = asString(values.question);
  if (!question) {
    return null;
  }

  return {
    question,
    context: asString(values.context),
    options: asStringArray(values.options),
    clarificationType: asString(values.clarification_type),
  };
}

export function extractClarificationRequestFromInterrupt(
  interrupt: AgentInterrupt | unknown,
): ClarificationRequest | null {
  for (const request of getActionRequests(interrupt)) {
    if (request.name !== "ask_clarification") {
      continue;
    }
    const clarification = extractClarificationRequestFromArgs(request.args);
    if (clarification) {
      return clarification;
    }
  }
  return null;
}
