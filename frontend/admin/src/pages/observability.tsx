import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TraceFilters } from "@/components/observability/trace-filters";
import { TraceList } from "@/components/observability/trace-list";
import { TraceDetail } from "@/components/observability/trace-detail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/hooks/use-fetch";
import { api } from "@/lib/api";
import { t } from "@/i18n";
import type { PaginatedResponse, TraceItem } from "@/types";

const PAGE_SIZE = 30;

export function ObservabilityPage() {
  const [searchParams] = useSearchParams();
  const [userId, setUserId] = useState(() => searchParams.get("user_id") ?? "");
  const [agentName, setAgentName] = useState(
    () => searchParams.get("agent_name") ?? "",
  );
  const [threadId, setThreadId] = useState(
    () => searchParams.get("thread_id") ?? "",
  );
  const [page, setPage] = useState(1);
  const [selectedTrace, setSelectedTrace] = useState<TraceItem | null>(null);
  const [selectedTraceIds, setSelectedTraceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingTraces, setIsDeletingTraces] = useState(false);
  const offset = (page - 1) * PAGE_SIZE;

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (userId) params.set("user_id", userId);
    if (agentName) params.set("agent_name", agentName);
    if (threadId) params.set("thread_id", threadId);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    return params.toString();
  }, [userId, agentName, threadId, offset]);

  const { data, isLoading, refetch } = useFetch<PaginatedResponse<TraceItem>>(
    `/api/admin/traces?${queryParams}`,
    { interval: 10000 },
  );

  function resetTraceList() {
    setPage(1);
    setSelectedTrace(null);
    setSelectedTraceIds(new Set());
  }

  const traces = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;
  const startRow = total === 0 ? 0 : offset + 1;
  const endRow = offset + traces.length;
  const selectedCount = selectedTraceIds.size;
  const allVisibleSelected =
    traces.length > 0 &&
    traces.every((trace) => selectedTraceIds.has(trace.trace_id));

  function toggleTraceSelection(traceId: string, selected: boolean) {
    setSelectedTraceIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(traceId);
      } else {
        next.delete(traceId);
      }
      return next;
    });
  }

  function toggleVisibleSelection(selected: boolean) {
    setSelectedTraceIds((current) => {
      const next = new Set(current);
      for (const trace of traces) {
        if (selected) {
          next.add(trace.trace_id);
        } else {
          next.delete(trace.trace_id);
        }
      }
      return next;
    });
  }

  async function deleteSelectedTraces() {
    const traceIds = [...selectedTraceIds];
    if (traceIds.length === 0) {
      return;
    }

    setIsDeletingTraces(true);
    try {
      const response = await api<{ deleted: number }>("/api/admin/traces", {
        method: "DELETE",
        body: { trace_ids: traceIds },
      });
      toast.success(t("Deleted {count} traces", { count: response.deleted }));
      setSelectedTraceIds(new Set());
      setIsDeleteDialogOpen(false);
      setPage(1);
      refetch();
    } catch {
      toast.error(t("Failed to delete traces"));
    } finally {
      setIsDeletingTraces(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {t("Observability")}
          </h2>
          <p className="text-muted-foreground">
            {t("Monitor agent execution traces")}
          </p>
        </div>

        <TraceFilters
          userId={userId}
          agentName={agentName}
          threadId={threadId}
          onUserIdChange={(value) => {
            setUserId(value);
            resetTraceList();
          }}
          onAgentNameChange={(value) => {
            setAgentName(value);
            resetTraceList();
          }}
          onThreadIdChange={(value) => {
            setThreadId(value);
            resetTraceList();
          }}
        />

        {!selectedTrace ? (
          <div className="border rounded-md min-h-[520px] flex flex-col">
            <div className="border-b p-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t("Trace List")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {traces.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) =>
                        toggleVisibleSelection(event.target.checked)
                      }
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    {t("Select page")}
                  </label>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selectedCount === 0}
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  {selectedCount > 0
                    ? t("Delete selected ({count})", { count: selectedCount })
                    : t("Delete selected")}
                </Button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <TraceList
                traces={traces}
                isLoading={isLoading}
                selectedIds={selectedTraceIds}
                onSelect={setSelectedTrace}
                onToggleSelect={toggleTraceSelection}
              />
            </div>
            <div className="border-t p-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {total === 0
                  ? t("0 traces")
                  : t("{start}-{end} of {total}", {
                      start: startRow,
                      end: endRow,
                      total,
                    })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasPrevPage || isLoading}
                  onClick={() => setPage((v) => Math.max(1, v - 1))}
                >
                  {t("Prev")}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {page}/{totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNextPage || isLoading}
                  onClick={() => setPage((v) => v + 1)}
                >
                  {t("Next")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border rounded-md min-h-[520px]">
            <div className="border-b px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedTrace(null)}
                >
                  {t("Back to List")}
                </Button>
                <span className="text-sm font-medium">
                  {selectedTrace.agent_name || t("Unknown Agent")}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {selectedTrace.trace_id}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("Full Trace View")}
              </span>
            </div>
            <TraceDetail trace={selectedTrace} expanded />
          </div>
        )}
      </div>
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Delete {count} traces?", { count: selectedCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "This only deletes observability traces and their captured events. Runtime threads, messages, checkpoints, and files are not deleted.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingTraces}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingTraces || selectedCount === 0}
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedTraces();
              }}
            >
              {isDeletingTraces ? t("Deleting...") : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
