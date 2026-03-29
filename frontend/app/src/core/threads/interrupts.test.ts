import { describe, expect, it } from "vitest";

import {
  extractQuestionReplyFromMessages,
  extractQuestionRequestFromArgs,
  extractQuestionRequestFromMessages,
} from "./interrupts";

describe("question interrupts", () => {
  it("reads the question payload from AI tool calls", () => {
    expect(
      extractQuestionRequestFromMessages([
        {
          type: "ai",
          tool_calls: [
            {
              id: "question-1",
              name: "question",
              args: {
                request_id: "question-1",
                questions: [
                  {
                    header: "Sources",
                    question: "Which source set should I prioritize?",
                    options: [
                      {
                        label: "Public web only",
                        description: "Faster and easier to verify.",
                      },
                      {
                        label: "Books plus public web",
                        description: "Broader coverage with more effort.",
                      },
                    ],
                    multiple: false,
                    custom: true,
                  },
                ],
              },
            },
          ],
        },
      ]),
    ).toEqual({
      kind: "question",
      requestId: "question-1",
      originAgentName: undefined,
      questions: [
        {
          header: "Sources",
          question: "Which source set should I prioritize?",
          options: [
            {
              label: "Public web only",
              description: "Faster and easier to verify.",
            },
            {
              label: "Books plus public web",
              description: "Broader coverage with more effort.",
            },
          ],
          multiple: false,
          custom: true,
        },
      ],
    });
  });

  it("reads the strict question args shape", () => {
    expect(
      extractQuestionRequestFromArgs({
        request_id: "question-2",
        questions: [
          {
            question: "Which output should I prepare?",
            options: [{ label: "Report" }, { label: "Slides" }],
          },
        ],
      }),
    ).toEqual({
      kind: "question",
      requestId: "question-2",
      originAgentName: undefined,
      questions: [
        {
          header: undefined,
          question: "Which output should I prepare?",
          options: [
            { label: "Report", description: undefined },
            { label: "Slides", description: undefined },
          ],
          multiple: false,
          custom: true,
        },
      ],
    });
  });

  it("prefers the latest question call when an earlier attempt in the same group was invalid", () => {
    expect(
      extractQuestionRequestFromMessages([
        {
          type: "ai",
          tool_calls: [
            {
              id: "question-invalid",
              name: "question",
              args: {
                request_id: "question-invalid",
                questions: [
                  {
                    header: "Old",
                    question: "旧的问题",
                    options: [{ label: "其他" }],
                  },
                ],
              },
            },
          ],
        },
        {
          type: "tool",
          name: "question",
          tool_call_id: "question-invalid",
          content: "Error: invalid question payload",
        },
        {
          type: "ai",
          tool_calls: [
            {
              id: "question-valid",
              name: "question",
              args: {
                request_id: "question-valid",
                questions: [
                  {
                    header: "New",
                    question: "新的问题",
                    options: [{ label: "Markdown" }, { label: "Zip" }],
                  },
                ],
              },
            },
          ],
        },
        {
          type: "tool",
          name: "question",
          tool_call_id: "question-valid",
          content: JSON.stringify({
            kind: "question_result",
            request_id: "question-valid",
            status: "answered",
            answers: [["Markdown"]],
            message: "User answered.",
          }),
        },
      ]),
    ).toEqual({
      kind: "question",
      requestId: "question-valid",
      originAgentName: undefined,
      questions: [
        {
          header: "New",
          question: "新的问题",
          options: [
            { label: "Markdown", description: undefined },
            { label: "Zip", description: undefined },
          ],
          multiple: false,
          custom: true,
        },
      ],
    });
  });

  it("reads the structured reply from tool messages", () => {
    expect(
      extractQuestionReplyFromMessages([
        {
          type: "tool",
          name: "question",
          tool_call_id: "question-1",
          content: JSON.stringify({
            kind: "question_result",
            request_id: "question-1",
            status: "answered",
            answers: [["Markdown"], ["Public web only"]],
            message: "User answered.",
          }),
        },
      ]),
    ).toEqual({
      requestId: "question-1",
      answers: [["Markdown"], ["Public web only"]],
      rejected: false,
    });
  });
});
