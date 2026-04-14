import { getLocalSettings, saveLocalSettings } from "@/core/settings/local";

import {
  DEFAULT_WORKSPACE_DOCK_STATE,
  DEFAULT_WORKSPACE_DOCK_WIDTH_RATIO,
  isWorkspaceSurface,
  type WorkspaceThreadHint,
  type WorkspaceDockState,
} from "./types";

const WORKSPACE_THREAD_HINTS_KEY = "openagents.workspace-thread-hints";
const MAX_STORED_THREAD_HINTS = 64;

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function readStoredThreadHints(): Record<string, WorkspaceThreadHint> {
  if (typeof window === "undefined") {
    return {};
  }

  const json = localStorage.getItem(WORKSPACE_THREAD_HINTS_KEY);
  if (!json) {
    return {};
  }

  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const nextHints: Record<string, WorkspaceThreadHint> = {};
    for (const [threadId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const entry = value as Record<string, unknown>;
      if (!isWorkspaceSurface(entry.surface)) {
        continue;
      }

      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        continue;
      }

      nextHints[normalizedThreadId] = {
        surface: entry.surface,
        artifact_path: normalizeOptionalString(entry.artifact_path),
        target_path: normalizeOptionalString(entry.target_path),
        updated_at:
          normalizeOptionalString(entry.updated_at) ??
          new Date(0).toISOString(),
      };
    }

    return nextHints;
  } catch {
    return {};
  }
}

function writeStoredThreadHints(
  nextHints: Record<string, WorkspaceThreadHint>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const orderedEntries = Object.entries(nextHints)
    .sort(
      ([, left], [, right]) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    )
    .slice(0, MAX_STORED_THREAD_HINTS);

  localStorage.setItem(
    WORKSPACE_THREAD_HINTS_KEY,
    JSON.stringify(Object.fromEntries(orderedEntries)),
  );
}

export function getStoredWorkspaceDockState(): WorkspaceDockState {
  const settings = getLocalSettings();
  const open =
    settings.layout.workspace_dock_open ?? DEFAULT_WORKSPACE_DOCK_STATE.open;
  const activeSurface = isWorkspaceSurface(
    settings.layout.workspace_dock_active_surface,
  )
    ? settings.layout.workspace_dock_active_surface
    : DEFAULT_WORKSPACE_DOCK_STATE.activeSurface;
  const widthRatio =
    typeof settings.layout.workspace_dock_width_ratio === "number" &&
    Number.isFinite(settings.layout.workspace_dock_width_ratio)
      ? settings.layout.workspace_dock_width_ratio
      : DEFAULT_WORKSPACE_DOCK_WIDTH_RATIO;

  return {
    open,
    activeSurface,
    widthRatio,
  };
}

export function persistWorkspaceDockState(
  nextState: Partial<WorkspaceDockState>,
): void {
  const settings = getLocalSettings();
  // Persist only layout preferences here. Thread-specific design/runtime state
  // must stay ephemeral so switching threads does not leak stale selections.
  saveLocalSettings({
    ...settings,
    layout: {
      ...settings.layout,
      ...(typeof nextState.open === "boolean"
        ? { workspace_dock_open: nextState.open }
        : {}),
      ...(nextState.activeSurface
        ? { workspace_dock_active_surface: nextState.activeSurface }
        : {}),
      ...(typeof nextState.widthRatio === "number"
        ? { workspace_dock_width_ratio: nextState.widthRatio }
        : {}),
    },
  });
}

export function getStoredThreadWorkbenchHint(
  threadId: string,
): WorkspaceThreadHint | null {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return null;
  }

  return readStoredThreadHints()[normalizedThreadId] ?? null;
}

export function persistThreadWorkbenchHint(
  threadId: string,
  hint: Pick<WorkspaceThreadHint, "surface" | "artifact_path" | "target_path">,
): WorkspaceThreadHint | null {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return null;
  }

  // Persist only a lightweight routing hint. The live design/runtime sessions
  // stay ephemeral so a refresh never revives a stale worker/browser binding.
  const nextHint: WorkspaceThreadHint = {
    surface: hint.surface,
    artifact_path: normalizeOptionalString(hint.artifact_path),
    target_path: normalizeOptionalString(hint.target_path),
    updated_at: new Date().toISOString(),
  };

  const nextHints = readStoredThreadHints();
  nextHints[normalizedThreadId] = nextHint;
  writeStoredThreadHints(nextHints);
  return nextHint;
}
