import { CheckpointCard } from "@/components/threads/checkpoint-card";
import { ThreadsTable } from "@/components/threads/threads-table";
import { useFetch } from "@/hooks/use-fetch";
import type { CheckpointStatus, RuntimeThread } from "@/types";

export function ThreadsPage() {
  const { data: threadsData, isLoading: threadsLoading } =
    useFetch<{ items: RuntimeThread[] }>("/api/admin/runtime/threads");
  const { data: checkpointData, isLoading: checkpointLoading } =
    useFetch<CheckpointStatus>("/api/admin/runtime/checkpoint-status");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Threads</h2>
        <p className="text-muted-foreground">
          Runtime threads and checkpoint status
        </p>
      </div>

      <CheckpointCard
        status={checkpointData}
        isLoading={checkpointLoading}
      />

      <ThreadsTable
        threads={threadsData?.items ?? null}
        isLoading={threadsLoading}
      />
    </div>
  );
}
