import {
  FilesIcon,
  PanelRightCloseIcon,
  PaletteIcon,
  PlaySquareIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/core/i18n/hooks";
import type {
  DesignSurfaceStatus,
  RuntimeSurfaceStatus,
  WorkspaceSurface,
} from "@/core/workspace-surface/types";

function getStatusBadgeLabel(
  value: RuntimeSurfaceStatus | DesignSurfaceStatus,
  labels: Record<string, string>,
) {
  return labels[value] ?? value;
}

export function WorkspaceSurfaceTabs({
  designStatus,
  visibleArtifactCount,
  runtimeStatus,
  onSelectSurface,
  onClose,
}: {
  designStatus: DesignSurfaceStatus;
  visibleArtifactCount: number;
  runtimeStatus: RuntimeSurfaceStatus;
  onSelectSurface: (surface: WorkspaceSurface) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const runtimeStatusLabels = {
    idle: t.workspace.runtimeStatusIdle,
    opening: t.workspace.runtimeStatusOpening,
    active: t.workspace.runtimeStatusActive,
    failed: t.workspace.runtimeStatusFailed,
  } satisfies Record<RuntimeSurfaceStatus, string>;
  const designStatusLabels = {
    idle: t.workspace.designStatusIdle,
    loading: t.workspace.designStatusLoading,
    ready: t.workspace.designStatusReady,
    dirty: t.workspace.designStatusDirty,
    saving: t.workspace.designStatusSaving,
    synced: t.workspace.designStatusSynced,
    conflict: t.workspace.designStatusConflict,
    error: t.workspace.designStatusError,
  } satisfies Record<DesignSurfaceStatus, string>;
  return (
    <div className="border-border/60 bg-background/90 flex items-center justify-between border-b px-3 py-3">
      <TabsList variant="line" className="w-full justify-start">
        <TabsTrigger
          value="preview"
          onClick={() => onSelectSurface("preview")}
          className="gap-2"
        >
          {t.common.preview}
        </TabsTrigger>
        <TabsTrigger
          value="design"
          onClick={() => onSelectSurface("design")}
          className="gap-2"
        >
          <PaletteIcon className="size-4" />
          {t.workspace.designSurfaceTitle}
          <Badge variant="outline" className="ml-1">
            {getStatusBadgeLabel(designStatus, designStatusLabels)}
          </Badge>
        </TabsTrigger>
        <TabsTrigger
          value="files"
          onClick={() => onSelectSurface("files")}
          className="gap-2"
        >
          <FilesIcon className="size-4" />
          {t.workspace.filesSurfaceTitle}
          {visibleArtifactCount > 0 ? (
            <Badge variant="outline" className="ml-1">
              {visibleArtifactCount}
            </Badge>
          ) : null}
        </TabsTrigger>
        {/* Keep runtime reachable from a fresh thread so the empty-state panel
            can launch the first sandbox session without adding another header button. */}
        <TabsTrigger
          value="runtime"
          onClick={() => onSelectSurface("runtime")}
          className="gap-2"
        >
          <PlaySquareIcon className="size-4" />
          {t.workspace.runtimeSurfaceTitle}
          <Badge variant="outline" className="ml-1">
            {getStatusBadgeLabel(runtimeStatus, runtimeStatusLabels)}
          </Badge>
        </TabsTrigger>
      </TabsList>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onClose}
        aria-label={t.workspace.closeWorkspaceDock}
        className="ml-2 shrink-0"
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
    </div>
  );
}
