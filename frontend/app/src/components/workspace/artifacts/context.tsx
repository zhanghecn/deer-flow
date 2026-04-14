import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { useOptionalWorkspaceSurface } from "@/core/workspace-surface/context";
import { env } from "@/env";

export interface ArtifactPreviewTarget {
  filepath: string;
  page?: number;
  heading?: string;
  line?: number;
  locatorLabel?: string;
  revealSequence?: number;
}

export interface ArtifactsContextType {
  artifacts: string[];
  setArtifacts: (artifacts: string[]) => void;

  selectedArtifact: string | null;
  previewTarget: ArtifactPreviewTarget | null;
  autoSelect: boolean;
  select: (artifact: string, autoSelect?: boolean) => void;
  reveal: (target: ArtifactPreviewTarget) => void;
  deselect: () => void;
  reset: () => void;
  syncThread: (threadId: string) => void;

  open: boolean;
  autoOpen: boolean;
  setOpen: (open: boolean) => void;
}

const ArtifactsContext = createContext<ArtifactsContextType | undefined>(
  undefined,
);

interface ArtifactsProviderProps {
  children: ReactNode;
}

export function ArtifactsProvider({ children }: ArtifactsProviderProps) {
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] =
    useState<ArtifactPreviewTarget | null>(null);
  const revealSequenceRef = useRef(0);
  const activeThreadIdRef = useRef<string | null>(null);
  const [autoSelect, setAutoSelect] = useState(true);
  const [open, setOpen] = useState(env.VITE_STATIC_WEBSITE_ONLY === "true");
  const [autoOpen, setAutoOpen] = useState(true);
  const { setOpen: setSidebarOpen } = useSidebar();
  const workspaceSurface = useOptionalWorkspaceSurface();
  const openWorkspaceSurface = workspaceSurface?.openSurface;
  const syncWorkspaceThread = workspaceSurface?.syncThread;

  const select = useCallback(
    (artifact: string, autoSelect = false) => {
      setSelectedArtifact(artifact);
      setPreviewTarget((current) =>
        current?.filepath === artifact ? current : null,
      );
      openWorkspaceSurface?.("preview");
      if (env.VITE_STATIC_WEBSITE_ONLY !== "true") {
        setSidebarOpen(false);
      }
      if (!autoSelect) {
        setAutoSelect(false);
      }
    },
    [openWorkspaceSurface, setSidebarOpen, setSelectedArtifact, setAutoSelect],
  );

  const reveal = useCallback(
    (target: ArtifactPreviewTarget) => {
      revealSequenceRef.current += 1;
      setArtifacts((current) =>
        current.includes(target.filepath)
          ? current
          : [...current, target.filepath],
      );
      setSelectedArtifact(target.filepath);
      setPreviewTarget({
        ...target,
        revealSequence: revealSequenceRef.current,
      });
      setOpen(true);
      openWorkspaceSurface?.("preview");
      if (env.VITE_STATIC_WEBSITE_ONLY !== "true") {
        setSidebarOpen(false);
      }
      setAutoOpen(false);
      setAutoSelect(false);
    },
    [openWorkspaceSurface, setSidebarOpen],
  );

  const deselect = useCallback(() => {
    setSelectedArtifact(null);
    setPreviewTarget(null);
    setAutoSelect(true);
  }, []);

  const reset = useCallback(() => {
    setArtifacts([]);
    setSelectedArtifact(null);
    setPreviewTarget(null);
    setAutoSelect(true);
    setAutoOpen(true);
    setOpen(env.VITE_STATIC_WEBSITE_ONLY === "true");
  }, []);

  const syncThread = useCallback(
    (threadId: string) => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return;
      }
      if (activeThreadIdRef.current === null) {
        activeThreadIdRef.current = normalizedThreadId;
        syncWorkspaceThread?.(normalizedThreadId);
        return;
      }
      if (activeThreadIdRef.current === normalizedThreadId) {
        return;
      }
      activeThreadIdRef.current = normalizedThreadId;
      syncWorkspaceThread?.(normalizedThreadId);
      reset();
    },
    [reset, syncWorkspaceThread],
  );

  const value: ArtifactsContextType = {
    artifacts,
    setArtifacts,

    open,
    autoOpen,
    autoSelect,
    setOpen: (isOpen: boolean) => {
      if (!isOpen && autoOpen) {
        setAutoOpen(false);
        setAutoSelect(false);
      }
      setOpen(isOpen);
    },

    selectedArtifact,
    previewTarget,
    select,
    reveal,
    deselect,
    reset,
    syncThread,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}

export function useArtifacts() {
  const context = useContext(ArtifactsContext);
  if (context === undefined) {
    throw new Error("useArtifacts must be used within an ArtifactsProvider");
  }
  return context;
}
