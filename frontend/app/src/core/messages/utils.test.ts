import { describe, expect, it } from "vitest";

import { extractNextStepsFromText, groupMessages } from "./utils";

describe("groupMessages", () => {
  it("keeps question summaries after the tool result arrives", () => {
    const groups = groupMessages(
      [
        {
          id: "ai-1",
          type: "ai",
          content: "",
          tool_calls: [
            {
              id: "question_from_text",
              name: "question",
              args: {
                request_id: "question_from_text",
                questions: [
                  {
                    question: "你想要哪种交付物？",
                    options: [{ label: "报告" }, { label: "PPT" }],
                  },
                ],
              },
            },
          ],
        },
        {
          id: "tool-1",
          type: "tool",
          name: "question",
          tool_call_id: "question_from_text",
          content: JSON.stringify({
            kind: "question_result",
            request_id: "question_from_text",
            status: "answered",
            answers: [["报告"]],
            message: "User answered.",
          }),
        },
      ] as never,
      (group) => group,
    );

    expect(groups.map((group) => group.type)).toEqual([
      "assistant:processing",
      "assistant:question",
    ]);
    expect(groups[0]?.messages).toHaveLength(1);
    expect(groups[1]?.messages).toHaveLength(2);
  });

  it("does not surface invalid question tool failures as question summaries", () => {
    const groups = groupMessages(
      [
        {
          id: "ai-1",
          type: "ai",
          content: "",
          tool_calls: [
            {
              id: "question_invalid",
              name: "question",
              args: {
                request_id: "question_invalid",
                questions: [
                  {
                    question: "你想要哪种交付物？",
                    options: [{ label: "报告" }, { label: "其他" }],
                  },
                ],
              },
            },
          ],
        },
        {
          id: "tool-1",
          type: "tool",
          name: "question",
          tool_call_id: "question_invalid",
          content:
            'Error: Do not use catch-all options such as "Other"; the UI already provides typed custom input.',
        },
      ] as never,
      (group) => group,
    );

    expect(groups.map((group) => group.type)).toEqual([
      "assistant:processing",
    ]);
    expect(groups[0]?.messages).toHaveLength(2);
  });
});

describe("extractNextStepsFromText", () => {
  it("keeps explicit runtime targets from next_steps JSON", () => {
    const steps = extractNextStepsFromText(`
<next_steps>
[
  {
    "label": "测试 agent",
    "prompt": "切换到 contract-review-agent 智能体并开始测试",
    "agent_name": "contract-review-agent",
    "agent_status": "dev",
    "new_chat": true
  }
]
</next_steps>
`);

    expect(steps).toEqual([
      {
        label: "测试 agent",
        prompt: "切换到 contract-review-agent 智能体并开始测试",
        agent_name: "contract-review-agent",
        agent_status: "dev",
        new_chat: true,
      },
    ]);
  });

  it("does not infer agent targets from prompt text when next_steps omits them", () => {
    const steps = extractNextStepsFromText(`
<next_steps>
[
  {
    "label": "测试 agent",
    "prompt": "切换到 contract-review-agent 智能体并开始测试",
    "new_chat": true
  }
]
</next_steps>
`);

    expect(steps).toEqual([
      {
        label: "测试 agent",
        prompt: "切换到 contract-review-agent 智能体并开始测试",
        new_chat: true,
      },
    ]);
  });
});
