import { FilesIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
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
import { getUserVisibleRuntimePath } from "@/core/utils/files";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import {
  ArtifactFileDetail,
  ArtifactFileList,
  useArtifacts,
} from "../artifacts";
import { useThread } from "../messages/context";

const CLOSE_MODE = { chat: 100, artifacts: 0 };
const OPEN_MODE = { chat: 60, artifacts: 40 };

function hasSameArtifacts(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((filepath, index) => filepath === right[index])
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
    select: selectArtifact,
    deselect,
    selectedArtifact,
  } = useArtifacts();

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
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
    [isMock, stateArtifacts.length, thread.messages.length, thread.values.messages],
  );
  const { artifacts: discoveredOutputArtifacts } = useThreadOutputArtifacts({
    threadId,
    enabled: shouldFetchDiscoveredArtifacts,
    // Polling already covers live runs, so keep the cache key tied only to
    // persisted artifact hints instead of the loading flag to avoid a second
    // fetch when the composer flips from idle to streaming.
    refreshKey: artifactsRefreshKey,
    refetchIntervalMs: thread.isLoading ? 5000 : false,
  });
  const visibleArtifacts = useMemo(
    () =>
      mergeVisibleArtifacts(
        artifacts,
        mergeVisibleArtifacts(stateArtifacts, discoveredOutputArtifacts),
      ),
    [artifacts, discoveredOutputArtifacts, stateArtifacts],
  );
  const selectedOfficeArtifact = useMemo(() => {
    if (!selectedArtifact) {
      return null;
    }
    return getOnlyOfficeDocumentDescriptor(selectedArtifact)
      ? selectedArtifact
      : null;
  }, [selectedArtifact]);
  const selectedPanelArtifact = useMemo(() => {
    if (!selectedArtifact || selectedOfficeArtifact) {
      return null;
    }
    return selectedArtifact;
  }, [selectedArtifact, selectedOfficeArtifact]);
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

  const artifactPanelOpen = useMemo(() => {
    if (officeDialogOpen) {
      return false;
    }
    if (env.VITE_STATIC_WEBSITE_ONLY === "true") {
      return artifactsOpen && artifacts?.length > 0;
    }
    return artifactsOpen;
  }, [artifacts, artifactsOpen, officeDialogOpen]);

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
              "h-full p-4 transition-transform duration-300 ease-in-out",
              artifactPanelOpen ? "translate-x-0" : "translate-x-full",
            )}
          >
            {selectedPanelArtifact ? (
              <ArtifactFileDetail
                className="size-full"
                filepath={selectedPanelArtifact}
                threadId={threadId}
              />
            ) : (
              <div className="relative flex size-full justify-center">
                <div className="absolute top-1 right-1 z-30">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      setArtifactsOpen(false);
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
                {visibleArtifacts.length === 0 ? (
                  <ConversationEmptyState
                    icon={<FilesIcon />}
                    title={t.workspace.noArtifactSelectedTitle}
                    description={t.workspace.noArtifactSelectedDescription}
                  />
                ) : (
                  <div className="flex size-full max-w-(--container-width-sm) flex-col justify-center p-4 pt-8">
                    <header className="shrink-0">
                      <h2 className="text-lg font-medium">
                        {t.workspace.artifactsPanelTitle}
                      </h2>
                    </header>
                    <main className="min-h-0 grow">
                      <ArtifactFileList
                        className="max-w-(--container-width-sm) p-4 pt-12"
                        files={visibleArtifacts}
                        threadId={threadId}
                      />
                    </main>
                  </div>
                )}
              </div>
            )}
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
