import { describe, expect, it } from "vitest";

import { groupMessages } from "./utils";

describe("groupMessages", () => {
  it("hides internal clarification cancellation patch messages", () => {
    const groups = groupMessages(
      [
        {
          id: "ai-1",
          type: "ai",
          content: "",
          tool_calls: [
            {
              id: "ask_clarification_from_text",
              name: "ask_clarification",
              args: {
                question: "你想要哪种交付物？",
                options: ["报告", "PPT"],
              },
            },
          ],
        },
        {
          id: "tool-1",
          type: "tool",
          name: "ask_clarification",
          tool_call_id: "ask_clarification_from_text",
          content:
            "Tool call ask_clarification with id ask_clarification_from_text was cancelled - another message came in before it could be completed.",
        },
        {
          id: "human-1",
          type: "human",
          content: "报告",
        },
      ] as never,
      (group) => group,
    );

    expect(groups.map((group) => group.type)).toEqual([
      "assistant:processing",
      "human",
    ]);
    expect(groups[0]?.messages).toHaveLength(1);
  });
});
