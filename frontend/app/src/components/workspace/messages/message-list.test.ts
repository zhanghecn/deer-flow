import { describe, expect, it } from "vitest";

import {
  getSubtaskAggregateLabel,
  getSubtaskAggregateStatus,
} from "./message-list";

const t = {
  subtasks: {
    executing: (count: number) => `正在执行 ${count} 个子任务`,
    completedGroup: (count: number) => `已完成 ${count} 个子任务`,
    failedGroup: (count: number) => `${count} 个子任务执行失败`,
  },
} as never;

describe("subtask aggregate state", () => {
  it("shows completed label once all tasks finish", () => {
    const tasks = [
      { id: "task-1", status: "completed" as const },
      { id: "task-2", status: "completed" as const },
    ];

    expect(getSubtaskAggregateStatus(["task-1", "task-2"], tasks)).toBe(
      "completed",
    );
    expect(getSubtaskAggregateLabel(["task-1", "task-2"], tasks, t)).toBe(
      "已完成 2 个子任务",
    );
  });

  it("prefers failed state when any subtask fails", () => {
    const tasks = [
      { id: "task-1", status: "completed" as const },
      { id: "task-2", status: "failed" as const },
    ];

    expect(getSubtaskAggregateStatus(["task-1", "task-2"], tasks)).toBe(
      "failed",
    );
    expect(getSubtaskAggregateLabel(["task-1", "task-2"], tasks, t)).toBe(
      "2 个子任务执行失败",
    );
  });
});
