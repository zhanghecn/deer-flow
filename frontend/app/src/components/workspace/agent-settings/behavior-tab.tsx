import {
  BrainIcon,
  FileTextIcon,
  ExternalLinkIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AgentStatus } from "@/core/agents";
import { buildWorkspaceAgentAuthoringPath } from "@/core/authoring";

import type { AgentSettingsPageText } from "./i18n";
import { FieldLabel, SectionCard } from "./shared";
import type { AgentSettingsFormState } from "./types";

interface BehaviorTabProps {
  agentName: string;
  agentStatus: AgentStatus;
  form: AgentSettingsFormState;
  skillNames: string[];
  text: AgentSettingsPageText;
  onFormChange: (updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null) => void;
}

export function BehaviorTab({
  agentName,
  agentStatus,
  form,
  skillNames,
  text,
  onFormChange,
}: BehaviorTabProps) {
  return (
    <div className="space-y-6">
      {/* System Prompt */}
      <SectionCard
        eyebrow={<FileTextIcon className="size-4" />}
        title={text.promptTitle}
        description={text.promptDescription}
      >
        <div className="border-border/70 bg-muted/10 rounded-3xl border p-5">
          <p className="text-muted-foreground text-sm leading-6">
            {text.promptHint}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link
                to={buildWorkspaceAgentAuthoringPath({
                  agentName,
                  agentStatus,
                })}
              >
                <ExternalLinkIcon className="size-4" />
                {text.openWorkspace}
              </Link>
            </Button>
            <Badge variant="secondary">{text.editableBadge}</Badge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
            <FieldLabel className="mb-2">{text.runtimeContract}</FieldLabel>
            <p className="text-sm leading-6">
              {text.runtimeContractIntro}
            </p>
            <code className="bg-background border-border/70 mt-3 block rounded-2xl border px-3 py-3 text-xs leading-6 break-all">
              /mnt/user-data/agents/{agentStatus}/{agentName}/AGENTS.md
            </code>
          </div>
          <div className="border-border/70 bg-muted/20 rounded-3xl border p-4">
            <FieldLabel className="mb-2">{text.editingScope}</FieldLabel>
            <p className="text-muted-foreground text-sm leading-6">
              {text.editingScopeDescription}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Memory Settings */}
      <SectionCard
        eyebrow={<BrainIcon className="size-4" />}
        title={text.memoryTitle}
        description={text.memoryDescription}
      >
        <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
          <div>
            <p className="text-sm font-medium">{text.enableMemory}</p>
            <p className="text-muted-foreground text-xs leading-5">
              {text.enableMemoryDescription}
            </p>
          </div>
          <Switch
            checked={form.memoryEnabled}
            onCheckedChange={(checked) =>
              onFormChange((current) =>
                current ? { ...current, memoryEnabled: checked } : current,
              )
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <FieldLabel>{text.memoryModel}</FieldLabel>
            <Input
              value={form.memoryModel}
              placeholder={text.memoryModelPlaceholder}
              disabled={!form.memoryEnabled}
              onChange={(event) =>
                onFormChange((current) =>
                  current ? { ...current, memoryModel: event.target.value } : current,
                )
              }
              className="h-11 rounded-2xl"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.debounceSeconds}</FieldLabel>
            <Input
              type="number"
              min={1}
              max={300}
              value={form.debounceSeconds}
              disabled={!form.memoryEnabled}
              onChange={(event) =>
                onFormChange((current) =>
                  current ? { ...current, debounceSeconds: event.target.value } : current,
                )
              }
              className="h-11 rounded-2xl"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.maxFacts}</FieldLabel>
            <Input
              type="number"
              min={10}
              max={500}
              value={form.maxFacts}
              disabled={!form.memoryEnabled}
              onChange={(event) =>
                onFormChange((current) =>
                  current ? { ...current, maxFacts: event.target.value } : current,
                )
              }
              className="h-11 rounded-2xl"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.confidenceThreshold}</FieldLabel>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={form.confidenceThreshold}
              disabled={!form.memoryEnabled}
              onChange={(event) =>
                onFormChange((current) =>
                  current ? { ...current, confidenceThreshold: event.target.value } : current,
                )
              }
              className="h-11 rounded-2xl"
            />
          </div>
        </div>
      </SectionCard>

      {/* Prompt Injection */}
      <SectionCard
        eyebrow={<SlidersHorizontalIcon className="size-4" />}
        title={text.injectionTitle}
        description={text.injectionDescription}
      >
        <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
          <div>
            <p className="text-sm font-medium">{text.enableInjection}</p>
            <p className="text-muted-foreground text-xs leading-5">
              {text.enableInjectionDescription}
            </p>
          </div>
          <Switch
            checked={form.injectionEnabled}
            onCheckedChange={(checked) =>
              onFormChange((current) =>
                current ? { ...current, injectionEnabled: checked } : current,
              )
            }
          />
        </div>

        <div className="space-y-2">
          <FieldLabel>{text.maxInjectionTokens}</FieldLabel>
          <Input
            type="number"
            min={100}
            max={8000}
            value={form.maxInjectionTokens}
            disabled={!form.injectionEnabled}
            onChange={(event) =>
              onFormChange((current) =>
                current ? { ...current, maxInjectionTokens: event.target.value } : current,
              )
            }
            className="h-11 rounded-2xl"
          />
        </div>
      </SectionCard>

      {/* Archive Assets */}
      <SectionCard
        eyebrow={<FileTextIcon className="size-4" />}
        title={text.archiveAssetsTitle}
        description={text.archiveAssetsDescription}
        collapsible
      >
        <div className="space-y-3">
          <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{text.agentsMd}</p>
              <p className="text-muted-foreground text-xs leading-5">
                {text.agentsMdDescription}
              </p>
            </div>
            <Badge variant="secondary">{text.editableBadge}</Badge>
          </div>
          <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{text.configYaml}</p>
              <p className="text-muted-foreground text-xs leading-5">
                {text.configYamlDescription}
              </p>
            </div>
            <Badge variant="outline">{text.structuredBadge}</Badge>
          </div>
          <div className="border-border/70 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{text.skillsDirectory}</p>
              <p className="text-muted-foreground text-xs leading-5">
                {text.skillsDirectoryDescription}
              </p>
            </div>
            <Badge variant="outline">{skillNames.length}</Badge>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
