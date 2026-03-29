import type { AgentInterrupt } from "./types";

export type QuestionOption = {
  label: string;
  description?: string;
};

export type QuestionInfo = {
  header?: string;
  question: string;
  options: QuestionOption[];
  multiple: boolean;
  custom: boolean;
};

export type QuestionRequest = {
  kind: "question";
  requestId: string;
  originAgentName?: string;
  questions: QuestionInfo[];
};

export type QuestionReply = {
  requestId: string;
  answers: string[][];
  rejected: boolean;
};

export type QuestionToolResult = {
  kind: "question_result";
  request_id: string;
  status: "answered" | "rejected";
  answers: string[][];
  message: string;
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

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item))
    .filter((item): item is string => typeof item === "string");
}

function asAnswers(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asStringArray(item));
}

function asQuestionOption(value: unknown): QuestionOption | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const label = asString(record.label);
  if (!label) {
    return null;
  }

  return {
    label,
    description: asString(record.description),
  };
}

function asQuestionOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asQuestionOption(item))
    .filter((item): item is QuestionOption => item !== null);
}

function normalizeQuestionInfos(value: unknown): QuestionInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): QuestionInfo | null => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const question = asString(record.question);
      if (!question) {
        return null;
      }

      return {
        header: asString(record.header),
        question,
        options: asQuestionOptions(record.options),
        multiple: asBoolean(record.multiple, false),
        custom: asBoolean(record.custom, true),
      };
    })
    .filter((item): item is QuestionInfo => item !== null);
}

export function extractQuestionRequestFromArgs(
  args: Record<string, unknown> | unknown,
  requestId?: string,
): QuestionRequest | null {
  const values = asRecord(args);
  if (!values) {
    return null;
  }

  const questions = normalizeQuestionInfos(values.questions);
  if (questions.length === 0) {
    return null;
  }

  const resolvedRequestId =
    asString(values.request_id) ?? asString(values.requestId) ?? requestId;
  if (!resolvedRequestId) {
    return null;
  }

  return {
    kind: "question",
    requestId: resolvedRequestId,
    originAgentName:
      asString(values.origin_agent_name) ?? asString(values.originAgentName),
    questions,
  };
}

export function extractQuestionRequestFromInterrupt(
  interrupt: AgentInterrupt | unknown,
): QuestionRequest | null {
  const root = asRecord(interrupt);
  if (!root) {
    return null;
  }

  const value = "value" in root ? asRecord(root.value) : root;
  if (!value || value.kind !== "question") {
    return null;
  }

  return extractQuestionRequestFromArgs(value, asString(root.id));
}

export function extractQuestionRequestFromMessages(
  messages: readonly unknown[] | null | undefined,
): QuestionRequest | null {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const values = asRecord(message);
    if (!values || values.type !== "ai") {
      continue;
    }

    const toolCalls = values.tool_calls;
    if (!Array.isArray(toolCalls)) {
      continue;
    }

    for (let toolCallIndex = toolCalls.length - 1; toolCallIndex >= 0; toolCallIndex -= 1) {
      const toolCall = toolCalls[toolCallIndex];
      const record = asRecord(toolCall);
      if (!record || record.name !== "question") {
        continue;
      }

      const question = extractQuestionRequestFromArgs(
        record.args,
        asString(record.id),
      );
      if (question) {
        return question;
      }
    }
  }

  return null;
}

export function extractQuestionToolResult(
  content: unknown,
): QuestionToolResult | null {
  const text = asString(content);
  if (!text || !text.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as QuestionToolResult;
    if (
      parsed?.kind !== "question_result" ||
      typeof parsed.request_id !== "string" ||
      (parsed.status !== "answered" && parsed.status !== "rejected")
    ) {
      return null;
    }
    return {
      ...parsed,
      answers: asAnswers(parsed.answers),
      message:
        typeof parsed.message === "string" ? parsed.message : String(parsed),
    };
  } catch {
    return null;
  }
}

export function extractQuestionReplyFromMessages(
  messages: readonly unknown[] | null | undefined,
  requestId?: string,
): QuestionReply | null {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const values = asRecord(messages[index]);
    if (!values || values.type !== "tool") {
      continue;
    }

    const toolCallId = asString(values.tool_call_id);
    if (requestId && toolCallId && toolCallId !== requestId) {
      continue;
    }

    const result = extractQuestionToolResult(values.content);
    if (!result) {
      continue;
    }
    if (requestId && result.request_id !== requestId) {
      continue;
    }
    return {
      requestId: result.request_id,
      answers: result.answers,
      rejected: result.status === "rejected",
    };
  }

  return null;
}
