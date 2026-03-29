import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadContext } from "./context";
import { QuestionDock } from "./question-dock";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      toolCalls: {
        questionTitle: "Need your input",
        questionProgress: (current: number, total: number) =>
          `${current} of ${total}`,
        questionHintMultiple: "Select one or more answers",
        questionHintSingle: "Select one answer",
        questionOptions: "Options",
        questionCustomAnswer: "Custom answer",
        questionReplyPlaceholder: "Type your answer",
        questionResumeError: "Could not submit answer",
        questionDismissError: "Could not dismiss question",
        questionDismissAction: "Dismiss",
        questionBackAction: "Back",
        questionNextAction: "Next",
        questionSubmitAction: "Submit",
      },
    },
  }),
}));

function buildInterrupt() {
  return {
    id: "question-1",
    value: {
      kind: "question",
      request_id: "question-1",
      questions: [
        {
          header: "Scope",
          question: "Which deliverable should I prepare?",
          options: [{ label: "Markdown files" }],
          multiple: false,
          custom: true,
        },
      ],
    },
  } as never;
}

describe("QuestionDock", () => {
  it("preserves the draft answer when the same question rerenders", async () => {
    const user = userEvent.setup();
    const resumeInterrupt = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <ThreadContext.Provider
        value={{
          thread: {} as never,
          resumeInterrupt,
        }}
      >
        <QuestionDock interrupt={buildInterrupt()} />
      </ThreadContext.Provider>,
    );

    const textarea = screen.getByPlaceholderText("Type your answer");
    await user.type(textarea, "按理论分类 markdown，并额外打包 zip");

    const submit = screen.getByRole("button", { name: "Submit" });
    await waitFor(() => expect(submit).toBeEnabled());

    rerender(
      <ThreadContext.Provider
        value={{
          thread: {} as never,
          resumeInterrupt,
        }}
      >
        <QuestionDock interrupt={buildInterrupt()} />
      </ThreadContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Type your answer")).toHaveValue(
        "按理论分类 markdown，并额外打包 zip",
      ),
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(resumeInterrupt).toHaveBeenCalledWith({
        resume: {
          request_id: "question-1",
          answers: [["按理论分类 markdown，并额外打包 zip"]],
        },
      });
    });
  });
});
