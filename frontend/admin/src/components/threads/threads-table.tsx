import { ExternalLink, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import type { RuntimeThread } from "@/types";
import { toast } from "sonner";

interface ThreadsTableProps {
  threads: RuntimeThread[] | null;
  isLoading: boolean;
}

export function ThreadsTable({ threads, isLoading }: ThreadsTableProps) {
  async function handleOpenRuntime(threadID: string) {
    try {
      const session = await api<{ relative_url: string }>(
        `/api/threads/${threadID}/runtime-workspace/open`,
        { method: "POST" },
      );
      const url = new URL(session.relative_url, window.location.origin);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("Failed to open runtime workspace"));
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!threads?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <MessagesSquare className="h-12 w-12 mb-2 opacity-40" />
        <p>{t("No threads found")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Thread ID")}</TableHead>
            <TableHead>{t("User")}</TableHead>
            <TableHead>{t("Agent")}</TableHead>
            <TableHead>{t("Model")}</TableHead>
            <TableHead>{t("Assistant")}</TableHead>
            <TableHead>{t("Created")}</TableHead>
            <TableHead>{t("Updated")}</TableHead>
            <TableHead className="text-right">{t("Actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {threads.map((thread) => (
            <TableRow key={thread.thread_id}>
              <TableCell className="font-mono text-xs">
                {thread.thread_id}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {thread.user_id || "-"}
              </TableCell>
              <TableCell>
                {thread.agent_name ? (
                  <Badge variant="outline">{thread.agent_name}</Badge>
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {thread.model_name || "-"}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-muted-foreground">
                {thread.assistant_id || "-"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatAgo(thread.created_at)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatAgo(thread.updated_at)}
              </TableCell>
              <TableCell className="text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleOpenRuntime(thread.thread_id)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Open runtime workspace")}</TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
