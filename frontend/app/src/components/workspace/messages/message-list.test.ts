import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  MessageList,
  buildTaskStatusUpdate,
  collectSupplementalImageArtifacts,
  getSubtaskAggregateLabel,
  getSubtaskAggregateStatus,
} from "./message-list";

vi.mock("@/core/workspace-surface/context", () => ({
  useOptionalWorkspaceSurface: () => ({
    events: [
      {
        id: "event-1",
        kind: "design-saved",
        created_at: "2026-04-12T10:20:00.000Z",
        target_path: "/mnt/user-data/outputs/designs/canvas.op",
        revision: "rev-2",
      },
    ],
  }),
}));

vi.mock("@/components/workspace/surfaces/use-workbench-actions", () => ({
  useWorkbenchActions: () => ({
    openArtifactWorkspace: vi.fn(),
    openDesignWorkbench: vi.fn(),
    openRuntimeWorkbench: vi.fn(),
  }),
}));

vi.mock("@/components/workspace/artifacts", () => ({
  useArtifacts: () => ({
    artifacts: [],
    setOpen: vi.fn(),
    autoOpen: false,
    autoSelect: false,
    selectedArtifact: null,
    select: vi.fn(),
  }),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "en-US",
    t: {
      subtasks: {
        executing: (count: number) => `正在执行 ${count} 个子任务`,
        completedGroup: (count: number) => `已完成 ${count} 个子任务`,
        failedGroup: (count: number) => `${count} 个子任务执行失败`,
      },
      workspace: {
        eventDesignSaved: "Design saved",
        eventRuntimeOpened: "Runtime opened",
        eventPreviewUpdated: "Preview updated",
        eventSelectedNodesCount: (count: number) => `${count} selected nodes`,
      },
    },
  }),
}));

const t = {
  subtasks: {
    executing: (count: number) => `正在执行 ${count} 个子任务`,
    completedGroup: (count: number) => `已完成 ${count} 个子任务`,
    failedGroup: (count: number) => `${count} 个子任务执行失败`,
  },
} as never;

describe("subtask aggregate state", () => {
  it("treats non-prefixed task tool output as a completed subtask result", () => {
    expect(
      buildTaskStatusUpdate("task-1", "Reviewed the source material."),
    ).toEqual({
      id: "task-1",
      status: "completed",
      result: "Reviewed the source material.",
    });
  });

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

  it("surfaces sibling output images next to a presented primary artifact", () => {
    expect(
      collectSupplementalImageArtifacts(
        ["/mnt/user-data/outputs/fortune-capsule/index.html"],
        [
          "/mnt/user-data/outputs/fortune-capsule/index.html",
          "/mnt/user-data/outputs/fortune-capsule/aurora-forest.jpg",
          "/mnt/user-data/outputs/fortune-capsule/crystal-sphere.jpg",
          "/mnt/user-data/outputs/other-run/skip-me.jpg",
        ],
      ),
    ).toEqual([
      "/mnt/user-data/outputs/fortune-capsule/aurora-forest.jpg",
      "/mnt/user-data/outputs/fortune-capsule/crystal-sphere.jpg",
    ]);
  });

  it("renders workspace event cards from explicit workspace events", () => {
    render(
      React.createElement(MessageList, {
        threadId: "thread-1",
        thread: {
          messages: [],
          isLoading: false,
          isThreadLoading: false,
        } as never,
        paddingBottom: 0,
      }),
    );

    expect(screen.getByText("Design saved")).toBeInTheDocument();
    expect(screen.getByText("canvas.op")).toBeInTheDocument();
  });
});
