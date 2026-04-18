import {
  BotIcon,
  CheckIcon,
  Link2Icon,
  Loader2Icon,
  PlusIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type AgentSkillRef,
  type AgentStatus,
  type ToolCatalogItem,
} from "@/core/agents";
import {
  createSkillRef,
  isSkillRefSelected,
  removeSkillRef,
  toggleSkillRefSelection,
  skillRefKey,
} from "@/components/workspace/agent-skill-refs";
import { resolveEffectiveToolNames } from "@/components/workspace/agent-tool-selection";
import type { MCPProfile } from "@/core/mcp/types";
import { getLocalizedSkillDescription } from "@/core/skills";
import type { Skill } from "@/core/skills/type";
import {
  DEFAULT_SKILL_SCOPE,
  filterSkillsByScope,
  formatSkillScopeLabel,
  getAllowedSkillScopesForAgent,
  getDuplicateSkillNames,
  normalizeSkillScope,
  type SkillScope,
} from "@/core/skills/scope";
import { cn } from "@/lib/utils";

import type { AgentSettingsPageText } from "./i18n";
import { FieldLabel, SectionCard } from "./shared";
import type { AgentSettingsFormState, AgentSubagentFormState } from "./types";

interface CapabilitiesTabProps {
  form: AgentSettingsFormState;
  agentStatus: AgentStatus;
  onFormChange: (updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null) => void;
  text: AgentSettingsPageText;
  // Skills
  availableSkills: Skill[];
  skillsLoading: boolean;
  skillsError: unknown;
  locale: "en-US" | "zh-CN";
  // Tools
  mainToolOptions: ToolCatalogItem[];
  subagentToolOptions: ToolCatalogItem[];
  selectedMainToolNames: string[];
  toolCatalogLoading: boolean;
  toolCatalogError: unknown;
  // MCP
  mcpProfiles: MCPProfile[];
  mcpProfilesLoading: boolean;
  mcpProfilesError: unknown;
  mcpProfileQuery: string;
  onMcpProfileQueryChange: (query: string) => void;
}

let draftSubagentCounter = 0;
function nextSubagentDraftID() {
  draftSubagentCounter += 1;
  return `draft-subagent-${draftSubagentCounter}`;
}

export function CapabilitiesTab({
  form,
  agentStatus,
  onFormChange,
  text,
  availableSkills,
  skillsLoading,
  skillsError,
  locale,
  mainToolOptions,
  subagentToolOptions,
  selectedMainToolNames,
  toolCatalogLoading,
  toolCatalogError,
  mcpProfiles,
  mcpProfilesLoading,
  mcpProfilesError,
  mcpProfileQuery,
  onMcpProfileQueryChange,
}: CapabilitiesTabProps) {
  const allowedSkillScopes = getAllowedSkillScopesForAgent(agentStatus);

  const availableSkillCategories = allowedSkillScopes.filter((scope) =>
    availableSkills.some(
      (skill) => normalizeSkillScope(skill.category) === scope,
    ),
  );

  return (
    <div className="space-y-6">
      {/* Skills Section */}
      <SkillsSection
        form={form}
        agentStatus={agentStatus}
        availableSkills={availableSkills}
        skillsLoading={skillsLoading}
        skillsError={skillsError}
        allowedSkillScopes={allowedSkillScopes}
        availableSkillCategories={availableSkillCategories}
        locale={locale}
        text={text}
        onFormChange={onFormChange}
      />

      {/* Tools Section */}
      <ToolsSection
        mainToolOptions={mainToolOptions}
        selectedMainToolNames={selectedMainToolNames}
        toolCatalogLoading={toolCatalogLoading}
        toolCatalogError={toolCatalogError}
        text={text}
        onToggleTool={(toolName) =>
          onFormChange((current) => {
            if (!current) return current;
            const resolved = resolveEffectiveToolNames(
              { toolSelectionEnabled: current.toolSelectionEnabled, toolNames: current.toolNames, toolGroups: current.toolGroups },
              mainToolOptions,
              "main",
            );
            const toggle = (values: string[]) =>
              values.includes(toolName)
                ? values.filter((v) => v !== toolName)
                : [...values, toolName];
            return {
              ...current,
              toolSelectionEnabled: true,
              toolGroups: "",
              toolNames: toggle(resolved),
            };
          })
        }
      />

      {/* Subagents Section */}
      <SubagentsSection
        form={form}
        mainToolOptions={mainToolOptions}
        subagentToolOptions={subagentToolOptions}
        toolCatalogLoading={toolCatalogLoading}
        toolCatalogError={toolCatalogError}
        text={text}
        onFormChange={onFormChange}
      />

      {/* MCP Section */}
      <MCPSection
        form={form}
        mcpProfiles={mcpProfiles}
        mcpProfilesLoading={mcpProfilesLoading}
        mcpProfilesError={mcpProfilesError}
        mcpProfileQuery={mcpProfileQuery}
        onMcpProfileQueryChange={onMcpProfileQueryChange}
        text={text}
        onFormChange={onFormChange}
      />
    </div>
  );
}

