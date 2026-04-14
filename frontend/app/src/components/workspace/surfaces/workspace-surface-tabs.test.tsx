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
        designSurfaceTitle: "Design",
        designStatusIdle: "Idle",
        designStatusLoading: "Loading",
        designStatusReady: "Ready",
        designStatusDirty: "Dirty",
        designStatusSaving: "Saving",
        designStatusSynced: "Synced",
        designStatusConflict: "Conflict",
        designStatusError: "Error",
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
  it("keeps the Design surface visible with its own status badge", () => {
    render(
      <Tabs value="design">
        <WorkspaceSurfaceTabs
          designStatus="conflict"
          visibleArtifactCount={2}
          runtimeStatus="idle"
          onSelectSurface={vi.fn()}
          onClose={vi.fn()}
        />
      </Tabs>,
    );

    expect(screen.getByRole("tab", { name: /Design/i })).toBeInTheDocument();
    expect(screen.getByText("Conflict")).toBeInTheDocument();
  });
});
