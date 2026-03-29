import {
  CheckCircleIcon,
  ChevronUp,
  ClipboardListIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShineBorder } from "@/components/ui/shine-border";
import { useI18n } from "@/core/i18n/hooks";
import { hasToolCalls } from "@/core/messages/utils";
import {
  workspaceMessagePlugins,
  workspaceMessageRehypePlugins,
} from "@/core/streamdown";
import type { Subtask } from "@/core/tasks";
import { useSubtask } from "@/core/tasks/context";
import { explainLastToolCall } from "@/core/tools/utils";
import { cn } from "@/lib/utils";

import { CitationLink } from "../citations/citation-link";
import { FlipDisplay } from "../flip-display";

import { MarkdownContent } from "./markdown-content";

export function SubtaskCard({
  className,
  taskId,
  fallbackTask,
  isLoading: _isLoading,
}: {
  className?: string;
  taskId: string;
  fallbackTask?: Partial<Subtask>;
  isLoading: boolean;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const liveTask = useSubtask(taskId);
  const task: Subtask = useMemo(
    () => ({
      id: taskId,
      status: fallbackTask?.status ?? "in_progress",
      subagent_type: fallbackTask?.subagent_type ?? "general-purpose",
      description: fallbackTask?.description ?? t.subtasks.in_progress,
      prompt: fallbackTask?.prompt ?? "",
      result: fallbackTask?.result,
      error: fallbackTask?.error,
      latestMessage: fallbackTask?.latestMessage,
      ...liveTask,
    }),
    [fallbackTask, liveTask, t.subtasks.in_progress, taskId],
  );
  const subagentTypeLabel = useMemo(
    () =>
      typeof task.subagent_type === "string"
        ? task.subagent_type.replaceAll("-", " ")
        : "",
    [task.subagent_type],
  );
  const statusMeta = useMemo(() => {
    if (task.status === "completed") {
      return {
        badgeClassName: "text-emerald-600",
        icon: <CheckCircleIcon className="size-3 text-emerald-600" />,
        label: t.subtasks.completed,
      };
    }

    if (task.status === "failed") {
      return {
        badgeClassName: "text-red-500",
        icon: <XCircleIcon className="size-3 text-red-500" />,
        label: t.subtasks.failed,
      };
    }

    return {
      badgeClassName: "text-foreground/75",
      icon: <Loader2Icon className="size-3 animate-spin" />,
      label: t.subtasks.in_progress,
    };
  }, [task.status, t.subtasks.completed, t.subtasks.failed, t.subtasks.in_progress]);
  return (
    <ChainOfThought
      className={cn(
        "relative w-full gap-2 rounded-lg border py-0 shadow-sm",
        task.status === "completed" && "border-emerald-500/25",
        task.status === "failed" && "border-red-500/25",
        className,
      )}
      open={!collapsed}
    >
      <div
        className={cn(
          "ambilight z-[-1]",
          task.status === "in_progress" ? "enabled" : "",
        )}
      ></div>
      {task.status === "in_progress" && (
        <>
          <ShineBorder
            borderWidth={1.5}
            shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
          />
        </>
      )}
      <div className="bg-background/95 flex w-full flex-col rounded-lg">
        <div className="flex w-full items-center justify-between p-0.5">
          <Button
            className="h-auto w-full min-w-0 items-start justify-start whitespace-normal px-3 py-2 text-left"
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
          >
            <div className="flex w-full min-w-0 items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <ChainOfThoughtStep
                  className="min-w-0 font-normal"
                  label={
                    task.status === "in_progress" ? (
                      <Shimmer duration={3} spread={3}>
                        {task.description}
                      </Shimmer>
                    ) : (
                      task.description
                    )
                  }
                  icon={<ClipboardListIcon />}
                ></ChainOfThoughtStep>
                {subagentTypeLabel && (
                  <Badge
                    className="ml-7 mt-1 max-w-fit text-[10px] uppercase tracking-wide"
                    variant="secondary"
                  >
                    {subagentTypeLabel}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {collapsed && (
                  <div
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium",
                      statusMeta.badgeClassName,
                    )}
                  >
                    {statusMeta.icon}
                    <FlipDisplay
                      className="max-w-[420px] truncate pb-1"
                      uniqueKey={task.latestMessage?.id ?? ""}
                    >
                      {task.status === "in_progress" &&
                      task.latestMessage &&
                      hasToolCalls(task.latestMessage)
                        ? explainLastToolCall(task.latestMessage, t)
                        : statusMeta.label}
                    </FlipDisplay>
                  </div>
                )}
                <ChevronUp
                  className={cn(
                    "text-muted-foreground size-4",
                    !collapsed ? "" : "rotate-180",
                  )}
                />
              </div>
            </div>
          </Button>
        </div>
        <ChainOfThoughtContent className="px-4 pb-4">
          {task.prompt && (
            <ChainOfThoughtStep
              label={
                <Streamdown
                  {...workspaceMessagePlugins}
                  components={{ a: CitationLink }}
                >
                  {task.prompt}
                </Streamdown>
              }
            ></ChainOfThoughtStep>
          )}
          {task.status === "in_progress" &&
            task.latestMessage &&
            hasToolCalls(task.latestMessage) && (
              <ChainOfThoughtStep
                label={statusMeta.label}
                icon={<Loader2Icon className="size-4 animate-spin" />}
              >
                {explainLastToolCall(task.latestMessage, t)}
              </ChainOfThoughtStep>
            )}
          {task.status === "completed" && (
            <>
              <ChainOfThoughtStep
                label={statusMeta.label}
                icon={<CheckCircleIcon className="size-4 text-emerald-600" />}
              ></ChainOfThoughtStep>
              <ChainOfThoughtStep
                label={
                  task.result ? (
                    <MarkdownContent
                      content={task.result}
                      isLoading={false}
                      rehypePlugins={workspaceMessageRehypePlugins}
                    />
                  ) : null
                }
              ></ChainOfThoughtStep>
            </>
          )}
          {task.status === "failed" && (
            <ChainOfThoughtStep
              label={
                <div className="space-y-1">
                  <div className="font-medium text-red-500">{statusMeta.label}</div>
                  {task.error ? <div className="text-sm text-red-500">{task.error}</div> : null}
                </div>
              }
              icon={<XCircleIcon className="size-4 text-red-500" />}
            ></ChainOfThoughtStep>
          )}
        </ChainOfThoughtContent>
      </div>
    </ChainOfThought>
  );
}
