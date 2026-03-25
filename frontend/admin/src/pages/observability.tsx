import { useEffect, useMemo, useState } from "react";
import { TraceFilters } from "@/components/observability/trace-filters";
import { TraceList } from "@/components/observability/trace-list";
import { TraceDetail } from "@/components/observability/trace-detail";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/hooks/use-fetch";
import { t } from "@/i18n";
import { maskString } from "@/lib/format";
import type { PaginatedResponse, TraceItem } from "@/types";

const PAGE_SIZE = 30;

export function ObservabilityPage() {
  const [userId, setUserId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [threadId, setThreadId] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTrace, setSelectedTrace] = useState<TraceItem | null>(null);
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

  const { data, isLoading } = useFetch<PaginatedResponse<TraceItem>>(
    `/api/admin/traces?${queryParams}`,
    { interval: 10000 },
  );

  useEffect(() => {
    setPage(1);
    setSelectedTrace(null);
  }, [userId, agentName, threadId]);

  const traces = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;
  const startRow = total === 0 ? 0 : offset + 1;
  const endRow = offset + traces.length;

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("Observability")}</h2>
        <p className="text-muted-foreground">
          {t("Monitor agent execution traces")}
        </p>
      </div>

      <TraceFilters
        userId={userId}
        agentName={agentName}
        threadId={threadId}
        onUserIdChange={setUserId}
        onAgentNameChange={setAgentName}
        onThreadIdChange={setThreadId}
      />

      {!selectedTrace ? (
        <div className="border rounded-md min-h-[520px] flex flex-col">
          <div className="border-b p-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("Trace List")}</p>
            <span className="text-xs text-muted-foreground">
              {t("Click one trace to view full chain details")}
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <TraceList
              traces={traces}
              isLoading={isLoading}
              selectedId={null}
              onSelect={setSelectedTrace}
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
                {maskString(selectedTrace.trace_id, 8, 6)}
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
  );
}
