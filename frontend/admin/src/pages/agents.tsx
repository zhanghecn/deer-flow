import { UploadIcon } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { AgentsTable } from "@/components/agents/agents-table";
import { AgentDetail } from "@/components/agents/agent-detail";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/hooks/use-fetch";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import {
  buildAgentRecords,
  getAvailableAgentStatuses,
  getPreferredAgentStatus,
  type AgentRecord,
} from "@/lib/agents";
import type { Agent, AgentPackage } from "@/types";

function downloadAgentPackage(pkg: AgentPackage) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${pkg.agent.name}-${pkg.agent.status}.openagents-agent.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AgentsPage() {
  const { data, isLoading, refetch } =
    useFetch<{ agents: Agent[] }>("/api/agents");
  const [detailAgent, setDetailAgent] = useState<AgentRecord | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const agentRecords = useMemo(
    () => buildAgentRecords(data?.agents ?? []),
    [data?.agents],
  );

  async function handleExportPackage(agent: Agent) {
    const key = `${agent.name}:${agent.status}`;
    setExportingKey(key);
    try {
      const pkg = await api<AgentPackage>(
        `/api/agents/${encodeURIComponent(agent.name)}/package?status=${agent.status}`,
      );
      downloadAgentPackage(pkg);
      toast.success(t("{name} package exported", { name: pkg.agent.name }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Failed to export agent package"),
      );
    } finally {
      setExportingKey(null);
    }
  }

  async function handleImportPackage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setIsImporting(true);
    try {
      const payload = JSON.parse(await file.text()) as AgentPackage;
      const imported = await api<Agent>("/api/agents/import", {
        method: "POST",
        body: payload,
      });
      toast.success(t("{name} imported", { name: imported.name }));
      refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Failed to import agent package"),
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("Agents")}</h2>
          <p className="text-muted-foreground">
            {t("Manage agent definitions and publish")}
          </p>
        </div>
        <div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={t("Select an OpenAgents agent package JSON file")}
            onChange={(event) => void handleImportPackage(event)}
          />
          <Button
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={isImporting}
          >
            <UploadIcon className="h-4 w-4" />
            {t(isImporting ? "Importing..." : "Import package")}
          </Button>
        </div>
      </div>
      <AgentsTable
        agents={data ? agentRecords : null}
        isLoading={isLoading}
        exportingKey={exportingKey}
        onRefetch={refetch}
        onViewDetail={setDetailAgent}
        onExportPackage={(agent) => void handleExportPackage(agent)}
      />
      <AgentDetail
        agentName={detailAgent?.name ?? null}
        initialStatus={detailAgent ? getPreferredAgentStatus(detailAgent) : "dev"}
        availableStatuses={detailAgent ? getAvailableAgentStatuses(detailAgent) : []}
        open={!!detailAgent}
        onSaved={refetch}
        onExportPackage={(agent) => void handleExportPackage(agent)}
        onOpenChange={(open) => !open && setDetailAgent(null)}
      />
    </div>
  );
}
