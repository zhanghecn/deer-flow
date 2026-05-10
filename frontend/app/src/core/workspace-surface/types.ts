import type { RuntimeWorkspaceSession } from "@/core/runtime-workspaces/api";

export type WorkspaceSurface = "preview" | "files" | "runtime";

export interface SurfaceContextPayload {
  surface: WorkspaceSurface;
  target_path?: string;
}

export type RuntimeSurfaceStatus = "idle" | "opening" | "active" | "failed";

export interface RuntimeSurfaceState {
  session: RuntimeWorkspaceSession | null;
  status: RuntimeSurfaceStatus;
  target_path?: string;
  last_error?: string | null;
}

export type WorkspaceEventKind = "runtime-opened" | "preview-updated";

interface WorkspaceEventBase {
  id: string;
  kind: WorkspaceEventKind;
  created_at: string;
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
  return value === "preview" || value === "files" || value === "runtime";
}
