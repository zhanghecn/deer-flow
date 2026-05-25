import { FilesIcon } from "lucide-react";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  ArtifactFileDetail,
  ArtifactFileList,
} from "@/components/workspace/artifacts";
import { useI18n } from "@/core/i18n/hooks";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";

import { RuntimeSurfacePanel } from "./runtime-surface-panel";
import { WorkspaceSurfaceEmpty } from "./workspace-surface-empty";
import { WorkspaceSurfaceTabs } from "./workspace-surface-tabs";

export function WorkspaceSurfaceDock({
  selectedArtifact,
  threadId,
  visibleArtifacts,
}: {
  selectedArtifact: string | null;
  threadId: string;
  visibleArtifacts: string[];
}) {
  const { t } = useI18n();
  const { dockState, runtimeState, setActiveSurface, setDockOpen } =
    useWorkspaceSurface();
  const activeSurface = dockState.activeSurface;
  const previewArtifact =
    selectedArtifact && visibleArtifacts.includes(selectedArtifact)
      ? selectedArtifact
      : null;

  return (
    <Tabs
      value={activeSurface}
      onValueChange={(value) => setActiveSurface(value as typeof activeSurface)}
      className="flex size-full flex-col gap-0"
    >
      <WorkspaceSurfaceTabs
        visibleArtifactCount={visibleArtifacts.length}
        runtimeStatus={runtimeState.status}
        onSelectSurface={setActiveSurface}
        onClose={() => setDockOpen(false)}
      />
      <TabsContent value="preview" className="min-h-0">
        {previewArtifact ? (
          <ArtifactFileDetail
            className="size-full border-0 shadow-none"
            filepath={previewArtifact}
            threadId={threadId}
          />
        ) : (
          <WorkspaceSurfaceEmpty
            icon={FilesIcon}
            title={t.workspace.noPreviewSelectedTitle}
            description={t.workspace.noPreviewSelectedDescription}
          />
        )}
      </TabsContent>
      <TabsContent value="files" className="min-h-0">
        {visibleArtifacts.length > 0 ? (
          <div className="size-full p-4">
            <ArtifactFileList files={visibleArtifacts} threadId={threadId} />
          </div>
        ) : (
          <WorkspaceSurfaceEmpty
            icon={FilesIcon}
            title={t.workspace.noArtifactSelectedTitle}
            description={t.workspace.noArtifactSelectedDescription}
          />
        )}
      </TabsContent>
      <TabsContent value="runtime" className="min-h-0">
        <RuntimeSurfacePanel threadId={threadId} />
      </TabsContent>
    </Tabs>
  );
}
