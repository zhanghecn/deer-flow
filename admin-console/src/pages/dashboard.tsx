import { StatsCards } from "@/components/dashboard/stats-cards";
import { RecentTraces } from "@/components/dashboard/recent-traces";
import { useFetch } from "@/hooks/use-fetch";
import type { AdminStats, TraceItem } from "@/types";

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } =
    useFetch<AdminStats>("/api/admin/stats");
  const { data: tracesData, isLoading: tracesLoading } =
    useFetch<{ items: TraceItem[] }>("/api/admin/traces?limit=5");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Overview of your platform metrics
        </p>
      </div>
      <StatsCards stats={stats} isLoading={statsLoading} />
      <RecentTraces
        traces={tracesData?.items ?? null}
        isLoading={tracesLoading}
      />
    </div>
  );
}
