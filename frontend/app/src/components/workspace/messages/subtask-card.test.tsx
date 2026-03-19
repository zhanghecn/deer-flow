import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubtaskCard } from "./subtask-card";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      subtasks: {
        in_progress: "Running subtask",
        completed: "Subtask completed",
        failed: "Subtask failed",
      },
    },
  }),
}));

describe("SubtaskCard", () => {
  it("renders completed subtasks with stronger success styling", () => {
    const { container } = render(
      <SubtaskCard
        taskId="task-1"
        fallbackTask={{
          status: "completed",
          description: "Review the contract",
          result: "Done",
        }}
        isLoading={false}
      />,
    );

    expect(screen.getAllByText("Subtask completed")[0]).toBeInTheDocument();
    expect(container.querySelector(".text-emerald-600")).toBeTruthy();
    expect(container.textContent).not.toContain("text-muted-foreground/65");
  });
});
