import { AlertCircleIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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
import { useI18n } from "@/core/i18n/hooks";
import { useLatestThreadPublicAPIInvocation } from "@/core/public-api/hooks";
import { getUserVisibleRuntimePath } from "@/core/utils/files";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { ArtifactFileDetail, useArtifacts } from "../artifacts";
import { useThread } from "../messages/context";
import { WorkspaceSurfaceDock } from "../surfaces/workspace-surface-dock";

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };
const FAST_ARTIFACT_DISCOVERY_POLL_MS = 5000;
const MEDIUM_ARTIFACT_DISCOVERY_POLL_MS = 15000;
const SLOW_ARTIFACT_DISCOVERY_POLL_MS = 30000;
const STABLE_DISCOVERY_POLLS_FOR_MEDIUM = 2;
const STABLE_DISCOVERY_POLLS_FOR_SLOW = 5;
const EMPTY_ARTIFACTS: string[] = [];

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

function isUnsuccessfulInvocationStatus(status?: string) {
  const normalizedStatus = status?.trim().toLowerCase();
  return (
    normalizedStatus === "failed" ||
    normalizedStatus === "error" ||
    normalizedStatus === "canceled" ||
    normalizedStatus === "cancelled"
  );
}

function ThreadExecutionErrorBanner({
  enabled,
  threadId,
}: {
  enabled: boolean;
  threadId: string;
}) {
  const { t } = useI18n();
  // Public SDK/API failures are ledger rows, not guaranteed LangGraph messages.
  // Read the ledger explicitly so a thread with old visible content still shows
  // the latest external-call failure instead of looking silently successful.
  const { data: latestInvocation } = useLatestThreadPublicAPIInvocation({
    threadId,
    enabled,
  });

  if (!isUnsuccessfulInvocationStatus(latestInvocation?.status)) {
    return null;
  }

  const trimmedError = latestInvocation?.error?.trim();
  const errorMessage =
    trimmedError && trimmedError.length > 0
      ? trimmedError
      : t.workspace.executionErrorFallback;
  const details = [
    latestInvocation?.response_id
      ? `${t.workspace.executionErrorResponseId}: ${latestInvocation.response_id}`
      : null,
    latestInvocation?.trace_id
      ? `${t.workspace.executionErrorTraceId}: ${latestInvocation.trace_id}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-40 flex justify-center px-4">
      <Alert
        variant="destructive"
        className="pointer-events-auto max-w-(--container-width-md) border-destructive/40 bg-background/95 shadow-lg backdrop-blur"
      >
        <AlertCircleIcon />
        <AlertTitle>{t.workspace.executionErrorTitle}</AlertTitle>
        <AlertDescription>
          <p className="break-words">{errorMessage}</p>
          {details.length > 0 && (
            <div className="text-destructive/75 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
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
    activeThreadId,
    select: selectArtifact,
    deselect,
    selectedArtifact,
  } = useArtifacts();
  const workspaceSurface = useWorkspaceSurface();
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
  const isArtifactsThreadSynced = activeThreadId === threadId;
  const threadArtifacts = isArtifactsThreadSynced ? artifacts : EMPTY_ARTIFACTS;
  const threadSelectedArtifact = isArtifactsThreadSynced
    ? selectedArtifact
    : null;
  const visibleArtifacts = useMemo(
    () =>
      mergeVisibleArtifacts(
        threadArtifacts,
        mergeVisibleArtifacts(stateArtifacts, discoveredOutputArtifacts),
      ),
    [discoveredOutputArtifacts, stateArtifacts, threadArtifacts],
  );

  useEffect(() => {
    // Thread switches can leave the provider holding the previous thread's
    // selected artifact for one render. Sync early and keep render-time reads
    // scoped by activeThreadId so stale paths never hit the current thread API.
    syncThread(threadId);
    setAutoSelectFirstArtifact(true);
  }, [syncThread, threadId]);

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
    if (!threadSelectedArtifact) {
      return null;
    }
    return getOnlyOfficeDocumentDescriptor(threadSelectedArtifact)
      ? threadSelectedArtifact
      : null;
  }, [threadSelectedArtifact]);
  const officeDialogOpen = artifactsOpen && selectedOfficeArtifact !== null;

  useEffect(() => {
    if (!hasSameArtifacts(threadArtifacts, visibleArtifacts)) {
      setArtifacts(visibleArtifacts);
    }
    if (
      visibleArtifacts.length === 0 ||
      (threadSelectedArtifact &&
        !visibleArtifacts.includes(threadSelectedArtifact))
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
    deselect,
    threadArtifacts,
    threadSelectedArtifact,
    visibleArtifacts,
    selectArtifact,
    setArtifacts,
  ]);

  useEffect(() => {
    if (!artifactsOpen && selectedOfficeArtifact) {
      deselect();
    }
  }, [artifactsOpen, deselect, selectedOfficeArtifact]);

  useEffect(() => {
    const threadHint = workspaceSurface.threadHint;
    const hintedPreviewArtifact =
      threadHint?.surface === "preview" ? threadHint.artifact_path : undefined;
    if (
      !hintedPreviewArtifact ||
      !visibleArtifacts.includes(hintedPreviewArtifact)
    ) {
      return;
    }

    if (threadSelectedArtifact) {
      return;
    }

    // Thread hints are persisted separately from live artifact selection, so a
    // page reload should rehydrate the selected preview only when the live
    // selector has no user-chosen artifact yet. Once the user switches files in
    // the dock, the hint must not continuously pull the preview back.
    selectArtifact(hintedPreviewArtifact, true);
  }, [
    selectArtifact,
    threadSelectedArtifact,
    threadId,
    visibleArtifacts,
    workspaceSurface.threadHint,
  ]);

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

    // Preview cards should reflect artifacts discovered during the active run,
    // not the initial thread hydration of older outputs.
    workspaceSurface.notePreviewArtifacts(newlyDiscoveredArtifacts);
  }, [thread.isLoading, visibleArtifacts, workspaceSurface]);

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
          <ThreadExecutionErrorBanner enabled={!isMock} threadId={threadId} />
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
              selectedArtifact={threadSelectedArtifact}
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
