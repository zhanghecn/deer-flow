import { ExternalLinkIcon, PaletteIcon, RefreshCcwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import { getUserVisibleRuntimePath } from "@/core/utils/files";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";

import { useWorkbenchActions } from "./use-workbench-actions";
import { WorkspaceSurfaceEmpty } from "./workspace-surface-empty";

function renderStatusLabel(status: string, t: ReturnType<typeof useI18n>["t"]) {
  switch (status) {
    case "loading":
      return t.workspace.designStatusLoading;
    case "ready":
      return t.workspace.designStatusReady;
    case "dirty":
      return t.workspace.designStatusDirty;
    case "saving":
      return t.workspace.designStatusSaving;
    case "synced":
      return t.workspace.designStatusSynced;
    case "conflict":
      return t.workspace.designStatusConflict;
    case "error":
      return t.workspace.designStatusError;
    default:
      return t.workspace.designStatusIdle;
  }
}

export function DesignSurfacePanel({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  const { designSelection, designState } = useWorkspaceSurface();
  const { isOpeningDesign, openDesignWorkbench } =
    useWorkbenchActions(threadId);

  const openIssueMessage =
    designState.open_issue === "popup_blocked"
      ? t.workspace.designPopupBlockedDescription
      : designState.open_issue === "session_expired"
        ? t.workspace.designSessionExpiredDescription
        : designState.open_issue === "open_failed"
          ? t.workspace.designOpenFailedDescription
          : designState.open_issue === "sync_failed"
            ? t.workspace.designSyncFailedDescription
          : null;

  if (!designState.session && !designSelection) {
    return (
      <WorkspaceSurfaceEmpty
        icon={PaletteIcon}
        title={t.workspace.noDesignSurfaceTitle}
        description={t.workspace.noDesignSurfaceDescription}
        action={
          // Keep the primary editor entry available even before a session exists.
          <Button
            onClick={() => {
              void openDesignWorkbench({ forceRefresh: true });
            }}
            disabled={isOpeningDesign}
          >
            <ExternalLinkIcon className="size-4" />
            {t.workspace.openDesignEditor}
          </Button>
        }
      />
    );
  }

  const targetPath =
    designSelection?.target_path ??
    designState.target_path ??
    designState.session?.target_path;

  return (
    <ScrollArea className="size-full">
      <div className="flex min-h-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {t.workspace.designSurfaceTitle}
            </div>
            <div className="text-muted-foreground text-xs">
              {targetPath
                ? getUserVisibleRuntimePath(targetPath)
                : t.workspace.noTargetFile}
            </div>
          </div>
          <Badge variant="outline">
            {renderStatusLabel(designState.status, t)}
          </Badge>
        </div>

        {designState.last_error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {designState.last_error}
          </div>
        ) : null}

        {openIssueMessage ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {openIssueMessage}
          </div>
        ) : null}

        {designSelection?.selected_node_ids.length ? (
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs uppercase">
              {t.workspace.selectedNodesLabel}
            </div>
            <div className="flex flex-wrap gap-2">
              {(designSelection.selected_nodes ?? [])
                .slice(0, 6)
                .map((node) => (
                  <Badge key={node.id} variant="secondary">
                    {node.label ?? node.id}
                  </Badge>
                ))}
              {(designSelection.selected_nodes?.length ?? 0) === 0 ? (
                <Badge variant="secondary">
                  {designSelection.selected_node_ids.length}
                </Badge>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-5 text-sm leading-6">
          {t.workspace.designSurfaceDescription}
        </div>

        <div className="grid gap-3 rounded-xl border border-border/60 px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">
              {t.workspace.designRevisionLabel}
            </span>
            <span className="font-mono text-xs">
              {designState.revision ?? t.workspace.designRevisionUnavailable}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">
              {t.workspace.designLastActivityLabel}
            </span>
            <span className="text-xs">
              {designState.last_activity_at
                ? new Date(designState.last_activity_at).toLocaleTimeString()
                : t.workspace.designLastActivityUnavailable}
            </span>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap gap-2">
          <Button
            onClick={() => {
              void openDesignWorkbench({ forceRefresh: true });
            }}
            disabled={isOpeningDesign}
          >
            <ExternalLinkIcon className="size-4" />
            {t.workspace.openDesignEditor}
          </Button>
          {designState.session ? (
            <Button
              variant="outline"
              onClick={() => {
                void openDesignWorkbench({
                  forceRefresh: designState.open_issue === "session_expired",
                });
              }}
            >
              <RefreshCcwIcon className="size-4" />
              {t.workspace.reopenDesignEditor}
            </Button>
          ) : null}
        </div>
      </div>
    </ScrollArea>
  );
}
