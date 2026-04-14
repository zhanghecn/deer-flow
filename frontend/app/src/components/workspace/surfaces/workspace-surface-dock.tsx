import { FilesIcon } from "lucide-react";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useArtifacts } from "@/components/workspace/artifacts";
import {
  ArtifactFileDetail,
  ArtifactFileList,
} from "@/components/workspace/artifacts";
import { useI18n } from "@/core/i18n/hooks";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";

import { DesignSurfacePanel } from "./design-surface-panel";
import { RuntimeSurfacePanel } from "./runtime-surface-panel";
import { WorkspaceSurfaceEmpty } from "./workspace-surface-empty";
import { WorkspaceSurfaceTabs } from "./workspace-surface-tabs";

export function WorkspaceSurfaceDock({
  threadId,
  visibleArtifacts,
}: {
  threadId: string;
  visibleArtifacts: string[];
}) {
  const { t } = useI18n();
  const { selectedArtifact } = useArtifacts();
  const { designState, dockState, runtimeState, setActiveSurface, setDockOpen } =
    useWorkspaceSurface();
  const activeSurface = dockState.activeSurface;

  return (
    <Tabs
      value={activeSurface}
      onValueChange={(value) => setActiveSurface(value as typeof activeSurface)}
      className="flex size-full flex-col gap-0"
    >
      <WorkspaceSurfaceTabs
        designStatus={designState.status}
        visibleArtifactCount={visibleArtifacts.length}
        runtimeStatus={runtimeState.status}
        onSelectSurface={setActiveSurface}
        onClose={() => setDockOpen(false)}
      />
      <TabsContent value="preview" className="min-h-0">
        {selectedArtifact ? (
          <ArtifactFileDetail
            className="size-full border-0 shadow-none"
            filepath={selectedArtifact}
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
      <TabsContent value="design" className="min-h-0">
        <DesignSurfacePanel threadId={threadId} />
      </TabsContent>
      <TabsContent value="runtime" className="min-h-0">
        <RuntimeSurfacePanel threadId={threadId} />
      </TabsContent>
    </Tabs>
  );
}
