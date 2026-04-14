import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useThreadOutputArtifacts } from "@/core/artifacts/hooks";
import { getOnlyOfficeDocumentDescriptor } from "@/core/artifacts/onlyoffice";
import {
  filterLegacyPptPreviewArtifacts,
  mergeVisibleArtifacts,
} from "@/core/artifacts/utils";
import {
  DesignBoardDocumentReadError,
  readDesignBoardDocument,
} from "@/core/design-board/api";
import {
  clearDesignBoardAutoOpened,
  publishDesignBoardRemoteMessage,
} from "@/core/design-board/embed";
import { isDesignDocumentPath } from "@/core/design-board/paths";
import { useI18n } from "@/core/i18n/hooks";
import { getUserVisibleRuntimePath } from "@/core/utils/files";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { ArtifactFileDetail, useArtifacts } from "../artifacts";
import { useThread } from "../messages/context";
import { useWorkbenchActions } from "../surfaces/use-workbench-actions";
import { WorkspaceSurfaceDock } from "../surfaces/workspace-surface-dock";

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };
const FAST_ARTIFACT_DISCOVERY_POLL_MS = 5000;
const DESIGN_REVISION_SYNC_POLL_MS = 2000;
const MEDIUM_ARTIFACT_DISCOVERY_POLL_MS = 15000;
const SLOW_ARTIFACT_DISCOVERY_POLL_MS = 30000;
const STABLE_DISCOVERY_POLLS_FOR_MEDIUM = 2;
const STABLE_DISCOVERY_POLLS_FOR_SLOW = 5;

function hasSameArtifacts(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((filepath, index) => filepath === right[index])
  );
}

function getArtifactDiscoveryPollInterval(
  isLoading: boolean,
  stableDiscoveryPollCount: number,
) {
  if (!isLoading) {
    return false;
  }
  if (stableDiscoveryPollCount >= STABLE_DISCOVERY_POLLS_FOR_SLOW) {
    return SLOW_ARTIFACT_DISCOVERY_POLL_MS;
  }
  if (stableDiscoveryPollCount >= STABLE_DISCOVERY_POLLS_FOR_MEDIUM) {
    return MEDIUM_ARTIFACT_DISCOVERY_POLL_MS;
  }
  return FAST_ARTIFACT_DISCOVERY_POLL_MS;
}

export function resolveDesignRefreshOpenIssue(error: unknown) {
  return error instanceof DesignBoardDocumentReadError &&
    (error.statusCode === 401 || error.statusCode === 403)
    ? "session_expired"
    : "sync_failed";
}

