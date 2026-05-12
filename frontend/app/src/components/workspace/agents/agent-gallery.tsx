import {
  BotIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentCard } from "@/components/workspace/agents/agent-card";
import {
  groupAgentsByName,
  useAgents,
  useImportAgentPackage,
} from "@/core/agents";
import type { AgentPackage } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

export function AgentGallery() {
  const { t } = useI18n();
  const { agents, isLoading } = useAgents();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importAgentMutation = useImportAgentPackage();
  const groupedAgents = useMemo(() => groupAgentsByName(agents), [agents]);
  const filteredAgents = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return groupedAgents;

    return groupedAgents.filter((agent) => {
      const haystack = [
        agent.name,
        agent.description,
        agent.canManage ? "manage" : "read-only",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [groupedAgents, searchValue]);
  const stats = useMemo(
    () => ({
      total: groupedAgents.length,
      published: groupedAgents.filter((agent) => agent.prodAgent != null)
        .length,
      draft: groupedAgents.filter((agent) => agent.devAgent != null).length,
    }),
    [groupedAgents],
  );

  const handleNewAgent = () => {
    void navigate("/workspace/agents/new");
  };

  const handleImportAgent = () => {
    importInputRef.current?.click();
  };

  const handleImportAgentFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      toast.error(t.agents.importFailed(t.agents.importInvalidType));
      return;
    }

    try {
      const text = await file.text();
      const pkg = JSON.parse(text) as AgentPackage;
      const imported = await importAgentMutation.mutateAsync(pkg);
      toast.success(t.agents.importSuccess(imported.name));
      void navigate(
        `/workspace/agents/${encodeURIComponent(imported.name)}/settings?agent_status=${imported.status}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      toast.error(t.agents.importFailed(detail));
    }
  };

  return (
    <div className="flex size-full flex-col">
      {/* Header — tighter spacing, clearer hierarchy */}
      <div className="bg-background border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight">
                {t.agents.title}
              </h1>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t.agents.gallerySummary(
                  stats.total,
                  stats.published,
                  stats.draft,
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={t.agents.switcher.searchPlaceholder}
                className="bg-muted/40 focus-visible:ring-ring h-8 w-44 border-0 pl-8 text-sm focus-visible:ring-1"
              />
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void handleImportAgentFile(event)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={importAgentMutation.isPending}
              onClick={handleImportAgent}
              className="gap-1"
            >
              {importAgentMutation.isPending ? (
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadIcon className="h-3.5 w-3.5" />
              )}
              {importAgentMutation.isPending
                ? t.agents.importingAgent
                : t.agents.importAgent}
            </Button>
            {/* Primary action: filled button for clear hierarchy */}
            <Button size="sm" onClick={handleNewAgent} className="gap-1">
              <PlusIcon className="h-3.5 w-3.5" />
              {t.agents.newAgent}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="text-muted-foreground flex items-center gap-2.5 text-sm">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t.common.loading}
            </div>
          </div>
        ) : groupedAgents.length === 0 ? (
          /* Empty state — consistent iconography, centered, calmer colors */
          <div className="flex flex-col items-center justify-center gap-4 py-24">
            <div className="bg-muted text-muted-foreground flex h-12 w-12 items-center justify-center rounded-xl">
              <BotIcon className="h-6 w-6" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t.agents.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 max-w-xs text-sm">
                {t.agents.emptyDescription}
              </p>
            </div>
            <Button size="sm" onClick={handleNewAgent}>
              <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
              {t.agents.newAgent}
            </Button>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <p className="text-sm font-medium">{t.agents.switcher.empty}</p>
            <p className="text-muted-foreground text-xs">
              {t.agents.galleryEmptySearchDescription}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredAgents.map((agent) => (
              <AgentCard key={agent.name} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
