import { useState, useMemo } from "react";
import { TraceFilters } from "@/components/observability/trace-filters";
import { TraceList } from "@/components/observability/trace-list";
import { TraceDetail } from "@/components/observability/trace-detail";
import { useFetch } from "@/hooks/use-fetch";
import type { TraceItem } from "@/types";

export function ObservabilityPage() {
  const [userId, setUserId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [threadId, setThreadId] = useState("");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (userId) params.set("user_id", userId);
    if (agentName) params.set("agent_name", agentName);
    if (threadId) params.set("thread_id", threadId);
    params.set("limit", "50");
    return params.toString();
  }, [userId, agentName, threadId]);

  const { data, isLoading } = useFetch<{ items: TraceItem[] }>(
    `/api/admin/traces?${queryParams}`,
    { interval: 10000 },
  );

  const selectedTrace = useMemo(
    () => data?.items?.find((t) => t.trace_id === selectedTraceId) ?? null,
    [data, selectedTraceId],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Observability</h2>
        <p className="text-muted-foreground">
          Monitor agent execution traces
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 border rounded-md">
          <TraceList
            traces={data?.items ?? null}
            isLoading={isLoading}
            selectedId={selectedTraceId}
            onSelect={setSelectedTraceId}
          />
        </div>
        <div className="lg:col-span-3 border rounded-md min-h-[400px]">
          <TraceDetail trace={selectedTrace} />
        </div>
      </div>
    </div>
  );
}
