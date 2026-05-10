import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { RuntimeWorkspaceSession } from "@/core/runtime-workspaces/api";

import {
  getStoredWorkspaceDockState,
  getStoredThreadWorkbenchHint,
  persistThreadWorkbenchHint,
  persistWorkspaceDockState,
} from "./storage";
import type {
  RuntimeSurfaceState,
  WorkspaceDockState,
  WorkspaceEventEntry,
  WorkspaceSurface,
  WorkspaceThreadHint,
} from "./types";

type WorkspaceSurfaceContextType = {
  dockState: WorkspaceDockState;
  runtimeState: RuntimeSurfaceState;
  events: WorkspaceEventEntry[];
  threadHint: WorkspaceThreadHint | null;
  setDockOpen: (open: boolean) => void;
  setActiveSurface: (surface: WorkspaceSurface) => void;
  setDockWidthRatio: (widthRatio: number) => void;
  openSurface: (surface: WorkspaceSurface) => void;
  syncThread: (threadId: string) => void;
  noteRuntimeSession: (session: RuntimeWorkspaceSession) => void;
  setRuntimeStatus: (
    status: RuntimeSurfaceState["status"],
    options?: {
      error?: string | null;
      targetPath?: string;
    },
  ) => void;
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

function buildInitialRuntimeState(): RuntimeSurfaceState {
  return {
    session: null,
    status: "idle",
    target_path: undefined,
    last_error: null,
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

  // Tool discovery can report the same artifact repeatedly during a long run.
  // Collapse exact repeats so the message lane shows meaningful state changes.
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
  const [runtimeState, setRuntimeState] = useState<RuntimeSurfaceState>(
    buildInitialRuntimeState,
  );
  const [events, setEvents] = useState<WorkspaceEventEntry[]>([]);
  const [threadHint, setThreadHint] = useState<WorkspaceThreadHint | null>(
    null,
  );
  const activeThreadIdRef = useRef<string | null>(null);

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
    setRuntimeState(buildInitialRuntimeState());
    setEvents([]);
  }, []);

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

  const value = useMemo<WorkspaceSurfaceContextType>(
    () => ({
      dockState,
      runtimeState,
      events,
      threadHint,
      setDockOpen,
      setActiveSurface,
      setDockWidthRatio,
      openSurface,
      syncThread,
      noteRuntimeSession,
      setRuntimeStatus,
      notePreviewArtifacts,
      rememberThreadHint,
    }),
    [
      dockState,
      events,
      notePreviewArtifacts,
      noteRuntimeSession,
      openSurface,
      rememberThreadHint,
      runtimeState,
      setActiveSurface,
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
