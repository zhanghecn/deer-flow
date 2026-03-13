import { FilesIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";

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
import { getOnlyOfficeDocumentDescriptor } from "@/core/artifacts/onlyoffice";
import { filterLegacyPptPreviewArtifacts } from "@/core/artifacts/utils";
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

const ChatBox: React.FC<{ children: React.ReactNode; threadId: string }> = ({
  children,
  threadId,
}) => {
  const { thread } = useThread();
  const layoutRef = useRef<GroupImperativeHandle>(null);
  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    select: selectArtifact,
    deselect,
    selectedArtifact,
  } = useArtifacts();

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  const visibleArtifacts = useMemo(
    () => filterLegacyPptPreviewArtifacts(thread.values.artifacts ?? []),
    [thread.values.artifacts],
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
    setArtifacts(visibleArtifacts);
    if (
      visibleArtifacts.length === 0 ||
      (selectedArtifact && !visibleArtifacts.includes(selectedArtifact))
    ) {
      deselect();
    }
    if (
      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" &&
      autoSelectFirstArtifact
    ) {
      if (visibleArtifacts.length > 0) {
        setAutoSelectFirstArtifact(false);
        selectArtifact(visibleArtifacts[0]!);
      }
    }
  }, [
    autoSelectFirstArtifact,
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

  const artifactPanelOpen = useMemo(() => {
    if (officeDialogOpen) {
      return false;
    }
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true") {
      return artifactsOpen && artifacts?.length > 0;
    }
    return artifactsOpen;
  }, [artifacts, artifactsOpen, officeDialogOpen]);

  useEffect(() => {
    if (layoutRef.current) {
      if (artifactPanelOpen) {
        layoutRef.current.setLayout(OPEN_MODE);
      } else {
        layoutRef.current.setLayout(CLOSE_MODE);
      }
    }
  }, [artifactPanelOpen]);

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={{ chat: 100, artifacts: 0 }}
        groupRef={layoutRef}
      >
        <ResizablePanel className="relative" defaultSize={100} id="chat">
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
            "transition-all duration-300 ease-in-out",
            !artifactPanelOpen && "opacity-0",
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
                    title="No artifact selected"
                    description="Select an artifact to view its details"
                  />
                ) : (
                  <div className="flex size-full max-w-(--container-width-sm) flex-col justify-center p-4 pt-8">
                    <header className="shrink-0">
                      <h2 className="text-lg font-medium">Artifacts</h2>
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
              {selectedOfficeArtifact}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Preview and edit the selected office document.
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
