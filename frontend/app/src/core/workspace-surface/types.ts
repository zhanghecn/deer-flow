import type { DesignBoardSession } from "@/core/design-board/api";
import type { RuntimeWorkspaceSession } from "@/core/runtime-workspaces/api";

export type WorkspaceSurface = "preview" | "files" | "design" | "runtime";

export interface SurfaceContextPayload {
  surface: WorkspaceSurface;
  target_path?: string;
}

export interface DesignSelectionNode {
  id: string;
  label?: string;
}

export interface DesignSelectionContext extends SurfaceContextPayload {
  surface: "design";
  target_path: string;
  selected_node_ids: string[];
  active_node_id?: string | null;
  selected_nodes?: DesignSelectionNode[];
  selection_summary?: string;
}

export type DesignSurfaceStatus =
  | "idle"
  | "loading"
  | "ready"
  | "dirty"
  | "saving"
  | "synced"
  | "conflict"
  | "error";

export type DesignOpenIssueReason =
  | "popup_blocked"
  | "session_expired"
  | "open_failed"
  | "sync_failed";

export type RuntimeSurfaceStatus = "idle" | "opening" | "active" | "failed";

export interface DesignSurfaceState {
  session: DesignBoardSession | null;
  status: DesignSurfaceStatus;
  target_path?: string;
  revision?: string | null;
  last_error?: string | null;
  last_activity_at?: string | null;
  open_issue?: DesignOpenIssueReason | null;
}

export interface RuntimeSurfaceState {
  session: RuntimeWorkspaceSession | null;
  status: RuntimeSurfaceStatus;
  target_path?: string;
  last_error?: string | null;
}

export type WorkspaceEventKind =
  | "design-saved"
  | "runtime-opened"
  | "preview-updated";

interface WorkspaceEventBase {
  id: string;
  kind: WorkspaceEventKind;
  created_at: string;
}

export interface WorkspaceDesignSavedEvent extends WorkspaceEventBase {
  kind: "design-saved";
  target_path: string;
  revision?: string | null;
}

export interface WorkspaceRuntimeOpenedEvent extends WorkspaceEventBase {
  kind: "runtime-opened";
  target_path?: string;
  relative_url: string;
}

export interface WorkspacePreviewUpdatedEvent extends WorkspaceEventBase {
  kind: "preview-updated";
  artifact_path: string;
}

export type WorkspaceEventEntry =
  | WorkspaceDesignSavedEvent
  | WorkspaceRuntimeOpenedEvent
  | WorkspacePreviewUpdatedEvent;

export interface WorkspaceDockState {
  open: boolean;
  activeSurface: WorkspaceSurface;
  widthRatio: number;
}

export interface WorkspaceThreadHint {
  surface: WorkspaceSurface;
  artifact_path?: string;
  target_path?: string;
  updated_at: string;
}

export const DEFAULT_WORKSPACE_SURFACE: WorkspaceSurface = "preview";

export const DEFAULT_WORKSPACE_DOCK_WIDTH_RATIO = 38;

export const DEFAULT_WORKSPACE_DOCK_STATE: WorkspaceDockState = {
  open: false,
  activeSurface: DEFAULT_WORKSPACE_SURFACE,
  widthRatio: DEFAULT_WORKSPACE_DOCK_WIDTH_RATIO,
};

export function isWorkspaceSurface(value: unknown): value is WorkspaceSurface {
  return (
    value === "preview" ||
    value === "files" ||
    value === "design" ||
    value === "runtime"
  );
}

export function summarizeDesignSelection(
  selection: Pick<
    DesignSelectionContext,
    "selected_node_ids" | "selected_nodes" | "selection_summary"
  >,
): string | undefined {
  if (selection.selection_summary?.trim()) {
    return selection.selection_summary.trim();
  }

  const labeledNodes =
    selection.selected_nodes
      ?.map((node) => node.label?.trim())
      .filter(Boolean) ?? [];
  if (labeledNodes.length > 0) {
    return labeledNodes.slice(0, 3).join(", ");
  }

  const selectedCount = selection.selected_node_ids.length;
  if (selectedCount === 0) {
    return undefined;
  }
  if (selectedCount === 1) {
    return "1 selected node";
  }
  return `${selectedCount} selected nodes`;
}
