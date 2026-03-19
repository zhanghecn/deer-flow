const DEFAULT_THREAD_ERROR =
  "Something went wrong while running the conversation.";

function parseJsonErrorMessage(input: string) {
  const value = input.trim();
  if (!value.startsWith("{") || !value.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      const candidate = parsed[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return null;
}

export function normalizeThreadError(error: unknown) {
  const message = extractErrorMessage(error);
  if (!message) {
    return DEFAULT_THREAD_ERROR;
  }

  const httpMatch = /^HTTP\s+(\d+):\s*(.+)$/i.exec(message);
  if (!httpMatch) {
    return parseJsonErrorMessage(message) ?? message;
  }

  const statusCode = httpMatch[1] ?? "";
  const rawBody = httpMatch[2] ?? "";
  const parsedBodyMessage = parseJsonErrorMessage(rawBody);
  if (!parsedBodyMessage) {
    return message;
  }

  if (parsedBodyMessage.startsWith(statusCode)) {
    return parsedBodyMessage;
  }

  return `${statusCode} ${parsedBodyMessage}`;
}
