import {
  BotIcon,
  MessageSquareIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  buildWorkspaceAgentPath,
  buildWorkspaceAgentSettingsPath,
  getAgentDirectoryAvailability,
  getAgentDirectoryDefaultTarget,
  groupAgentsByName,
  type AgentDirectoryEntry,
  type AgentStatus,
  useAgents,
  useDeleteAgent,
  usePublishAgent,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DeleteTarget = AgentStatus | "all";

function getDefaultStatusLabel(
  agent: AgentDirectoryEntry,
  t: ReturnType<typeof useI18n>["t"],
) {
  return getAgentDirectoryDefaultTarget(agent) === "draft"
    ? t.agents.defaultDraft
    : t.agents.defaultPublished;
}

function getAvailabilityLabel(
  agent: AgentDirectoryEntry,
  t: ReturnType<typeof useI18n>["t"],
) {
  const availability = getAgentDirectoryAvailability(agent);
  if (availability === "publishedReady") {
    return t.agents.publishedReady;
  }
  return availability === "draftOnly"
    ? t.agents.draftOnly
    : t.agents.publishedOnly;
}

function AgentDirectoryRow({ agent }: { agent: AgentDirectoryEntry }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeleteTarget, setPendingDeleteTarget] =
    useState<DeleteTarget | null>(null);
  const deleteAgentMutation = useDeleteAgent();
  const publishAgentMutation = usePublishAgent();
  const canPublish = agent.canManage && agent.devAgent != null;
  const canDelete =
    agent.canManage &&
    agent.name !== "lead_agent" &&
    (agent.devAgent != null || agent.prodAgent != null);
  const hasDraftArchive = agent.devAgent != null;
  const hasPublishedArchive = agent.prodAgent != null;

  const handleChat = () => {
    void navigate(
      buildWorkspaceAgentPath({
        agentName: agent.name,
        agentStatus: agent.defaultChatStatus,
      }),
    );
  };

  const handleSettings = () => {
    void navigate(
      buildWorkspaceAgentSettingsPath({
        agentName: agent.name,
        agentStatus: agent.defaultSettingsStatus,
      }),
    );
  };

  const handlePublish = async () => {
    try {
      await publishAgentMutation.mutateAsync(agent.name);
      toast.success(t.agents.publishSuccess(agent.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const getDeleteSuccessMessage = (target: DeleteTarget) => {
    if (target === "dev") {
      return t.agents.deleteDraftSuccess(agent.name);
    }
    if (target === "prod") {
      return t.agents.deletePublishedSuccess(agent.name);
    }
    return t.agents.deleteAllArchivesSuccess(agent.name);
  };

  const handleDelete = async (target: DeleteTarget) => {
    setPendingDeleteTarget(target);

    try {
      await deleteAgentMutation.mutateAsync({
        name: agent.name,
        status: target === "all" ? undefined : target,
      });
      toast.success(getDeleteSuccessMessage(target));
      setDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingDeleteTarget(null);
    }
  };

  return (
    <>
      <TableRow>
        <TableCell className="min-w-[280px]">
          <div className="flex items-start gap-3">
            <div className="bg-muted text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md border">
              <BotIcon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate font-medium">{agent.name}</div>
                {agent.name === "lead_agent" && (
                  <Badge variant="outline" className="rounded-sm text-[10px]">
                    {t.agents.coreBadge}
                  </Badge>
                )}
                {!agent.canManage && (
                  <Badge variant="outline" className="rounded-sm text-[10px]">
                    {t.agents.readOnlyBadge}
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground line-clamp-2 text-sm leading-6">
                {agent.description || t.agents.switcher.builtinDescription}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="w-[150px]">
          <div className="font-medium">{getDefaultStatusLabel(agent, t)}</div>
        </TableCell>
        <TableCell className="w-[170px]">
          <div className="font-medium">{getAvailabilityLabel(agent, t)}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Draft {agent.devAgent ? "available" : "missing"} · Published{" "}
            {agent.prodAgent ? "available" : "missing"}
          </div>
        </TableCell>
        <TableCell className="w-[120px]">
          <div className="font-medium">
            {agent.canManage ? "Manage" : "Read-only"}
          </div>
        </TableCell>
        {/* Keep actions in one compact lane so this reads like a directory,
            not a landing page full of competing CTA blocks. */}
        <TableCell className="w-[320px]">
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={handleChat}>
              <MessageSquareIcon className="mr-1.5 h-4 w-4" />
              {t.agents.startChatting}
            </Button>
            {agent.canManage && (
              <Button size="sm" variant="outline" onClick={handleSettings}>
                <Settings2Icon className="mr-1.5 h-4 w-4" />
                {t.common.settings}
              </Button>
            )}
            {canPublish && (
              <Button
                size="sm"
                variant="outline"
                onClick={handlePublish}
                disabled={publishAgentMutation.isPending}
              >
                <RocketIcon className="mr-1.5 h-4 w-4" />
                {t.agents.publishToProd}
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/25 text-destructive hover:bg-destructive/5 hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon className="mr-1.5 h-4 w-4" />
                {t.agents.delete}
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.deleteArchiveTitle(agent.name)}</DialogTitle>
            <DialogDescription>
              {t.agents.deleteArchiveDescription(agent.name)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {hasDraftArchive && (
              <Button
                variant="destructive"
                onClick={() => void handleDelete("dev")}
                disabled={pendingDeleteTarget != null}
              >
                {pendingDeleteTarget === "dev" && (
                  <Trash2Icon className="size-4 animate-pulse" />
                )}
                {t.agents.deleteDraft}
              </Button>
            )}
            {hasPublishedArchive && (
              <Button
                variant="destructive"
                onClick={() => void handleDelete("prod")}
                disabled={pendingDeleteTarget != null}
              >
                {pendingDeleteTarget === "prod" && (
                  <Trash2Icon className="size-4 animate-pulse" />
                )}
                {t.agents.deletePublished}
              </Button>
            )}
            {hasDraftArchive && hasPublishedArchive && (
              <Button
                variant="destructive"
                onClick={() => void handleDelete("all")}
                disabled={pendingDeleteTarget != null}
              >
                {pendingDeleteTarget === "all" && (
                  <Trash2Icon className="size-4 animate-pulse" />
                )}
                {t.agents.deleteAllArchives}
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => setDeleteOpen(false)}
            disabled={pendingDeleteTarget != null}
          >
            {t.common.cancel}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AgentGallery() {
  const { t } = useI18n();
  const { agents, isLoading } = useAgents();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  // Collapse draft/prod archives into one visible entry so the gallery reflects
  // how operators think about agents, not how storage versions are represented.
  const groupedAgents = useMemo(() => groupAgentsByName(agents), [agents]);
  const filteredAgents = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return groupedAgents;

    return groupedAgents.filter((agent) => {
      const haystack = [
        agent.name,
        agent.description,
        getDefaultStatusLabel(agent, t),
        getAvailabilityLabel(agent, t),
        agent.canManage ? "manage" : "read-only",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [groupedAgents, searchValue, t]);
  const stats = useMemo(
    () => ({
      total: groupedAgents.length,
      manageable: groupedAgents.filter((agent) => agent.canManage).length,
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
      <div className="border-b bg-background px-6 py-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t.agents.title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.agents.description}
            </p>
            <p className="text-muted-foreground mt-3 text-sm">
              {stats.total} agents · {stats.published} published · {stats.draft}{" "}
              drafts · {stats.manageable} manageable
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[360px]">
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search agents"
                className="pl-9"
              />
            </div>
            <Button onClick={handleNewAgent}>
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.agents.newAgent}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/20 p-6">
        {isLoading ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            {t.agents.description}
            {" · "}
            {t.common.loading}
          </div>
        ) : groupedAgents.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-md border bg-background px-6 text-center">
            <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-md">
              <BotIcon className="text-muted-foreground h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">{t.agents.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.agents.emptyDescription}
              </p>
            </div>
            <Button variant="outline" className="mt-2" onClick={handleNewAgent}>
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.agents.newAgent}
            </Button>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-md border bg-background px-6 text-center">
            <p className="font-medium">No matching agents</p>
            <p className="text-muted-foreground text-sm">
              Try a different name, status, or availability term.
            </p>
          </div>
        ) : (
          <div className="rounded-md border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAgents.map((agent) => (
                  <AgentDirectoryRow key={agent.name} agent={agent} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