// --- Skills ---
function SkillsSection({
  form,
  agentStatus,
  availableSkills,
  skillsLoading,
  skillsError,
  allowedSkillScopes,
  availableSkillCategories,
  locale,
  text,
  onFormChange,
}: {
  form: AgentSettingsFormState;
  agentStatus: AgentStatus;
  availableSkills: Skill[];
  skillsLoading: boolean;
  skillsError: unknown;
  allowedSkillScopes: SkillScope[];
  availableSkillCategories: SkillScope[];
  locale: "en-US" | "zh-CN";
  text: AgentSettingsPageText;
  onFormChange: (updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null) => void;
}) {
  const duplicateSkillNames = getDuplicateSkillNames(availableSkills, allowedSkillScopes);
  const duplicateSkillNamesLabel = [...duplicateSkillNames].sort().join(", ");
  const [skillsCategory, setSkillsCategory] = useState<SkillScope>(DEFAULT_SKILL_SCOPE);

  useEffect(() => {
    if (availableSkillCategories.length > 0 && !availableSkillCategories.includes(skillsCategory)) {
      setSkillsCategory(availableSkillCategories[0]!);
    }
  }, [availableSkillCategories, skillsCategory]);

  const selectableSkills = availableSkills.filter((skill) => {
    const scope = normalizeSkillScope(skill.category);
    return scope != null && allowedSkillScopes.includes(scope);
  });
  const filteredSkills = filterSkillsByScope(selectableSkills, skillsCategory);

  function handleToggleSkill(skill: Skill) {
    const nextRef = createSkillRef(skill);
    onFormChange((current) => {
      if (!current) return current;
      return { ...current, skillRefs: toggleSkillRefSelection(current.skillRefs, nextRef) };
    });
  }

  function handleRemoveSkill(skillRef: AgentSkillRef) {
    onFormChange((current) => {
      if (!current) return current;
      return { ...current, skillRefs: removeSkillRef(current.skillRefs, skillRef) };
    });
  }

  return (
    <SectionCard
      eyebrow={<SparklesIcon className="size-4" />}
      title={text.skillsTitle}
      description={
        agentStatus === "prod"
          ? text.skillsDescriptionProd
          : text.skillsDescriptionDev
      }
      collapsible
    >
      <div className="flex flex-wrap gap-2">
        {availableSkillCategories.map((category) => {
          const active = category === skillsCategory;
          return (
            <Button
              key={category}
              variant={active ? "secondary" : "outline"}
              className="rounded-full"
              onClick={() => setSkillsCategory(category)}
            >
              {formatSkillScopeLabel(category, locale)}
            </Button>
          );
        })}
      </div>

      {skillsLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          {text.loadingSkills}
        </div>
      ) : skillsError ? (
        <div className="text-sm">
          {skillsError instanceof Error ? skillsError.message : text.loadSkillsFailed}
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="text-muted-foreground text-sm">{text.noSkillsInScope}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredSkills.map((skill) => {
            const nextRef = createSkillRef(skill);
            const selected = isSkillRefSelected(form.skillRefs, nextRef);
            return (
              <button
                key={skillRefKey(nextRef)}
                type="button"
                onClick={() => handleToggleSkill(skill)}
                className={cn(
                  "rounded-3xl border p-4 text-left transition-colors",
                  selected
                    ? "border-primary/50 bg-primary/5"
                    : "border-border/70 bg-background/70 hover:bg-muted/30",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{skill.name}</p>
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      {getLocalizedSkillDescription(skill, locale)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!skill.enabled && (
                      <Badge variant="outline">{text.disabledBadge}</Badge>
                    )}
                    {selected && (
                      <Badge variant="secondary">
                        <CheckIcon className="size-3.5" />
                        {text.attachedBadge}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {agentStatus === "dev" && duplicateSkillNames.size > 0 && (
        <div className="text-muted-foreground border-border/70 bg-muted/25 rounded-2xl border px-4 py-3 text-xs leading-6">
          {text.duplicateNameHint(duplicateSkillNamesLabel)}
        </div>
      )}

      {/* Selected Skills */}
      <div className="flex flex-wrap gap-2">
        {form.skillRefs.length > 0 ? (
          form.skillRefs.map((skillRef) => (
            <button
              key={skillRefKey(skillRef)}
              type="button"
              className="bg-secondary text-secondary-foreground inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs"
              onClick={() => handleRemoveSkill(skillRef)}
            >
              {skillRef.name}
              {normalizeSkillScope(skillRef.category)
                ? ` · ${formatSkillScopeLabel(normalizeSkillScope(skillRef.category)!, locale)}`
                : ""}
              <span className="text-[10px] tracking-[0.12em] uppercase">{text.remove}</span>
            </button>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">{text.noSelectedSkills}</p>
        )}
      </div>
    </SectionCard>
  );
}

// --- Tools ---
function ToolsSection({
  mainToolOptions,
  selectedMainToolNames,
  toolCatalogLoading,
  toolCatalogError,
  text,
  onToggleTool,
}: {
  mainToolOptions: ToolCatalogItem[];
  selectedMainToolNames: string[];
  toolCatalogLoading: boolean;
  toolCatalogError: unknown;
  text: AgentSettingsPageText;
  onToggleTool: (toolName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <SectionCard
        eyebrow={<SlidersHorizontalIcon className="size-4" />}
        title={text.toolsTitle}
        description={text.toolsDescription}
        collapsible
      >
        <div className="flex flex-wrap gap-2">
          {selectedMainToolNames.length > 0 ? (
            selectedMainToolNames.slice(0, 5).map((name) => (
              <Badge key={name} variant="secondary" className="rounded-full text-xs">
                {name}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground text-sm">{text.noToolsSelected}</span>
          )}
          {selectedMainToolNames.length > 5 && (
            <Badge variant="outline" className="text-xs">
              {text.moreCount(selectedMainToolNames.length - 5)}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            {text.editLabel}
          </Button>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      eyebrow={<SlidersHorizontalIcon className="size-4" />}
      title={text.toolsTitle}
      description={text.toolsDescription}
    >
      {toolCatalogLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          {text.loadingTools}
        </div>
      ) : toolCatalogError ? (
        <p className="text-sm">
          {toolCatalogError instanceof Error ? toolCatalogError.message : text.loadToolsFailed}
        </p>
      ) : (
        <ToolSelectionList
          tools={mainToolOptions}
          selectedNames={selectedMainToolNames}
          onToggle={onToggleTool}
          emptyText={text.noConfigurableTools}
        />
      )}
      <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
        {text.collapseLabel}
      </Button>
    </SectionCard>
  );
}

function ToolSelectionList({
  tools,
  selectedNames,
  onToggle,
  emptyText,
}: {
  tools: ToolCatalogItem[];
  selectedNames: string[];
  onToggle: (name: string) => void;
  emptyText: string;
}) {
  if (tools.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyText}</p>;
  }

  const selectedSet = new Set(selectedNames);
  const groups = new Map<string, ToolCatalogItem[]>();
  for (const tool of tools) {
    const existing = groups.get(tool.group) ?? [];
    existing.push(tool);
    groups.set(tool.group, existing);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      {sortedGroups.map(([group, items]) => (
        <div key={group} className="space-y-3">
          <FieldLabel>{group}</FieldLabel>
          <div className="grid gap-3">
            {items.map((tool) => {
              const selected = selectedSet.has(tool.name);
              return (
                <button
                  key={tool.name}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => onToggle(tool.name)}
                  className={cn(
                    "flex items-start gap-3 rounded-3xl border px-4 py-3 text-left transition-colors",
                    selected
                      ? "border-primary/50 bg-primary/5"
                      : "border-border/70 bg-background/70 hover:bg-muted/30",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-background",
                    )}
                  >
                    {selected && <CheckIcon className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{tool.label}</span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-5">
                      {tool.description}
                    </span>
                    <span className="text-muted-foreground mt-2 block text-[11px]">
                      {tool.name}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Subagents ---
function SubagentsSection({
  form,
  mainToolOptions,
  subagentToolOptions,
  toolCatalogLoading,
  toolCatalogError,
  text,
  onFormChange,
}: {
  form: AgentSettingsFormState;
  mainToolOptions: ToolCatalogItem[];
  subagentToolOptions: ToolCatalogItem[];
  toolCatalogLoading: boolean;
  toolCatalogError: unknown;
  text: AgentSettingsPageText;
  onFormChange: (updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null) => void;
}) {
  function addSubagent() {
    onFormChange((current) => {
      if (!current) return current;
      return {
        ...current,
        subagents: [
          ...current.subagents,
          {
            id: nextSubagentDraftID(),
            name: "",
            description: "",
            systemPrompt: "",
            model: "",
            toolSelectionEnabled: false,
            toolNames: [],
            enabled: true,
          },
        ],
      };
    });
  }

  return (
    <SectionCard
      eyebrow={<BotIcon className="size-4" />}
      title={text.subagentsTitle}
      description={text.subagentsDescription}
      collapsible
    >
      {/* General Purpose Subagent */}
      <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
        <div>
          <p className="text-sm font-medium">{text.generalPurposeTitle}</p>
          <p className="text-muted-foreground text-xs leading-5">
            {form.generalPurposeEnabled ? text.enabledState : text.disabledState}
          </p>
        </div>
        <Switch
          checked={form.generalPurposeEnabled}
          onCheckedChange={(checked) =>
            onFormChange((current) =>
              current ? { ...current, generalPurposeEnabled: checked } : current,
            )
          }
        />
      </div>

      {form.generalPurposeEnabled && (
        <div className="bg-muted/20 border-border/70 flex items-center justify-between rounded-3xl border px-4 py-3">
          <div>
            <p className="text-sm font-medium">{text.inheritMainTools}</p>
            <p className="text-muted-foreground text-xs leading-5">
              {text.inheritMainToolsDescription}
            </p>
          </div>
          <Switch
            checked={form.generalPurposeUsesMainTools}
            onCheckedChange={(checked) =>
              onFormChange((current) => {
                if (!current) return current;
                const inheritedToolNames = resolveEffectiveToolNames(
                  { toolSelectionEnabled: current.toolSelectionEnabled, toolNames: current.toolNames, toolGroups: current.toolGroups },
                  mainToolOptions,
                  "main",
                ).filter((name) =>
                  subagentToolOptions.some((tool) => tool.name === name),
                );
                return {
                  ...current,
                  generalPurposeUsesMainTools: checked,
                  generalPurposeToolNames:
                    !checked && current.generalPurposeToolNames.length === 0
                      ? inheritedToolNames
                      : current.generalPurposeToolNames,
                };
              })
            }
          />
        </div>
      )}

      {form.generalPurposeEnabled && !form.generalPurposeUsesMainTools && (
        toolCatalogLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            {text.loadingTools}
          </div>
        ) : toolCatalogError ? (
          <p className="text-sm">{text.loadToolsFailed}</p>
        ) : (
          <ToolSelectionList
            tools={subagentToolOptions}
            selectedNames={form.generalPurposeToolNames}
            onToggle={(toolName) =>
              onFormChange((current) => {
                if (!current) return current;
                const toggle = (values: string[]) =>
                  values.includes(toolName)
                    ? values.filter((v) => v !== toolName)
                    : [...values, toolName];
                return { ...current, generalPurposeToolNames: toggle(current.generalPurposeToolNames) };
              })
            }
            emptyText={text.noConfigurableTools}
          />
        )
      )}

      {/* Custom Subagents */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-muted-foreground text-sm">{text.customSubagents}</p>
        <Button type="button" variant="outline" size="sm" onClick={addSubagent}>
          <PlusIcon className="size-3.5" />
          {text.addSubagent}
        </Button>
      </div>

      {form.subagents.length === 0 ? (
        <p className="text-muted-foreground text-sm">{text.noCustomSubagents}</p>
      ) : (
        <div className="space-y-4">
          {form.subagents.map((subagent, index) => (
            <SubagentCard
              key={subagent.id}
              subagent={subagent}
              index={index}
              subagentToolOptions={subagentToolOptions}
              mainToolOptions={mainToolOptions}
              toolCatalogLoading={toolCatalogLoading}
              toolCatalogError={toolCatalogError}
              form={form}
              text={text}
              onFormChange={onFormChange}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SubagentCard({
  subagent,
  index,
  subagentToolOptions,
  mainToolOptions,
  toolCatalogLoading,
  toolCatalogError,
  form,
  text,
  onFormChange,
}: {
  subagent: AgentSubagentFormState;
  index: number;
  subagentToolOptions: ToolCatalogItem[];
  mainToolOptions: ToolCatalogItem[];
  toolCatalogLoading: boolean;
  toolCatalogError: unknown;
  form: AgentSettingsFormState;
  text: AgentSettingsPageText;
  onFormChange: (updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  function patchSubagent(patch: Partial<AgentSubagentFormState>) {
    onFormChange((current) =>
      current
        ? {
            ...current,
            subagents: current.subagents.map((s) =>
              s.id === subagent.id ? { ...s, ...patch } : s,
            ),
          }
        : current,
    );
  }

  return (
    <div className="border-border/70 rounded-3xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BotIcon className="text-muted-foreground size-4" />
          <p className="text-sm font-medium">
            {subagent.name || `${text.subagentNameLabel} ${index + 1}`}
          </p>
          {subagent.model && (
            <Badge variant="outline" className="text-xs">{subagent.model}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={subagent.enabled}
            onCheckedChange={(checked) => patchSubagent({ enabled: checked })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() =>
              onFormChange((current) =>
                current
                  ? {
                      ...current,
                      subagents: current.subagents.filter((item) => item.id !== subagent.id),
                    }
                  : current,
              )
            }
          >
            <Trash2Icon className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? text.subagentCollapse : text.subagentExpand}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <FieldLabel>{text.subagentNameLabel}</FieldLabel>
            <Input
              value={subagent.name}
              placeholder={text.subagentNamePlaceholder}
              onChange={(event) => patchSubagent({ name: event.target.value })}
              className="h-11 rounded-2xl"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.modelOverride}</FieldLabel>
            <Input
              value={subagent.model}
              placeholder={text.optionalModelId}
              onChange={(event) => patchSubagent({ model: event.target.value })}
              className="h-11 rounded-2xl"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.descriptionLabel}</FieldLabel>
            <Textarea
              value={subagent.description}
              placeholder={text.subagentDescriptionPlaceholder}
              onChange={(event) => patchSubagent({ description: event.target.value })}
              className="min-h-24 rounded-3xl px-4 py-3 text-sm leading-6"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.subagentPromptLabel}</FieldLabel>
            <Textarea
              value={subagent.systemPrompt}
              placeholder={text.subagentPromptPlaceholder}
              onChange={(event) => patchSubagent({ systemPrompt: event.target.value })}
              className="min-h-24 rounded-3xl px-4 py-3 text-sm leading-6"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- MCP ---
function MCPSection({
  form,
  mcpProfiles,
  mcpProfilesLoading,
  mcpProfilesError,
  mcpProfileQuery,
  onMcpProfileQueryChange,
  text,
  onFormChange,
}: {
  form: AgentSettingsFormState;
  mcpProfiles: MCPProfile[];
  mcpProfilesLoading: boolean;
  mcpProfilesError: unknown;
  mcpProfileQuery: string;
  onMcpProfileQueryChange: (query: string) => void;
  text: AgentSettingsPageText;
  onFormChange: (updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null) => void;
}) {
  const filteredProfiles = useMemo(() => {
    const query = mcpProfileQuery.trim().toLowerCase();
    if (!query) return mcpProfiles;
    return mcpProfiles.filter((profile) =>
      [profile.name, profile.server_name, profile.source_path ?? "", profile.category ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [mcpProfileQuery, mcpProfiles]);

  return (
    <SectionCard
      eyebrow={<Link2Icon className="size-4" />}
      title={text.mcpTitle}
      description={text.mcpDescription}
      collapsible
    >
      <div className="space-y-2">
        <FieldLabel>{text.searchMcp}</FieldLabel>
        <Input
          value={mcpProfileQuery}
          placeholder={text.searchMcp}
          onChange={(event) => onMcpProfileQueryChange(event.target.value)}
        />
      </div>

      {mcpProfilesLoading ? (
        <p className="text-muted-foreground text-sm">{text.loadingMcp}</p>
      ) : mcpProfilesError ? (
        <p className="text-sm text-destructive">
          {mcpProfilesError instanceof Error ? mcpProfilesError.message : text.loadMcpFailed}
        </p>
      ) : filteredProfiles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{text.noMcpProfiles}</p>
      ) : (
        <div className="grid gap-3">
          {filteredProfiles.map((profile) => {
            const ref = profile.source_path ?? profile.name;
            const selected = form.mcpServers.includes(ref);
            return (
              <button
                key={ref}
                type="button"
                role="checkbox"
                aria-checked={selected}
                onClick={() =>
                  onFormChange((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      mcpServers: current.mcpServers.includes(ref)
                        ? current.mcpServers.filter((v) => v !== ref)
                        : [...current.mcpServers, ref],
                    };
                  })
                }
                className={cn(
                  "flex items-start gap-3 rounded-3xl border px-4 py-3 text-left transition-colors",
                  selected
                    ? "border-primary/50 bg-primary/5"
                    : "border-border/70 bg-background/70 hover:bg-muted/30",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/70 bg-background",
                  )}
                >
                  {selected && <CheckIcon className="size-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{profile.name}</span>
                  <span className="text-muted-foreground mt-1 block text-xs leading-5">
                    {profile.server_name}
                    {profile.category ? ` · ${profile.category}` : ""}
                  </span>
                  {profile.source_path && (
                    <code className="text-muted-foreground mt-2 block text-[11px] break-all">
                      {profile.source_path}
                    </code>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-muted-foreground text-xs leading-5">
        {text.mcpSelected(form.mcpServers.length)}
      </p>
    </SectionCard>
  );
}
