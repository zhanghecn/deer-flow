import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { DesignBoardSession } from "@/core/design-board/api";
import { publishDesignBoardRemoteMessage } from "@/core/design-board/embed";
import type { RuntimeWorkspaceSession } from "@/core/runtime-workspaces/api";

import {
  getStoredWorkspaceDockState,
  getStoredThreadWorkbenchHint,
  persistThreadWorkbenchHint,
  persistWorkspaceDockState,
} from "./storage";
import {
  summarizeDesignSelection,
  type DesignOpenIssueReason,
  type DesignSelectionContext,
  type WorkspaceEventEntry,
  type DesignSurfaceState,
  type RuntimeSurfaceState,
  type WorkspaceDockState,
  type WorkspaceSurface,
  type WorkspaceThreadHint,
} from "./types";

const OPENPENCIL_HOST_BRIDGE_SOURCE = "openpencil-host-bridge";

function normalizeBridgeSessionString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeBridgeSessionGeneration(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isDesignBridgePayloadForActiveSession(
  payload: Record<string, unknown>,
  session: DesignBoardSession | null,
): boolean {
  if (!session) {
    return false;
  }

  const payloadThreadID = normalizeBridgeSessionString(payload.threadId);
  if (payloadThreadID && payloadThreadID !== session.thread_id) {
    return false;
  }

  const payloadTargetPath = normalizeBridgeSessionString(payload.targetPath);
  if (payloadTargetPath && payloadTargetPath !== session.target_path) {
    return false;
  }

  const payloadSessionID = normalizeBridgeSessionString(payload.sessionId);
  if (payloadSessionID && payloadSessionID !== session.session_id) {
    return false;
  }

  const payloadSessionGeneration = normalizeBridgeSessionGeneration(
    payload.sessionGeneration,
  );
  if (
    payloadSessionGeneration !== null &&
    payloadSessionGeneration !== session.session_generation
  ) {
    return false;
  }

  return true;
}

type WorkspaceSurfaceContextType = {
  dockState: WorkspaceDockState;
  designState: DesignSurfaceState;
  runtimeState: RuntimeSurfaceState;
  designSelection: DesignSelectionContext | null;
  events: WorkspaceEventEntry[];
  threadHint: WorkspaceThreadHint | null;
  setDockOpen: (open: boolean) => void;
  setActiveSurface: (surface: WorkspaceSurface) => void;
  setDockWidthRatio: (widthRatio: number) => void;
  openSurface: (surface: WorkspaceSurface) => void;
  syncThread: (threadId: string) => void;
  noteDesignSession: (session: DesignBoardSession) => void;
  noteRuntimeSession: (session: RuntimeWorkspaceSession) => void;
  setDesignStatus: (
    status: DesignSurfaceState["status"],
    options?: {
      error?: string | null;
      revision?: string | null;
      targetPath?: string;
      lastActivityAt?: string | null;
      openIssue?: DesignOpenIssueReason | null;
    },
  ) => void;
  noteDesignPopupBlocked: (targetPath?: string) => void;
  setRuntimeStatus: (
    status: RuntimeSurfaceState["status"],
    options?: {
      error?: string | null;
      targetPath?: string;
    },
  ) => void;
  clearDesignSelection: () => void;
  setDesignSelection: (selection: DesignSelectionContext | null) => void;
  notePreviewArtifacts: (artifacts: string[]) => void;
  rememberThreadHint: (hint: {
    surface: WorkspaceSurface;
    artifactPath?: string;
    targetPath?: string;
  }) => void;
};

const WorkspaceSurfaceContext = createContext<
  WorkspaceSurfaceContextType | undefined
>(undefined);

function buildInitialDesignState(): DesignSurfaceState {
  return {
    session: null,
    status: "idle",
    target_path: undefined,
    revision: null,
    last_error: null,
    last_activity_at: null,
    open_issue: null,
  };
}

function buildInitialRuntimeState(): RuntimeSurfaceState {
  return {
    session: null,
    status: "idle",
    target_path: undefined,
    last_error: null,
  };
}

function normalizeSelectionPayload(
  payload: Record<string, unknown>,
): DesignSelectionContext | null {
  const targetPath =
    typeof payload.targetPath === "string" ? payload.targetPath.trim() : "";
  const selectedNodeIds = Array.isArray(payload.selectedIds)
    ? payload.selectedIds.filter(
        (value): value is string =>
          typeof value === "string" && value.trim() !== "",
      )
    : [];

  if (!targetPath) {
    return null;
  }

  const selectedNodes = Array.isArray(payload.selectedNodes)
    ? payload.selectedNodes
        .map((value) => {
          if (!value || typeof value !== "object") {
            return null;
          }
          const node = value as Record<string, unknown>;
          const id = typeof node.id === "string" ? node.id.trim() : "";
          if (!id) {
            return null;
          }
          const label =
            typeof node.label === "string" && node.label.trim() !== ""
              ? node.label.trim()
              : undefined;
          return { id, label };
        })
        .filter((value): value is NonNullable<typeof value> => value !== null)
    : undefined;

  const activeNodeId =
    typeof payload.activeId === "string" && payload.activeId.trim() !== ""
      ? payload.activeId.trim()
      : null;

  const selection: DesignSelectionContext = {
    surface: "design",
    target_path: targetPath,
    selected_node_ids: selectedNodeIds,
    active_node_id: activeNodeId,
    selected_nodes: selectedNodes,
  };
  return {
    ...selection,
    selection_summary: summarizeDesignSelection(selection),
  };
}

const MAX_WORKSPACE_EVENTS = 16;

function buildWorkspaceEventId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `workspace-event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function appendWorkspaceEvent(
  current: WorkspaceEventEntry[],
  nextEvent: WorkspaceEventEntry,
) {
  const previousEvent = current[current.length - 1];
  const comparablePreviousEvent = previousEvent
    ? {
        ...previousEvent,
        id: "",
        created_at: "",
      }
    : null;
  const comparableNextEvent = {
    ...nextEvent,
    id: "",
    created_at: "",
  };

  // Bridge-driven selection updates can fire multiple times for the same
  // canvas focus change. Collapse exact repeats so the message lane keeps only
  // meaningful state transitions instead of raw event spam.
  if (
    comparablePreviousEvent?.kind === comparableNextEvent.kind &&
    JSON.stringify(comparablePreviousEvent) ===
      JSON.stringify(comparableNextEvent)
  ) {
    return current;
  }

  const nextEvents = [...current, nextEvent];
  if (nextEvents.length <= MAX_WORKSPACE_EVENTS) {
    return nextEvents;
  }

  return nextEvents.slice(nextEvents.length - MAX_WORKSPACE_EVENTS);
}

export function WorkspaceSurfaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [dockState, setDockState] = useState<WorkspaceDockState>(() =>
    getStoredWorkspaceDockState(),
  );
  const [designState, setDesignState] = useState<DesignSurfaceState>(
    buildInitialDesignState,
  );
  const [runtimeState, setRuntimeState] = useState<RuntimeSurfaceState>(
    buildInitialRuntimeState,
  );
  const [designSelection, setDesignSelectionState] =
    useState<DesignSelectionContext | null>(null);
  const [events, setEvents] = useState<WorkspaceEventEntry[]>([]);
  const [threadHint, setThreadHint] = useState<WorkspaceThreadHint | null>(
    null,
  );
  const activeThreadIdRef = useRef<string | null>(null);
  const designSelectionRef = useRef<DesignSelectionContext | null>(null);

  const pushWorkspaceEvent = useCallback(
    (buildEvent: (id: string, createdAt: string) => WorkspaceEventEntry) => {
      const createdAt = new Date().toISOString();
      const id = buildWorkspaceEventId();
      setEvents((current) =>
        appendWorkspaceEvent(current, buildEvent(id, createdAt)),
      );
    },
    [],
  );

  const updateDockState = useCallback(
    (partial: Partial<WorkspaceDockState>) => {
      setDockState((current) => {
        const nextState = {
          ...current,
          ...partial,
        };
        persistWorkspaceDockState(partial);
        return nextState;
      });
    },
    [],
  );

  const setDockOpen = useCallback(
    (open: boolean) => {
      updateDockState({ open });
    },
    [updateDockState],
  );

  const setActiveSurface = useCallback(
    (activeSurface: WorkspaceSurface) => {
      updateDockState({ activeSurface });
    },
    [updateDockState],
  );

  const setDockWidthRatio = useCallback(
    (widthRatio: number) => {
      updateDockState({ widthRatio });
    },
    [updateDockState],
  );

  const openSurface = useCallback(
    (surface: WorkspaceSurface) => {
      updateDockState({
        open: true,
        activeSurface: surface,
      });
    },
    [updateDockState],
  );

  const rememberThreadHint = useCallback(
    (hint: {
      surface: WorkspaceSurface;
      artifactPath?: string;
      targetPath?: string;
    }) => {
      const activeThreadId = activeThreadIdRef.current;
      if (!activeThreadId) {
        return;
      }

      const persistedHint = persistThreadWorkbenchHint(activeThreadId, {
        surface: hint.surface,
        artifact_path: hint.artifactPath,
        target_path: hint.targetPath,
      });
      setThreadHint(persistedHint);
    },
    [],
  );

  const syncThread = useCallback((threadId: string) => {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      return;
    }
    const storedThreadHint = getStoredThreadWorkbenchHint(normalizedThreadId);
    if (activeThreadIdRef.current === null) {
      activeThreadIdRef.current = normalizedThreadId;
      setThreadHint(storedThreadHint);
      return;
    }
    if (activeThreadIdRef.current === normalizedThreadId) {
      return;
    }

    activeThreadIdRef.current = normalizedThreadId;
    setThreadHint(storedThreadHint);
    setDesignState(buildInitialDesignState());
    setRuntimeState(buildInitialRuntimeState());
    setDesignSelectionState(null);
    designSelectionRef.current = null;
    setEvents([]);
  }, []);

  const noteDesignSession = useCallback(
    (session: DesignBoardSession) => {
      setDesignState((current) => ({
        ...current,
        session,
        status: "loading",
        target_path: session.target_path,
        revision:
          (session as DesignBoardSession & { revision?: string | null })
            .revision ?? null,
        last_error: null,
        last_activity_at: new Date().toISOString(),
        open_issue: null,
      }));
      rememberThreadHint({
        surface: "design",
        artifactPath: session.target_path,
        targetPath: session.target_path,
      });
      openSurface("design");
    },
    [openSurface, rememberThreadHint],
  );

  const noteDesignPopupBlocked = useCallback(
    (targetPath?: string) => {
      setDesignState((current) => ({
        ...current,
        status: current.session ? current.status : "loading",
        target_path: targetPath ?? current.target_path,
        last_activity_at: new Date().toISOString(),
        open_issue: "popup_blocked",
      }));
      rememberThreadHint({
        surface: "design",
        artifactPath: targetPath,
        targetPath,
      });
      openSurface("design");
    },
    [openSurface, rememberThreadHint],
  );

  const noteRuntimeSession = useCallback(
    (session: RuntimeWorkspaceSession) => {
      setRuntimeState({
        session,
        status: "active",
        target_path: session.target_path,
        last_error: null,
      });
      rememberThreadHint({
        surface: "runtime",
        targetPath: session.target_path,
      });
      pushWorkspaceEvent((id, createdAt) => ({
        id,
        created_at: createdAt,
        kind: "runtime-opened",
        target_path: session.target_path,
        relative_url: session.relative_url,
      }));
    },
    [pushWorkspaceEvent, rememberThreadHint],
  );

  const setDesignStatus = useCallback(
    (
      status: DesignSurfaceState["status"],
      options?: {
        error?: string | null;
        revision?: string | null;
        targetPath?: string;
        lastActivityAt?: string | null;
        openIssue?: DesignOpenIssueReason | null;
      },
    ) => {
      setDesignState((current) => ({
        ...current,
        status,
        target_path: options?.targetPath ?? current.target_path,
        revision:
          options && "revision" in options
            ? options.revision
            : current.revision,
        last_error:
          options && "error" in options
            ? (options.error ?? null)
            : current.last_error,
        last_activity_at:
          options && "lastActivityAt" in options
            ? (options.lastActivityAt ?? null)
            : new Date().toISOString(),
        open_issue:
          options && "openIssue" in options
            ? (options.openIssue ?? null)
            : current.open_issue,
      }));
    },
    [],
  );

  const setRuntimeStatus = useCallback(
    (
      status: RuntimeSurfaceState["status"],
      options?: {
        error?: string | null;
        targetPath?: string;
      },
    ) => {
      setRuntimeState((current) => ({
        ...current,
        status,
        target_path: options?.targetPath ?? current.target_path,
        last_error:
          options && "error" in options
            ? (options.error ?? null)
            : current.last_error,
      }));
    },
    [],
  );

  const setDesignSelection = useCallback(
    (selection: DesignSelectionContext | null) => {
      if (!selection) {
        designSelectionRef.current = null;
        setDesignSelectionState(null);
        return;
      }

      const normalizedSelection = {
        ...selection,
        selection_summary: summarizeDesignSelection(selection),
      };
      designSelectionRef.current = normalizedSelection;
      setDesignSelectionState(normalizedSelection);
      rememberThreadHint({
        surface: "design",
        artifactPath: normalizedSelection.target_path,
        targetPath: normalizedSelection.target_path,
      });
      // Selection changes are high-frequency bridge events. Keep them available
      // for prompt context and dock state, but do not mirror them into the chat
      // timeline where they read as noisy, non-user-facing activity.
    },
    [rememberThreadHint],
  );

  const clearDesignSelection = useCallback(() => {
    designSelectionRef.current = null;
    setDesignSelectionState(null);
  }, []);

  const notePreviewArtifacts = useCallback(
    (artifacts: string[]) => {
      for (const artifactPath of artifacts) {
        pushWorkspaceEvent((id, createdAt) => ({
          id,
          created_at: createdAt,
          kind: "preview-updated",
          artifact_path: artifactPath,
        }));
      }
    },
    [pushWorkspaceEvent],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (!event.data || typeof event.data !== "object") {
        return;
      }

      const payload = event.data as Record<string, unknown>;
      if (payload.source !== OPENPENCIL_HOST_BRIDGE_SOURCE) {
        return;
      }

      const type = typeof payload.type === "string" ? payload.type.trim() : "";
      const messagePayload =
        payload.payload && typeof payload.payload === "object"
          ? (payload.payload as Record<string, unknown>)
          : {};
      if (
        !isDesignBridgePayloadForActiveSession(
          messagePayload,
          designState.session,
        )
      ) {
        return;
      }

      switch (type) {
        case "design.document.loaded": {
          setDesignStatus("ready", {
            revision:
              typeof messagePayload.revision === "string"
                ? messagePayload.revision
                : null,
            targetPath:
              typeof messagePayload.targetPath === "string"
                ? messagePayload.targetPath
                : undefined,
            error: null,
            openIssue: null,
          });
          return;
        }
        case "design.document.saved": {
          const targetPath =
            typeof messagePayload.targetPath === "string"
              ? messagePayload.targetPath
              : undefined;
          const revision =
            typeof messagePayload.revision === "string"
              ? messagePayload.revision
              : null;
          setDesignStatus("synced", {
            revision,
            targetPath,
            error: null,
            openIssue: null,
          });
          if (targetPath) {
            pushWorkspaceEvent((id, createdAt) => ({
              id,
              created_at: createdAt,
              kind: "design-saved",
              target_path: targetPath,
              revision,
            }));
          }
          if (designState.session && revision) {
            publishDesignBoardRemoteMessage(designState.session, {
              type: "design.remote.revision-available",
              revision,
            });
          }
          return;
        }
        case "design.document.dirty": {
          setDesignStatus(messagePayload.dirty ? "dirty" : "ready", {
            targetPath:
              typeof messagePayload.targetPath === "string"
                ? messagePayload.targetPath
                : undefined,
            openIssue: null,
          });
          return;
        }
        case "design.document.error": {
          const phase =
            typeof messagePayload.phase === "string"
              ? messagePayload.phase.trim()
              : "";
          setDesignStatus("error", {
            error:
              typeof messagePayload.error === "string"
                ? messagePayload.error
                : "Design bridge error",
            targetPath:
              typeof messagePayload.targetPath === "string"
                ? messagePayload.targetPath
                : undefined,
            openIssue: phase === "save" ? "sync_failed" : "open_failed",
          });
          return;
        }
        case "design.remote.conflict": {
          setDesignStatus("conflict", {
            error:
              typeof messagePayload.reason === "string"
                ? messagePayload.reason
                : null,
            revision:
              typeof messagePayload.revision === "string"
                ? messagePayload.revision
                : null,
            targetPath:
              typeof messagePayload.targetPath === "string"
                ? messagePayload.targetPath
                : undefined,
            openIssue: null,
          });
          return;
        }
        case "design.remote.session-expired": {
          setDesignStatus("error", {
            error:
              typeof messagePayload.error === "string"
                ? messagePayload.error
                : "Design session expired",
            revision:
              typeof messagePayload.revision === "string"
                ? messagePayload.revision
                : null,
            targetPath:
              typeof messagePayload.targetPath === "string"
                ? messagePayload.targetPath
                : undefined,
            openIssue: "session_expired",
          });
          return;
        }
        case "design.selection.changed": {
          setDesignSelection(normalizeSelectionPayload(messagePayload));
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [designState.session, pushWorkspaceEvent, setDesignSelection, setDesignStatus]);

  const value = useMemo<WorkspaceSurfaceContextType>(
    () => ({
      dockState,
      designState,
      runtimeState,
      designSelection,
      events,
      threadHint,
      setDockOpen,
      setActiveSurface,
      setDockWidthRatio,
      openSurface,
      syncThread,
      noteDesignSession,
      noteDesignPopupBlocked,
      noteRuntimeSession,
      setDesignStatus,
      setRuntimeStatus,
      clearDesignSelection,
      setDesignSelection,
      notePreviewArtifacts,
      rememberThreadHint,
    }),
    [
      clearDesignSelection,
      designSelection,
      designState,
      dockState,
      events,
      noteDesignSession,
      noteDesignPopupBlocked,
      notePreviewArtifacts,
      noteRuntimeSession,
      openSurface,
      rememberThreadHint,
      runtimeState,
      setActiveSurface,
      setDesignSelection,
      setDesignStatus,
      setDockOpen,
      setDockWidthRatio,
      setRuntimeStatus,
      syncThread,
      threadHint,
    ],
  );

  return (
    <WorkspaceSurfaceContext.Provider value={value}>
      {children}
    </WorkspaceSurfaceContext.Provider>
  );
}

export function useWorkspaceSurface() {
  const context = useContext(WorkspaceSurfaceContext);
  if (!context) {
    throw new Error(
      "useWorkspaceSurface must be used within a WorkspaceSurfaceProvider",
    );
  }
  return context;
}

export function useOptionalWorkspaceSurface() {
  return useContext(WorkspaceSurfaceContext);
}
