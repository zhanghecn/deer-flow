const DEFAULT_THREAD_ERROR =
  "Something went wrong while running the conversation.";

function parsePseudoJsonErrorMessage(input: string) {
  const value = input.trim();
  for (const key of ["message", "error", "detail"]) {
    const match = new RegExp(
      `['"]${key}['"]\\s*:\\s*(["'])([\\s\\S]*?)\\1`,
      "i",
    ).exec(value);
    const candidate = match?.[2]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

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

function unwrapErrorWrapper(input: string) {
  const match = /^([A-Za-z_][\w.]*)\((['"])([\s\S]*)\2\)$/.exec(input.trim());
  if (!match) {
    return null;
  }

  return match[3]
    ?.replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

function normalizeStructuredErrorMessage(input: string) {
  const match = /^(?:HTTP|Error code:)\s*(\d+)\s*[:\-]\s*(.+)$/i.exec(
    input.trim(),
  );
  if (!match) {
    return null;
  }

  const statusCode = match[1] ?? "";
  const rawBody = match[2] ?? "";
  const parsedBodyMessage =
    parseJsonErrorMessage(rawBody) ?? parsePseudoJsonErrorMessage(rawBody);
  if (!parsedBodyMessage) {
    return input;
  }

  if (parsedBodyMessage.startsWith(statusCode)) {
    return parsedBodyMessage;
  }

  return `${statusCode} ${parsedBodyMessage}`;
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

  const unwrapped = unwrapErrorWrapper(message) ?? message;
  const structuredMessage = normalizeStructuredErrorMessage(unwrapped);
  if (structuredMessage) {
    return structuredMessage;
  }

  return (
    parseJsonErrorMessage(unwrapped) ??
    parsePseudoJsonErrorMessage(unwrapped) ??
    unwrapped
  );
}
