import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesignSurfacePanel } from "./design-surface-panel";

const openDesignWorkbenchMock = vi.fn();

const mockWorkspaceSurface = vi.hoisted(() => ({
  designSelection: null,
  designState: {
    session: {
      access_token: "token-1",
      thread_id: "thread-1",
      session_id: "session-1",
      session_generation: 1,
      target_path: "/mnt/user-data/outputs/designs/canvas.op",
      revision: "rev-1",
      relative_url: "/openpencil/editor",
      expires_at: "2026-04-13T00:00:00Z",
    },
    status: "error" as const,
    target_path: "/mnt/user-data/outputs/designs/canvas.op",
    revision: "rev-1",
    last_error: null,
    last_activity_at: "2026-04-13T00:00:00Z",
    open_issue: "session_expired" as "session_expired" | "sync_failed",
  },
}));

vi.mock("@/core/workspace-surface/context", () => ({
  useWorkspaceSurface: () => mockWorkspaceSurface,
}));

vi.mock("./use-workbench-actions", () => ({
  useWorkbenchActions: () => ({
    isOpeningDesign: false,
    openDesignWorkbench: openDesignWorkbenchMock,
  }),
}));

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      workspace: {
        noDesignSurfaceTitle: "No design session yet",
        noDesignSurfaceDescription: "No design description",
        openDesignEditor: "Open design editor",
        designSurfaceTitle: "Design",
        noTargetFile: "No target file",
        designStatusIdle: "Idle",
        designStatusLoading: "Loading",
        designStatusReady: "Ready",
        designStatusDirty: "Dirty",
        designStatusSaving: "Saving",
        designStatusSynced: "Synced",
        designStatusConflict: "Conflict",
        designStatusError: "Error",
        selectedNodesLabel: "Selected nodes",
        designSurfaceDescription: "Design surface description",
        reopenDesignEditor: "Reopen editor tab",
        designSessionExpiredDescription: "Session expired",
        designPopupBlockedDescription: "Popup blocked",
        designOpenFailedDescription: "Open failed",
        designSyncFailedDescription: "Save or sync failed",
        designRevisionLabel: "Revision",
        designRevisionUnavailable: "Waiting",
        designLastActivityLabel: "Last activity",
        designLastActivityUnavailable: "No activity yet",
      },
    },
  }),
}));

describe("DesignSurfacePanel", () => {
  beforeEach(() => {
    mockWorkspaceSurface.designState.open_issue = "session_expired";
    openDesignWorkbenchMock.mockReset();
  });

  it("renders reason-specific recovery guidance for expired sessions", () => {
    render(<DesignSurfacePanel threadId="thread-1" />);

    expect(screen.getByText("Session expired")).toBeInTheDocument();
    expect(screen.queryByText("Popup blocked")).not.toBeInTheDocument();
  });

  it("renders sync-specific guidance for save failures from the active editor", () => {
    mockWorkspaceSurface.designState.open_issue = "sync_failed";

    render(<DesignSurfacePanel threadId="thread-1" />);

    expect(screen.getByText("Save or sync failed")).toBeInTheDocument();
    expect(screen.queryByText("Open failed")).not.toBeInTheDocument();
  });

  it("forces a fresh session when reopening after expiry", async () => {
    render(<DesignSurfacePanel threadId="thread-1" />);

    screen.getByRole("button", { name: "Reopen editor tab" }).click();

    expect(openDesignWorkbenchMock).toHaveBeenCalledWith({
      forceRefresh: true,
    });
  });
});
