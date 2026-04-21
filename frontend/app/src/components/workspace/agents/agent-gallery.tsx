import {
  BotIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentCard } from "@/components/workspace/agents/agent-card";
import {
  groupAgentsByName,
  useAgents,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

export function AgentGallery() {
  const { t } = useI18n();
  const { agents, isLoading } = useAgents();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
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
      published: groupedAgents.filter((agent) => agent.prodAgent != null).length,
      draft: groupedAgents.filter((agent) => agent.devAgent != null).length,
    }),
    [groupedAgents],
  );

  const handleNewAgent = () => {
    void navigate("/workspace/agents/new");
  };

  return (
    <div className="flex size-full flex-col">
      {/* Header — tighter spacing, clearer hierarchy */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight">{t.agents.title}</h1>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t.agents.gallerySummary(
                  stats.total,
                  stats.published,
                  stats.draft,
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={t.agents.switcher.searchPlaceholder}
                className="h-8 w-44 pl-8 text-sm bg-muted/40 border-0 focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
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
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t.common.loading}
            </div>
          </div>
        ) : groupedAgents.length === 0 ? (
          /* Empty state — consistent iconography, centered, calmer colors */
          <div className="flex flex-col items-center justify-center gap-4 py-24">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <BotIcon className="h-6 w-6" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t.agents.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm max-w-xs">
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
            <p className="text-xs text-muted-foreground">
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
