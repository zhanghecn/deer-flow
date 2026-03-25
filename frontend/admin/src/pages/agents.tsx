import { useState } from "react";
import { AgentsTable } from "@/components/agents/agents-table";
import { AgentDetail } from "@/components/agents/agent-detail";
import { useFetch } from "@/hooks/use-fetch";
import { t } from "@/i18n";
import type { Agent } from "@/types";

export function AgentsPage() {
  const { data, isLoading, refetch } =
    useFetch<{ agents: Agent[] }>("/api/agents");
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("Agents")}</h2>
        <p className="text-muted-foreground">
          {t("Manage agent definitions and publish")}
        </p>
      </div>
      <AgentsTable
        agents={data?.agents ?? null}
        isLoading={isLoading}
        onRefetch={refetch}
        onViewDetail={setDetailAgent}
      />
      <AgentDetail
        agent={detailAgent}
        open={!!detailAgent}
        onSaved={refetch}
        onOpenChange={(open) => !open && setDetailAgent(null)}
      />
    </div>
  );
}
