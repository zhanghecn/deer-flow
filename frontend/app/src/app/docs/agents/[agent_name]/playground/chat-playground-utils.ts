type ContentBlock =
  | { type: "text"; content: string }
  | {
      type: "tool_call";
      name: string;
      arguments?: unknown;
      output?: unknown;
      startedAt: number;
      completedAt?: number;
    };

export type ChatPlaygroundContentBlock = ContentBlock;

function findLastToolCallIndex(blocks: ContentBlock[]) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.type === "tool_call") {
      return index;
    }
  }
  return -1;
}

// Keep the assistant transcript in event order. Tool calls should stay where
// they happened, and the final answer should only replace a text block that was
// already emitted after the last tool call.
export function mergeFinalAssistantText(
  blocks: ContentBlock[],
  finalText: string,
): ContentBlock[] {
  const trimmed = finalText.trim();
  if (!trimmed) {
    return blocks;
  }

  const nextBlocks = [...blocks];
  const lastToolCallIndex = findLastToolCallIndex(nextBlocks);

  for (let index = nextBlocks.length - 1; index > lastToolCallIndex; index -= 1) {
    const candidate = nextBlocks[index];
    if (candidate?.type === "text") {
      nextBlocks[index] = { type: "text", content: trimmed };
      return nextBlocks;
    }
  }

  if (lastToolCallIndex === -1) {
    const lastBlock = nextBlocks[nextBlocks.length - 1];
    if (lastBlock?.type === "text") {
      nextBlocks[nextBlocks.length - 1] = { type: "text", content: trimmed };
      return nextBlocks;
    }
  }

  nextBlocks.push({ type: "text", content: trimmed });
  return nextBlocks;
}

// The public demo has to survive timestamp shape drift across environments.
// Some surfaces emit epoch seconds, others return epoch milliseconds or ISO
// strings. Normalize once so the playground trace never crashes on mixed data.
export function coerceTimestampMs(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.abs(value) >= 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) {
    return coerceTimestampMs(numericValue);
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatTraceTime(
  value: unknown,
  locale = "en-US",
): string {
  const timestampMs = coerceTimestampMs(value);
  if (timestampMs == null) {
    return "—";
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestampMs);
}

export function formatCalendarDate(
  value: unknown,
  locale = "en-US",
): string | null {
  const timestampMs = coerceTimestampMs(value);
  if (timestampMs == null) {
    return null;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestampMs);
}
