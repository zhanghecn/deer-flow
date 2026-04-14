import {
  ChevronRightIcon,
  CheckCircle2Icon,
  EyeIcon,
  type LucideIcon,
  PlaySquareIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useWorkbenchActions } from "@/components/workspace/surfaces/use-workbench-actions";
import { useI18n } from "@/core/i18n/hooks";
import { getUserVisibleRuntimePath } from "@/core/utils/files";
import type { WorkspaceEventEntry } from "@/core/workspace-surface/types";

function formatEventTime(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function WorkspaceEventActionCard({
  actionLabel,
  children,
  icon: Icon,
  iconClassName,
  onClick,
  timeLabel,
  title,
}: {
  actionLabel: string;
  children?: React.ReactNode;
  icon: LucideIcon;
  iconClassName: string;
  onClick: () => void;
  timeLabel: string;
  title: string;
}) {
  return (
    <button
      type="button"
      className="border-border/70 bg-background/80 hover:bg-background flex w-full items-start gap-3 rounded-2xl border p-4 text-left shadow-sm transition"
      onClick={onClick}
    >
      <div className={iconClassName}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">{title}</div>
          <Badge variant="outline" className="text-[10px]">
            {timeLabel}
          </Badge>
        </div>
        {children}
      </div>
      <div className="text-muted-foreground flex items-center gap-1 self-center text-xs font-medium">
        <span>{actionLabel}</span>
        <ChevronRightIcon className="size-4" />
      </div>
    </button>
  );
}

export function WorkspaceEventCard({
  event,
  threadId,
}: {
  event: WorkspaceEventEntry;
  threadId: string;
}) {
  const { locale, t } = useI18n();
  const { openArtifactWorkspace, openRuntimeWorkbench } =
    useWorkbenchActions(threadId);
  const timeLabel = formatEventTime(event.created_at, locale);

  if (event.kind === "design-saved") {
    return (
      <WorkspaceEventActionCard
        actionLabel={t.workspace.openDesignEditor}
        icon={CheckCircle2Icon}
        iconClassName="rounded-xl bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-300"
        onClick={() => {
          openArtifactWorkspace(event.target_path);
        }}
        timeLabel={timeLabel}
        title={t.workspace.eventDesignSaved}
      >
        <div className="text-muted-foreground truncate text-xs">
          {getUserVisibleRuntimePath(event.target_path)}
        </div>
      </WorkspaceEventActionCard>
    );
  }

  if (event.kind === "runtime-opened") {
    return (
      <WorkspaceEventActionCard
        actionLabel={t.workspace.openRuntimeSurface}
        icon={PlaySquareIcon}
        iconClassName="rounded-xl bg-sky-500/10 p-2 text-sky-600 dark:text-sky-300"
        onClick={() => {
          void openRuntimeWorkbench();
        }}
        timeLabel={timeLabel}
        title={t.workspace.eventRuntimeOpened}
      >
        {event.target_path ? (
          <div className="text-muted-foreground truncate text-xs">
            {getUserVisibleRuntimePath(event.target_path)}
          </div>
        ) : null}
      </WorkspaceEventActionCard>
    );
  }

  return (
    <WorkspaceEventActionCard
      actionLabel={t.common.preview}
      icon={EyeIcon}
      iconClassName="bg-muted text-muted-foreground rounded-xl p-2"
      onClick={() => {
        openArtifactWorkspace(event.artifact_path);
      }}
      timeLabel={timeLabel}
      title={t.workspace.eventPreviewUpdated}
    >
      <div className="text-muted-foreground truncate text-xs">
        {getUserVisibleRuntimePath(event.artifact_path)}
      </div>
    </WorkspaceEventActionCard>
  );
}
