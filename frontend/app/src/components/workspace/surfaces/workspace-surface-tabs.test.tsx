import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Tabs } from "@/components/ui/tabs";

import { WorkspaceSurfaceTabs } from "./workspace-surface-tabs";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      common: {
        preview: "Preview",
      },
      workspace: {
        closeWorkspaceDock: "Close workspace",
        filesSurfaceTitle: "Files",
        runtimeSurfaceTitle: "Runtime",
        runtimeStatusIdle: "Idle",
        runtimeStatusOpening: "Opening",
        runtimeStatusActive: "Active",
        runtimeStatusFailed: "Failed",
      },
    },
  }),
}));

describe("WorkspaceSurfaceTabs", () => {
  it("shows file count and runtime status without the retired design tab", () => {
    render(
      <Tabs value="files">
        <WorkspaceSurfaceTabs
          visibleArtifactCount={2}
          runtimeStatus="active"
          onSelectSurface={vi.fn()}
          onClose={vi.fn()}
        />
      </Tabs>,
    );

    expect(
      screen.queryByRole("tab", { name: /Design/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Files/i })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