const ChatBox: React.FC<{ children: React.ReactNode; threadId: string }> = ({
  children,
  threadId,
}) => {
  const { t } = useI18n();
  const { thread, isMock } = useThread();
  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    syncThread,
    select: selectArtifact,
    deselect,
    selectedArtifact,
  } = useArtifacts();
  const workspaceSurface = useWorkspaceSurface();
  const { openDesignWorkbench } = useWorkbenchActions(threadId);
  const previousVisibleArtifactsRef = useRef<string[] | null>(null);

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  const [stableDiscoveryPollCount, setStableDiscoveryPollCount] = useState(0);
  const lastDiscoveredArtifactsKeyRef = useRef<string | null>(null);
  const lastDiscoveryUpdateAtRef = useRef(0);
  const stateArtifacts = useMemo(
    () => filterLegacyPptPreviewArtifacts(thread.values.artifacts ?? []),
    [thread.values.artifacts],
  );
  const artifactsRefreshKey = useMemo(
    () => stateArtifacts.join("\n"),
    [stateArtifacts],
  );
  const shouldFetchDiscoveredArtifacts = useMemo(
    () =>
      !isMock &&
      (stateArtifacts.length > 0 ||
        thread.messages.length > 0 ||
        (thread.values.messages?.length ?? 0) > 0),
    [
      isMock,
      stateArtifacts.length,
      thread.messages.length,
      thread.values.messages,
    ],
  );
  const {
    artifacts: discoveredOutputArtifacts,
    lastUpdatedAt: discoveredArtifactsUpdatedAt,
  } = useThreadOutputArtifacts({
    threadId,
    enabled: shouldFetchDiscoveredArtifacts,
    // Polling already covers live runs, so keep the cache key tied only to
    // persisted artifact hints instead of the loading flag to avoid a second
    // fetch when the composer flips from idle to streaming.
    refreshKey: artifactsRefreshKey,
    refetchIntervalMs: getArtifactDiscoveryPollInterval(
      thread.isLoading,
      stableDiscoveryPollCount,
    ),
  });
  const discoveredArtifactsKey = useMemo(
    () => discoveredOutputArtifacts.join("\n"),
    [discoveredOutputArtifacts],
  );
  const visibleArtifacts = useMemo(
    () =>
      mergeVisibleArtifacts(
        artifacts,
        mergeVisibleArtifacts(stateArtifacts, discoveredOutputArtifacts),
      ),
    [artifacts, discoveredOutputArtifacts, stateArtifacts],
  );

  useEffect(() => {
    lastDiscoveredArtifactsKeyRef.current = null;
    lastDiscoveryUpdateAtRef.current = 0;
    setStableDiscoveryPollCount(0);
  }, [artifactsRefreshKey, threadId]);

  useEffect(() => {
    if (!thread.isLoading) {
      lastDiscoveredArtifactsKeyRef.current = discoveredArtifactsKey;
      lastDiscoveryUpdateAtRef.current = discoveredArtifactsUpdatedAt;
      setStableDiscoveryPollCount(0);
      return;
    }

    if (discoveredArtifactsUpdatedAt === 0) {
      return;
    }

    if (lastDiscoveryUpdateAtRef.current === discoveredArtifactsUpdatedAt) {
      return;
    }

    lastDiscoveryUpdateAtRef.current = discoveredArtifactsUpdatedAt;

    // Keep discovery fast while outputs are changing, then back off repeated
    // identical scans so long-running runs do not keep hammering the gateway.
    if (lastDiscoveredArtifactsKeyRef.current === null) {
      lastDiscoveredArtifactsKeyRef.current = discoveredArtifactsKey;
      setStableDiscoveryPollCount(0);
      return;
    }

    if (lastDiscoveredArtifactsKeyRef.current === discoveredArtifactsKey) {
      setStableDiscoveryPollCount((count) => count + 1);
      return;
    }

    lastDiscoveredArtifactsKeyRef.current = discoveredArtifactsKey;
    setStableDiscoveryPollCount(0);
  }, [discoveredArtifactsKey, discoveredArtifactsUpdatedAt, thread.isLoading]);

  const selectedOfficeArtifact = useMemo(() => {
    if (!selectedArtifact) {
      return null;
    }
    return getOnlyOfficeDocumentDescriptor(selectedArtifact)
      ? selectedArtifact
      : null;
  }, [selectedArtifact]);
  const officeDialogOpen = artifactsOpen && selectedOfficeArtifact !== null;

  useEffect(() => {
    if (!hasSameArtifacts(artifacts, visibleArtifacts)) {
      setArtifacts(visibleArtifacts);
    }
    if (
      visibleArtifacts.length === 0 ||
      (selectedArtifact && !visibleArtifacts.includes(selectedArtifact))
    ) {
      deselect();
    }
    if (env.VITE_STATIC_WEBSITE_ONLY === "true" && autoSelectFirstArtifact) {
      if (visibleArtifacts.length > 0) {
        setAutoSelectFirstArtifact(false);
        selectArtifact(visibleArtifacts[0]!);
      }
    }
  }, [
    autoSelectFirstArtifact,
    artifacts,
    deselect,
    visibleArtifacts,
    selectArtifact,
    selectedArtifact,
    setArtifacts,
  ]);

  useEffect(() => {
    if (!artifactsOpen && selectedOfficeArtifact) {
      deselect();
    }
  }, [artifactsOpen, deselect, selectedOfficeArtifact]);

  useEffect(() => {
    syncThread(threadId);
    setAutoSelectFirstArtifact(true);
  }, [syncThread, threadId]);

  useEffect(() => {
    const previousArtifacts = previousVisibleArtifactsRef.current;
    previousVisibleArtifactsRef.current = visibleArtifacts;

    if (previousArtifacts === null || !thread.isLoading) {
      return;
    }

    const previousSet = new Set(previousArtifacts);
    const newlyDiscoveredArtifacts = visibleArtifacts.filter(
      (artifactPath) => !previousSet.has(artifactPath),
    );

    if (newlyDiscoveredArtifacts.length === 0) {
      return;
    }

    const newlyDiscoveredDesignArtifact = newlyDiscoveredArtifacts.find(
      isDesignDocumentPath,
    );
    if (newlyDiscoveredDesignArtifact) {
      void openDesignWorkbench({
        autoOpen: true,
        targetPath: newlyDiscoveredDesignArtifact,
      });
    }

    // Preview cards should reflect artifacts discovered during the active run,
    // not the initial thread hydration of older outputs.
    workspaceSurface.notePreviewArtifacts(
      newlyDiscoveredArtifacts.filter(
        (artifactPath) => !isDesignDocumentPath(artifactPath),
      ),
    );
  }, [openDesignWorkbench, thread.isLoading, visibleArtifacts, workspaceSurface]);

  useEffect(() => {
    if (!thread.isLoading || !workspaceSurface.designState.session) {
      return;
    }

    let cancelled = false;
    const session = workspaceSurface.designState.session;

    const syncRevision = async () => {
      try {
        const payload = await readDesignBoardDocument(session);
        if (cancelled) {
          return;
        }
        if (payload.revision === workspaceSurface.designState.revision) {
          return;
        }

        workspaceSurface.setDesignStatus("saving", {
          revision: payload.revision,
          targetPath: payload.target_path,
        });
        publishDesignBoardRemoteMessage(session, {
          type: "design.remote.revision-available",
          revision: payload.revision,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const openIssue = resolveDesignRefreshOpenIssue(error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to refresh design document";
        workspaceSurface.setDesignStatus("error", {
          error: message,
          targetPath: session.target_path,
          openIssue,
        });
        if (openIssue === "session_expired") {
          clearDesignBoardAutoOpened(threadId);
          publishDesignBoardRemoteMessage(session, {
            type: "design.remote.session-expired",
            revision: workspaceSurface.designState.revision ?? null,
          });
        }
      }
    };

    void syncRevision();
    const timer = window.setInterval(() => {
      void syncRevision();
    }, DESIGN_REVISION_SYNC_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    thread.isLoading,
    threadId,
    workspaceSurface,
    workspaceSurface.designState.revision,
    workspaceSurface.designState.session,
  ]);

  const artifactPanelOpen = useMemo(() => {
    return workspaceSurface.dockState.open;
  }, [workspaceSurface.dockState.open]);

  return (
    <>
      <ResizablePanelGroup
        key={artifactPanelOpen ? "artifacts-open" : "artifacts-closed"}
        orientation="horizontal"
        defaultLayout={artifactPanelOpen ? OPEN_MODE : CLOSE_MODE}
      >
        <ResizablePanel className="relative overflow-hidden" id="chat">
          {children}
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            "opacity-33 hover:opacity-100",
            !artifactPanelOpen && "pointer-events-none opacity-0",
          )}
        />
        <ResizablePanel
          className={cn(
            "overflow-hidden transition-[opacity] duration-300 ease-in-out",
            !artifactPanelOpen && "pointer-events-none opacity-0",
          )}
          id="artifacts"
        >
          <div
            className={cn(
              "h-full transition-transform duration-300 ease-in-out",
              artifactPanelOpen ? "translate-x-0" : "translate-x-full",
            )}
          >
            <WorkspaceSurfaceDock
              threadId={threadId}
              visibleArtifacts={visibleArtifacts}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {selectedOfficeArtifact && (
        <Dialog
          open={officeDialogOpen}
          onOpenChange={(nextOpen) => {
            setArtifactsOpen(nextOpen);
            if (!nextOpen) {
              deselect();
            }
          }}
        >
          <DialogContent
            className="h-[92vh] w-[96vw] max-w-[96vw] overflow-hidden p-0 sm:max-w-[96vw]"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">
              {getUserVisibleRuntimePath(selectedOfficeArtifact)}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.workspace.officePreviewDialogDescription}
            </DialogDescription>
            <ArtifactFileDetail
              className="size-full rounded-none border-0 shadow-none"
              filepath={selectedOfficeArtifact}
              threadId={threadId}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export { ChatBox };
