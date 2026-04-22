import { describe, expect, it } from "vitest";

import {
  coerceTimestampMs,
  formatTraceTime,
  mergeFinalAssistantText,
  type ChatPlaygroundContentBlock,
} from "./chat-playground-utils";

describe("mergeFinalAssistantText", () => {
  it("appends the final answer after tool calls instead of moving it to the top", () => {
    const blocks: ChatPlaygroundContentBlock[] = [
      {
        type: "tool_call",
        name: "search_cases",
        arguments: { query: "夏仲奇" },
        startedAt: 1,
        completedAt: 2,
      },
    ];

    expect(mergeFinalAssistantText(blocks, "最终答案")).toEqual([
      {
        type: "tool_call",
        name: "search_cases",
        arguments: { query: "夏仲奇" },
        startedAt: 1,
        completedAt: 2,
      },
      { type: "text", content: "最终答案" },
    ]);
  });

  it("updates the existing post-tool text block when the answer already started streaming", () => {
    const blocks: ChatPlaygroundContentBlock[] = [
      {
        type: "tool_call",
        name: "read_file",
        arguments: { path: "/mnt/user-data/uploads/demo.md" },
        startedAt: 1,
        completedAt: 2,
      },
      { type: "text", content: "partial answer" },
    ];

    expect(mergeFinalAssistantText(blocks, "final answer")).toEqual([
      {
        type: "tool_call",
        name: "read_file",
        arguments: { path: "/mnt/user-data/uploads/demo.md" },
        startedAt: 1,
        completedAt: 2,
      },
      { type: "text", content: "final answer" },
    ]);
  });

  it("keeps any pre-tool preamble text while still appending the final answer last", () => {
    const blocks: ChatPlaygroundContentBlock[] = [
      { type: "text", content: "先检查资料。" },
      {
        type: "tool_call",
        name: "glob_files",
        arguments: { pattern: "Final_*" },
        startedAt: 1,
        completedAt: 2,
      },
    ];

    expect(mergeFinalAssistantText(blocks, "这里是最终答案")).toEqual([
      { type: "text", content: "先检查资料。" },
      {
        type: "tool_call",
        name: "glob_files",
        arguments: { pattern: "Final_*" },
        startedAt: 1,
        completedAt: 2,
      },
      { type: "text", content: "这里是最终答案" },
    ]);
  });
});

describe("coerceTimestampMs", () => {
  it("treats smaller numeric timestamps as epoch seconds", () => {
    expect(coerceTimestampMs(1_713_110_400)).toBe(1_713_110_400_000);
  });

  it("preserves epoch milliseconds and parses ISO strings", () => {
    expect(coerceTimestampMs(1_713_110_400_123)).toBe(1_713_110_400_123);
    expect(coerceTimestampMs("2026-04-11T00:00:00Z")).toBe(
      Date.parse("2026-04-11T00:00:00Z"),
    );
  });

  it("returns null for empty or invalid values", () => {
    expect(coerceTimestampMs("")).toBeNull();
    expect(coerceTimestampMs("not-a-date")).toBeNull();
    expect(coerceTimestampMs(undefined)).toBeNull();
  });
});

describe("formatTraceTime", () => {
  it("falls back to an em dash when the timestamp is invalid", () => {
    expect(formatTraceTime("not-a-date")).toBe("—");
  });
});
