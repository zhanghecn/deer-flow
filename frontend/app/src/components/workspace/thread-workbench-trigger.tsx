import type { BaseStream } from "@langchain/langgraph-sdk";
import {
  EyeIcon,
  FilesIcon,
  PanelRightIcon,
  PlaySquareIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { isRuntimeSurfaceBusy } from "@/core/runtime-workspaces/state";
import type { AgentThreadState } from "@/core/threads";
import { cn } from "@/lib/utils";

import { useWorkbenchActions } from "./surfaces/use-workbench-actions";

type WorkbenchMode = "workspace" | "files" | "runtime";

export function ThreadWorkbenchTrigger({
  className,
  thread: _thread,
  threadId,
}: {
  className?: string;
  thread: BaseStream<AgentThreadState>;
  threadId: string;
}) {
  const { t } = useI18n();
  const {
    artifacts,
    isOpeningRuntime,
    openArtifactWorkspace,
    openRuntimeWorkbench,
    runtimeState,
    threadHint,
  } = useWorkbenchActions(threadId);

  const workbenchState = useMemo(() => {
    const hasRuntimeContext =
      runtimeState.session !== null || runtimeState.status !== "idle";
    const fileCount = artifacts.length;
    const rememberedPreviewArtifact =
      threadHint?.artifact_path && artifacts.includes(threadHint.artifact_path)
        ? threadHint.artifact_path
        : undefined;
    if (hasRuntimeContext) {
      return {
        icon: PlaySquareIcon,
        mode: "runtime" as WorkbenchMode,
        artifactPath: undefined,
        badgeLabel:
          runtimeState.status === "active"
            ? t.workspace.runtimeStatusActive
            : runtimeState.status === "opening"
              ? t.workspace.runtimeStatusOpening
              : runtimeState.status === "failed"
                ? t.workspace.runtimeStatusFailed
                : t.workspace.runtimeStatusIdle,
        label: t.workspace.runtimeSurfaceTitle,
      };
    }

    if (threadHint?.surface === "runtime") {
      return {
        icon: PlaySquareIcon,
        mode: "runtime" as WorkbenchMode,
        artifactPath: undefined,
        badgeLabel: null,
        label: t.workspace.runtimeSurfaceTitle,
      };
    }

    if (fileCount > 0) {
      return {
        icon:
          threadHint?.surface === "preview" && rememberedPreviewArtifact
            ? EyeIcon
            : FilesIcon,
        mode: "files" as WorkbenchMode,
        artifactPath: rememberedPreviewArtifact,
        badgeLabel: String(fileCount),
        label:
          threadHint?.surface === "preview" && rememberedPreviewArtifact
            ? t.common.preview
            : t.workspace.filesSurfaceTitle,
      };
    }

    if (threadHint?.surface === "preview" || threadHint?.surface === "files") {
      const hintSurface =
        threadHint.surface === "preview" ? "preview" : "files";
      return {
        icon: hintSurface === "preview" ? EyeIcon : FilesIcon,
        mode: "files" as WorkbenchMode,
        artifactPath: rememberedPreviewArtifact,
        badgeLabel: null,
        label:
          hintSurface === "preview"
            ? t.common.preview
            : t.workspace.filesSurfaceTitle,
      };
    }

    return {
      icon: PanelRightIcon,
      mode: "workspace" as WorkbenchMode,
      artifactPath: undefined,
      badgeLabel: null,
      label: t.sidebar.workspaceDock,
    };
  }, [
    runtimeState.session,
    runtimeState.status,
    artifacts,
    threadHint,
    t.common.preview,
    t.sidebar.workspaceDock,
    t.workspace.filesSurfaceTitle,
    t.workspace.runtimeStatusActive,
    t.workspace.runtimeStatusFailed,
    t.workspace.runtimeStatusIdle,
    t.workspace.runtimeStatusOpening,
    t.workspace.runtimeSurfaceTitle,
  ]);

  const handleOpenWorkbench = useCallback(() => {
    if (workbenchState.mode === "runtime") {
      void openRuntimeWorkbench();
      return;
    }
    openArtifactWorkspace(workbenchState.artifactPath);
  }, [
    openArtifactWorkspace,
    openRuntimeWorkbench,
    workbenchState.artifactPath,
    workbenchState.mode,
  ]);

  const Icon = workbenchState.icon;

  return (
    <Tooltip content={t.sidebar.workspaceDock}>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "border-border/70 bg-background/88 hover:bg-background h-9 gap-2 rounded-full px-3",
          className,
        )}
        disabled={isOpeningRuntime || isRuntimeSurfaceBusy(runtimeState.status)}
        onClick={handleOpenWorkbench}
      >
        <Icon className="size-4" />
        <span className="hidden max-w-28 truncate text-sm sm:inline">
          {workbenchState.label}
        </span>
        {workbenchState.badgeLabel ? (
          <Badge
            variant="secondary"
            className="rounded-full px-1.5 text-[10px] font-medium"
          >
            {workbenchState.badgeLabel}
          </Badge>
        ) : null}
      </Button>
    </Tooltip>
  );
}
