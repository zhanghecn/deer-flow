import { ExternalLinkIcon, PlaySquareIcon, RefreshCcwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import { isRuntimeSurfaceBusy } from "@/core/runtime-workspaces/state";
import { getUserVisibleRuntimePath } from "@/core/utils/files";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";

import { useWorkbenchActions } from "./use-workbench-actions";
import { WorkspaceSurfaceEmpty } from "./workspace-surface-empty";

function renderStatusLabel(status: string, t: ReturnType<typeof useI18n>["t"]) {
  switch (status) {
    case "opening":
      return t.workspace.runtimeStatusOpening;
    case "active":
      return t.workspace.runtimeStatusActive;
    case "failed":
      return t.workspace.runtimeStatusFailed;
    default:
      return t.workspace.runtimeStatusIdle;
  }
}

export function RuntimeSurfacePanel({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  const { runtimeState } = useWorkspaceSurface();
  const { isOpeningRuntime, openRuntimeWorkbench } =
    useWorkbenchActions(threadId);

  if (!runtimeState.session && runtimeState.status === "idle") {
    return (
      <WorkspaceSurfaceEmpty
        icon={PlaySquareIcon}
        title={t.workspace.noRuntimeSurfaceTitle}
        description={t.workspace.noRuntimeSurfaceDescription}
        action={
          // The dock must still offer the first runtime launch from its empty state.
          <Button
            onClick={() => {
              void openRuntimeWorkbench({ forceRefresh: true });
            }}
            disabled={
              isOpeningRuntime || isRuntimeSurfaceBusy(runtimeState.status)
            }
          >
            <ExternalLinkIcon className="size-4" />
            {t.workspace.openRuntimeSurface}
          </Button>
        }
      />
    );
  }

  return (
    <ScrollArea className="size-full">
      <div className="flex min-h-full flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {t.workspace.runtimeSurfaceTitle}
            </div>
            <div className="text-muted-foreground text-xs">
              {runtimeState.target_path
                ? getUserVisibleRuntimePath(runtimeState.target_path)
                : t.workspace.runtimeSurfaceDescription}
            </div>
          </div>
          <Badge variant="outline">
            {renderStatusLabel(runtimeState.status, t)}
          </Badge>
        </div>

        {runtimeState.last_error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {runtimeState.last_error}
          </div>
        ) : null}

        <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-5 text-sm leading-6">
          {t.workspace.runtimeSurfaceDescription}
        </div>

        <div className="mt-auto flex flex-wrap gap-2">
          <Button
            onClick={() => {
              void openRuntimeWorkbench({ forceRefresh: true });
            }}
            disabled={
              isOpeningRuntime || isRuntimeSurfaceBusy(runtimeState.status)
            }
          >
            <ExternalLinkIcon className="size-4" />
            {t.workspace.openRuntimeSurface}
          </Button>
          {runtimeState.session ? (
            <Button
              variant="outline"
              onClick={() => {
                void openRuntimeWorkbench();
              }}
            >
              <RefreshCcwIcon className="size-4" />
              {t.workspace.reopenRuntimeSurface}
            </Button>
          ) : null}
        </div>
      </div>
    </ScrollArea>
  );
}
