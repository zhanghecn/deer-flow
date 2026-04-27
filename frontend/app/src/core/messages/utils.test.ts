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

  it("keeps the final assistant text visible when the same ai message also carries tool calls", () => {
    const groups = groupMessages(
      [
        {
          id: "ai-1",
          type: "ai",
          content: "最终结论：命盘偏财旺。",
          tool_calls: [
            {
              id: "grep-1",
              name: "grep",
              args: {
                pattern: "偏财",
                path: "/mnt/user-data/cases",
              },
            },
          ],
        },
        {
          id: "tool-1",
          type: "tool",
          name: "grep",
          tool_call_id: "grep-1",
          content: "matched",
        },
      ] as never,
      (group) => group,
    );

    expect(groups.map((group) => group.type)).toEqual([
      "assistant:processing",
      "assistant",
    ]);
    expect(groups[1]?.messages[0]?.content).toBe("最终结论：命盘偏财旺。");
  });

  it("keeps adjacent subagent chunks in one group for cumulative reasoning merge", () => {
    const groups = groupMessages(
      [
        {
          id: "ai-task-1",
          type: "ai",
          content: [
            {
              type: "thinking",
              thinking: "先读取技能。",
            },
          ],
          tool_calls: [
            {
              id: "task-1",
              name: "task",
              args: { description: "查资料", prompt: "查资料" },
            },
          ],
        },
        {
          id: "ai-task-2",
          type: "ai",
          content: [
            {
              type: "thinking",
              thinking: "先读取技能。\n然后调用知识库工具。",
            },
          ],
          tool_calls: [
            {
              id: "task-2",
              name: "task",
              args: { description: "继续查资料", prompt: "继续查资料" },
            },
          ],
        },
      ] as never,
      (group) => group,
    );

    expect(groups.map((group) => group.type)).toEqual(["assistant:subagent"]);
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
