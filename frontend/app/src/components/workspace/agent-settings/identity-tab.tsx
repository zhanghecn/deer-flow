import {
  BotIcon,
  BrainIcon,
  Link2Icon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { Agent, AgentStatus } from "@/core/agents";
import { isLeadAgent } from "@/core/agents";
import type { Model } from "@/core/models/types";

import type { AgentSettingsPageText } from "./i18n";
import { ModelSelect } from "./model-select";
import { FieldLabel, SectionCard, StatCard } from "./shared";
import type { AgentSettingsFormState, SettingsTab } from "./types";

interface IdentityTabProps {
  agent: Agent;
  form: AgentSettingsFormState;
  agentStatus: AgentStatus;
  models: Model[];
  modelsLoading: boolean;
  modelsError: unknown;
  selectedMainToolNames: string[];
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
  onTabChange: (tab: SettingsTab) => void;
  ownerLabel: string;
  skillNames: string[];
  mcpServerCount: number;
  text: AgentSettingsPageText;
}

export function IdentityTab({
  agent,
  form,
  agentStatus,
  models,
  modelsLoading,
  modelsError,
  selectedMainToolNames,
  onFormChange,
  onTabChange,
  ownerLabel,
  skillNames,
  mcpServerCount,
  text,
}: IdentityTabProps) {
  return (
    <div className="space-y-6">
      {/* Agent Name Card */}
      <div className="flex items-start gap-5">
        <div className="bg-primary/10 text-primary flex size-16 shrink-0 items-center justify-center rounded-2xl">
          <BotIcon className="size-8" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{agent.name}</h2>
            <Badge variant="outline" className="capitalize">
              {agentStatus}
            </Badge>
            {agent.can_manage === false && (
              <Badge variant="secondary">{text.readOnly}</Badge>
            )}
          </div>
          {agent.model && (
            <p className="text-muted-foreground mt-1 text-sm">{agent.model}</p>
          )}
        </div>
      </div>

      {/* Basic Info */}
      <SectionCard
        eyebrow={<BotIcon className="size-4" />}
        title={text.identityTitle}
        description={text.identityDescription}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <FieldLabel>{text.agentName}</FieldLabel>
            <div className="bg-muted/35 border-border/70 flex h-11 items-center rounded-2xl border px-3 text-sm font-medium">
              {agent.name}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.modelOverride}</FieldLabel>
            <ModelSelect
              value={form.model}
              models={models}
              isLoading={modelsLoading}
              placeholder={text.selectModel}
              emptyLabel={text.inheritWorkspaceModel}
              unavailableLabel={text.unavailableModel}
              onChange={(nextValue) =>
                onFormChange((current) => ({
                  ...current,
                  model: nextValue,
                }))
              }
            />
            {modelsError ? (
              <p className="text-destructive text-xs leading-5">
                {modelsError instanceof Error
                  ? modelsError.message
                  : text.loadModelsFailed}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <FieldLabel>{text.description}</FieldLabel>
          <Textarea
            value={form.description}
            placeholder={text.descriptionPlaceholder}
            onChange={(event) =>
              onFormChange((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            className="min-h-28 rounded-3xl px-4 py-3 text-sm leading-6"
          />
        </div>
      </SectionCard>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label={text.skillsLabel}
          value={form.skillRefs.length}
          onClick={() => onTabChange("capabilities")}
        />
        <StatCard
          label={text.toolsLabel}
          value={selectedMainToolNames.length}
          onClick={() => onTabChange("capabilities")}
        />
        <StatCard
          label={text.subagentsLabel}
          value={form.subagents.length}
          onClick={() => onTabChange("capabilities")}
        />
        <StatCard
          label={text.mcpLabel}
          value={mcpServerCount}
          onClick={() => onTabChange("capabilities")}
        />
      </div>

      {/* Archive Context */}
      <SectionCard
        eyebrow={<SparklesIcon className="size-4" />}
        title={text.archiveContextTitle}
        description={text.archiveContextDescription}
      >
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="capitalize">
            {agent.status}
          </Badge>
          <Badge variant="outline">
            {text.ownerBadge}: {ownerLabel}
          </Badge>
          {agent.model && <Badge variant="secondary">{agent.model}</Badge>}
          <Badge variant="outline">
            {form.skillRefs.length} {text.skillsLabel}
          </Badge>
        </div>

        {isLeadAgent(agent.name) && (
          <p className="text-muted-foreground border-border/70 bg-muted/25 rounded-2xl border px-4 py-3 text-xs leading-6">
            {text.leadAgentNote}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {skillNames.length > 0 ? (
            skillNames.map((skillName) => (
              <Badge
                key={skillName}
                variant="secondary"
                className="rounded-full px-2.5 py-1 text-xs"
              >
                {skillName}
              </Badge>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              {text.noSkillsAttached}
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
