import { useQuery } from "@tanstack/react-query";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createSkillRef,
  isSkillRefSelected,
  removeSkillRef,
  toggleSkillRefSelection,
  skillRefKey,
} from "@/components/workspace/agent-skill-refs";
import { resolveEffectiveToolNames } from "@/components/workspace/agent-tool-selection";
import {
  type AgentSkillRef,
  type AgentStatus,
  type ToolCatalogItem,
} from "@/core/agents";
import { discoverMCPProfiles } from "@/core/mcp/api";
import type { MCPProfile, MCPProfileDiscoveryResult } from "@/core/mcp/types";
import type { Model } from "@/core/models/types";
import { getLocalizedSkillDescription } from "@/core/skills";
import {
  DEFAULT_SKILL_SCOPE,
  filterSkillsByScope,
  formatSkillScopeLabel,
  getAllowedSkillScopesForAgent,
  getDuplicateSkillNames,
  normalizeSkillScope,
  type SkillScope,
} from "@/core/skills/scope";
import type { Skill } from "@/core/skills/type";
import { cn } from "@/lib/utils";

import type { AgentSettingsPageText } from "./i18n";
import { ModelSelect } from "./model-select";
import { FieldLabel, SectionCard } from "./shared";
import {
  filterSkillsByQuery,
  paginateItems,
  SKILLS_PAGE_SIZE,
} from "./skills-query";
import type { AgentSettingsFormState, AgentSubagentFormState } from "./types";

interface CapabilitiesTabProps {
  form: AgentSettingsFormState;
  agentStatus: AgentStatus;
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
  text: AgentSettingsPageText;
  models: Model[];
  modelsLoading: boolean;
  modelsError: unknown;
  // Skills
  availableSkills: Skill[];
  skillsLoading: boolean;
  skillsError: unknown;
  locale: "en-US" | "zh-CN";
  // Tools
  fullToolCatalog: ToolCatalogItem[];
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

type RuntimeMiddlewareGroup = {
  name: string;
  title: string;
  description: string;
  tools: ToolCatalogItem[];
  configurable: boolean;
};

function getRuntimeMiddlewareName(tool: ToolCatalogItem) {
  return tool.middleware_name?.trim() || tool.group.trim() || "runtime";
}

function formatMiddlewareTitle(name: string) {
  const words = name
    .split(/[-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return "Runtime middleware";
  }

  return `${words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")} middleware`;
}

function buildRuntimeMiddlewareGroups(
  tools: ToolCatalogItem[],
  text: AgentSettingsPageText,
): RuntimeMiddlewareGroup[] {
  const groupedTools = new Map<string, ToolCatalogItem[]>();

  for (const tool of tools) {
    const middlewareName = getRuntimeMiddlewareName(tool);
    groupedTools.set(middlewareName, [
      ...(groupedTools.get(middlewareName) ?? []),
      tool,
    ]);
  }

  return [...groupedTools.entries()]
    .map(([name, groupTools]) => ({
      name,
      title: formatMiddlewareTitle(name),
      description: text.middlewareGroupDescription(groupTools.length),
      tools: groupTools,
      configurable: groupTools.some(
        (tool) => tool.middleware_configurable === true,
      ),
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function setRuntimeMiddlewareEnabled(
  form: AgentSettingsFormState,
  middlewareName: string,
  enabled: boolean,
): AgentSettingsFormState {
  const disabled = new Set(form.runtimeMiddlewares.disabled);
  if (enabled) {
    disabled.delete(middlewareName);
  } else {
    disabled.add(middlewareName);
  }

  return {
    ...form,
    runtimeMiddlewares: {
      disabled: [...disabled].sort((left, right) => left.localeCompare(right)),
    },
  };
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
  models,
  modelsLoading,
  modelsError,
  availableSkills,
  skillsLoading,
  skillsError,
  locale,
  fullToolCatalog,
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
        form={form}
        mainToolOptions={mainToolOptions}
        selectedMainToolNames={selectedMainToolNames}
        toolCatalogLoading={toolCatalogLoading}
        toolCatalogError={toolCatalogError}
        fullToolCatalog={fullToolCatalog}
        text={text}
        onFormChange={onFormChange}
        onToggleTool={(toolName) =>
          onFormChange((current) => {
            if (!current) return current;
            const resolved = resolveEffectiveToolNames(
              {
                toolSelectionEnabled: current.toolSelectionEnabled,
                toolNames: current.toolNames,
                toolGroups: current.toolGroups,
              },
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
        models={models}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
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
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
}) {
  const duplicateSkillNames = getDuplicateSkillNames(
    availableSkills,
    allowedSkillScopes,
  );
  const duplicateSkillNamesLabel = [...duplicateSkillNames].sort().join(", ");
  const [skillsCategory, setSkillsCategory] =
    useState<SkillScope>(DEFAULT_SKILL_SCOPE);
  const [skillsQuery, setSkillsQuery] = useState("");
  const [skillsPage, setSkillsPage] = useState(1);

  useEffect(() => {
    if (
      availableSkillCategories.length > 0 &&
      !availableSkillCategories.includes(skillsCategory)
    ) {
      setSkillsCategory(availableSkillCategories[0]!);
    }
  }, [availableSkillCategories, skillsCategory]);

  const selectableSkills = availableSkills.filter((skill) => {
    const scope = normalizeSkillScope(skill.category);
    return scope != null && allowedSkillScopes.includes(scope);
  });
  const scopedSkills = filterSkillsByScope(selectableSkills, skillsCategory);
  const filteredSkills = filterSkillsByQuery(scopedSkills, skillsQuery, locale);
  const paginatedSkills = paginateItems(
    filteredSkills,
    skillsPage,
    SKILLS_PAGE_SIZE,
  );

  useEffect(() => {
    setSkillsPage(1);
  }, [skillsCategory, skillsQuery]);

  function handleToggleSkill(skill: Skill) {
    const nextRef = createSkillRef(skill);
    onFormChange((current) => {
      if (!current) return current;
      return {
        ...current,
        skillRefs: toggleSkillRefSelection(current.skillRefs, nextRef),
      };
    });
  }

  function handleRemoveSkill(skillRef: AgentSkillRef) {
    onFormChange((current) => {
      if (!current) return current;
      return {
        ...current,
        skillRefs: removeSkillRef(current.skillRefs, skillRef),
      };
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

      <div className="space-y-2">
        <FieldLabel>{text.searchSkills}</FieldLabel>
        <Input
          value={skillsQuery}
          placeholder={text.searchSkills}
          onChange={(event) => setSkillsQuery(event.target.value)}
        />
      </div>

      {skillsLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          {text.loadingSkills}
        </div>
      ) : skillsError ? (
        <div className="text-sm">
          {skillsError instanceof Error
            ? skillsError.message
            : text.loadSkillsFailed}
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {skillsQuery.trim() ? text.noSkillsMatchSearch : text.noSkillsInScope}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {paginatedSkills.pageItems.map((skill) => {
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
          {filteredSkills.length > SKILLS_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                {text.pageStatus(
                  paginatedSkills.startIndex + 1,
                  paginatedSkills.endIndex,
                  filteredSkills.length,
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={paginatedSkills.currentPage <= 1}
                  onClick={() =>
                    setSkillsPage((currentPage) => Math.max(1, currentPage - 1))
                  }
                >
                  {text.previousPage}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    paginatedSkills.currentPage >= paginatedSkills.totalPages
                  }
                  onClick={() =>
                    setSkillsPage((currentPage) =>
                      Math.min(paginatedSkills.totalPages, currentPage + 1),
                    )
                  }
                >
                  {text.nextPage}
                </Button>
              </div>
            </div>
          ) : null}
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
              <span className="text-[10px] tracking-[0.12em] uppercase">
                {text.remove}
              </span>
            </button>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            {text.noSelectedSkills}
          </p>
        )}
      </div>
    </SectionCard>
  );
}

// --- Tools ---
function ToolsSection({
  form,
  mainToolOptions,
  selectedMainToolNames,
  toolCatalogLoading,
  toolCatalogError,
  fullToolCatalog,
  text,
  onFormChange,
  onToggleTool,
}: {
  form: AgentSettingsFormState;
  mainToolOptions: ToolCatalogItem[];
  selectedMainToolNames: string[];
  toolCatalogLoading: boolean;
  toolCatalogError: unknown;
  fullToolCatalog: ToolCatalogItem[];
  text: AgentSettingsPageText;
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
  onToggleTool: (toolName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const runtimeInjectedTools = useMemo(
    () =>
      fullToolCatalog.filter(
        (tool) =>
          tool.source === "middleware" ||
          tool.reserved_policy === "middleware_injected",
      ),
    [fullToolCatalog],
  );
  const runtimeMiddlewareGroups = useMemo(
    () => buildRuntimeMiddlewareGroups(runtimeInjectedTools, text),
    [runtimeInjectedTools, text],
  );

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
              <Badge
                key={name}
                variant="secondary"
                className="rounded-full text-xs"
              >
                {name}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground text-sm">
              {text.noToolsSelected}
            </span>
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
          {toolCatalogError instanceof Error
            ? toolCatalogError.message
            : text.loadToolsFailed}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            <FieldLabel>{text.selectableToolsTitle}</FieldLabel>
            <ToolSelectionList
              tools={mainToolOptions}
              selectedNames={selectedMainToolNames}
              onToggle={onToggleTool}
              emptyText={text.noConfigurableTools}
            />
          </div>
          <div className="space-y-3">
            <FieldLabel>{text.runtimeToolsTitle}</FieldLabel>
            <p className="text-muted-foreground text-xs leading-5">
              {text.runtimeToolsDescription}
            </p>
            {runtimeInjectedTools.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {text.noRuntimeTools}
              </p>
            ) : (
              <div className="space-y-4">
                {runtimeMiddlewareGroups.map((group) =>
                  group.configurable ? (
                    <MiddlewareToolGroup
                      key={group.name}
                      title={group.title}
                      description={group.description}
                      tools={group.tools}
                      enabled={
                        !form.runtimeMiddlewares.disabled.includes(group.name)
                      }
                      text={text}
                      onEnabledChange={(checked) =>
                        onFormChange((current) =>
                          current
                            ? setRuntimeMiddlewareEnabled(
                                current,
                                group.name,
                                checked,
                              )
                            : current,
                        )
                      }
                    />
                  ) : (
                    <RuntimeToolList
                      key={group.name}
                      title={group.title}
                      description={group.description}
                      tools={group.tools}
                      text={text}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
        {text.collapseLabel}
      </Button>
    </SectionCard>
  );
}

function MiddlewareToolGroup({
  title,
  description,
  tools,
  enabled,
  text,
  onEnabledChange,
}: {
  title: string;
  description: string;
  tools: ToolCatalogItem[];
  enabled: boolean;
  text: AgentSettingsPageText;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <div className="border-border/70 bg-muted/15 rounded-3xl border px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            <Badge variant="outline">{text.runtimeInjectedBadge}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {description}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {tools.map((tool) => (
          <Badge key={tool.name} variant="secondary" className="rounded-full">
            {tool.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function RuntimeToolList({
  title,
  description,
  tools,
  text,
}: {
  title: string;
  description: string;
  tools: ToolCatalogItem[];
  text: AgentSettingsPageText;
}) {
  return (
    <div className="border-border/70 bg-muted/15 rounded-3xl border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Badge variant="outline">{text.runtimeInjectedBadge}</Badge>
      </div>
      <p className="text-muted-foreground mt-1 text-xs leading-5">
        {description}
      </p>
      <div className="mt-3 grid gap-3">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className="border-border/70 bg-background rounded-2xl border px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{tool.label}</p>
                  <Badge variant="outline">{text.runtimeInjectedBadge}</Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-xs leading-5">
                  {tool.description}
                </p>
              </div>
              <code className="text-muted-foreground shrink-0 text-[11px]">
                {tool.name}
              </code>
            </div>
            {tool.read_only_reason ? (
              <p className="text-muted-foreground mt-3 text-xs leading-5">
                {tool.read_only_reason}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
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
  const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

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
                    <span className="block text-sm font-medium">
                      {tool.label}
                    </span>
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
  models,
  modelsLoading,
  modelsError,
  text,
  onFormChange,
}: {
  form: AgentSettingsFormState;
  mainToolOptions: ToolCatalogItem[];
  subagentToolOptions: ToolCatalogItem[];
  toolCatalogLoading: boolean;
  toolCatalogError: unknown;
  models: Model[];
  modelsLoading: boolean;
  modelsError: unknown;
  text: AgentSettingsPageText;
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
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
            {form.generalPurposeEnabled
              ? text.enabledState
              : text.disabledState}
          </p>
        </div>
        <Switch
          checked={form.generalPurposeEnabled}
          onCheckedChange={(checked) =>
            onFormChange((current) =>
              current
                ? { ...current, generalPurposeEnabled: checked }
                : current,
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
                  {
                    toolSelectionEnabled: current.toolSelectionEnabled,
                    toolNames: current.toolNames,
                    toolGroups: current.toolGroups,
                  },
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

      {form.generalPurposeEnabled &&
        !form.generalPurposeUsesMainTools &&
        (toolCatalogLoading ? (
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
                return {
                  ...current,
                  generalPurposeToolNames: toggle(
                    current.generalPurposeToolNames,
                  ),
                };
              })
            }
            emptyText={text.noConfigurableTools}
          />
        ))}

      {/* Custom Subagents */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-muted-foreground text-sm">{text.customSubagents}</p>
        <Button type="button" variant="outline" size="sm" onClick={addSubagent}>
          <PlusIcon className="size-3.5" />
          {text.addSubagent}
        </Button>
      </div>

      {form.subagents.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {text.noCustomSubagents}
        </p>
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
              models={models}
              modelsLoading={modelsLoading}
              modelsError={modelsError}
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
  subagentToolOptions: _subagentToolOptions,
  mainToolOptions: _mainToolOptions,
  toolCatalogLoading: _toolCatalogLoading,
  toolCatalogError: _toolCatalogError,
  models,
  modelsLoading,
  modelsError,
  form: _form,
  text,
  onFormChange,
}: {
  subagent: AgentSubagentFormState;
  index: number;
  subagentToolOptions: ToolCatalogItem[];
  mainToolOptions: ToolCatalogItem[];
  toolCatalogLoading: boolean;
  toolCatalogError: unknown;
  models: Model[];
  modelsLoading: boolean;
  modelsError: unknown;
  form: AgentSettingsFormState;
  text: AgentSettingsPageText;
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
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
            <Badge variant="outline" className="text-xs">
              {subagent.model}
            </Badge>
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
                      subagents: current.subagents.filter(
                        (item) => item.id !== subagent.id,
                      ),
                    }
                  : current,
              )
            }
          >
            <Trash2Icon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
          >
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
            <ModelSelect
              value={subagent.model}
              models={models}
              isLoading={modelsLoading}
              placeholder={text.selectModel}
              emptyLabel={text.useMainAgentModel}
              unavailableLabel={text.unavailableModel}
              onChange={(nextValue) => patchSubagent({ model: nextValue })}
            />
            {modelsError ? (
              <p className="text-destructive text-xs leading-5">
                {modelsError instanceof Error
                  ? modelsError.message
                  : text.loadModelsFailed}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.descriptionLabel}</FieldLabel>
            <Textarea
              value={subagent.description}
              placeholder={text.subagentDescriptionPlaceholder}
              onChange={(event) =>
                patchSubagent({ description: event.target.value })
              }
              className="min-h-24 rounded-3xl px-4 py-3 text-sm leading-6"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>{text.subagentPromptLabel}</FieldLabel>
            <Textarea
              value={subagent.systemPrompt}
              placeholder={text.subagentPromptPlaceholder}
              onChange={(event) =>
                patchSubagent({ systemPrompt: event.target.value })
              }
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
  onFormChange: (
    updater: (prev: AgentSettingsFormState) => AgentSettingsFormState | null,
  ) => void;
}) {
  const selectedProfileRefs = form.mcpServers;
  const [inspectedProfileRef, setInspectedProfileRef] = useState<string | null>(
    null,
  );
  const filteredProfiles = useMemo(() => {
    const query = mcpProfileQuery.trim().toLowerCase();
    if (!query) return mcpProfiles;
    return mcpProfiles.filter((profile) =>
      [profile.name, profile.server_name, profile.source_path ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [mcpProfileQuery, mcpProfiles]);

  const selectedProfiles = useMemo(() => {
    const profileByRef = new Map(
      mcpProfiles
        .map((profile) => [mcpProfileRef(profile), profile] as const)
        .filter(
          (entry): entry is readonly [string, MCPProfile] => entry[0] != null,
        ),
    );

    // Preserve the persisted selection order so the discovery panel mirrors the
    // exact MCP stack the operator attached to the agent.
    return selectedProfileRefs.map((ref) => {
      const profile = profileByRef.get(ref);
      if (!profile) {
        return {
          ref,
          profile_name: ref,
          source_path: ref,
          server_name: null,
          config_json: {},
          missing: true,
        };
      }
      return {
        ref,
        profile_name: profile.name,
        source_path: profile.source_path ?? ref,
        server_name: profile.server_name,
        config_json: profile.config_json,
        missing: false,
      };
    });
  }, [mcpProfiles, selectedProfileRefs]);

  const discoverableProfiles = useMemo(
    () => selectedProfiles.filter((profile) => !profile.missing),
    [selectedProfiles],
  );

  const {
    data: discoveredProfiles,
    isLoading: discoveryLoading,
    isFetching: discoveryFetching,
    error: discoveryError,
    refetch: refetchDiscovery,
  } = useQuery({
    queryKey: [
      "mcpProfileDiscovery",
      discoverableProfiles.map((profile) => ({
        ref: profile.ref,
        profile_name: profile.profile_name,
        config_json: profile.config_json,
      })),
    ],
    enabled: discoverableProfiles.length > 0,
    refetchOnWindowFocus: false,
    queryFn: () =>
      discoverMCPProfiles(
        discoverableProfiles.map((profile) => ({
          ref: profile.ref,
          profile_name: profile.profile_name,
          config_json: profile.config_json,
        })),
      ),
  });

  const discoveredProfileMap = useMemo(
    () =>
      new Map(
        (discoveredProfiles ?? []).map((profile) => [profile.ref, profile]),
      ),
    [discoveredProfiles],
  );
  const inspectedProfile = useMemo(
    () =>
      selectedProfiles.find((profile) => profile.ref === inspectedProfileRef) ??
      null,
    [inspectedProfileRef, selectedProfiles],
  );
  const inspectedDiscovery = inspectedProfile
    ? discoveredProfileMap.get(inspectedProfile.ref)
    : undefined;

  function removeMCPProfileRef(ref: string) {
    onFormChange((current) => {
      if (!current) return current;
      return {
        ...current,
        mcpServers: current.mcpServers.filter((value) => value !== ref),
      };
    });
  }

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
        <p className="text-destructive text-sm">
          {mcpProfilesError instanceof Error
            ? mcpProfilesError.message
            : text.loadMcpFailed}
        </p>
      ) : filteredProfiles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{text.noMcpProfiles}</p>
      ) : (
        <div className="grid gap-3">
          {filteredProfiles.map((profile) => {
            const ref = mcpProfileRef(profile);
            if (!ref) {
              return null;
            }
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
                  <span className="block text-sm font-medium">
                    {profile.name}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs leading-5">
                    {profile.server_name}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-muted-foreground text-xs leading-5">
        {text.mcpSelected(form.mcpServers.length)}
      </p>

      <div className="border-border/70 bg-muted/15 space-y-2 rounded-3xl border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{text.selectedMcpTitle}</p>
            <p className="text-muted-foreground text-xs leading-5">
              {text.selectedMcpDescription}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 rounded-full"
            disabled={discoverableProfiles.length === 0 || discoveryFetching}
            onClick={() => {
              void refetchDiscovery();
            }}
          >
            {discoveryFetching ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                {text.scanningMcp}
              </>
            ) : discoveredProfiles ? (
              text.refreshMcpScan
            ) : (
              text.scanSelectedMcp
            )}
          </Button>
        </div>

        {selectedProfiles.length === 0 ? (
          <p className="text-muted-foreground text-sm">{text.noSelectedMcp}</p>
        ) : discoveryLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            {text.scanningMcp}
          </div>
        ) : discoveryError ? (
          <p className="text-destructive text-sm">
            {discoveryError instanceof Error
              ? discoveryError.message
              : text.loadMcpFailed}
          </p>
        ) : (
          <div className="space-y-2">
            {selectedProfiles.map((profile) => {
              const discovery = discoveredProfileMap.get(profile.ref);
              return (
                <SelectedMCPProfileCard
                  key={profile.ref}
                  profile={profile}
                  discovery={discovery}
                  text={text}
                  onInspect={() => setInspectedProfileRef(profile.ref)}
                  onRemove={() => removeMCPProfileRef(profile.ref)}
                />
              );
            })}
          </div>
        )}
      </div>

      <MCPToolsSheet
        open={inspectedProfile != null}
        onOpenChange={(open) => {
          if (!open) {
            setInspectedProfileRef(null);
          }
        }}
        profile={inspectedProfile}
        discovery={inspectedDiscovery}
        text={text}
      />
    </SectionCard>
  );
}

type SelectedMCPProfile = {
  ref: string;
  profile_name: string;
  source_path: string;
  server_name: string | null;
  missing: boolean;
};

function mcpProfileRef(profile: MCPProfile) {
  const sourcePath = profile.source_path?.trim();
  return sourcePath || null;
}

function isProfileReachable(
  profile: Pick<SelectedMCPProfile, "missing">,
  discovery?: MCPProfileDiscoveryResult,
): boolean {
  return !profile.missing && (discovery?.reachable ?? false);
}

function SelectedMCPProfileCard({
  profile,
  discovery,
  text,
  onInspect,
  onRemove,
}: {
  profile: SelectedMCPProfile;
  discovery?: MCPProfileDiscoveryResult;
  text: AgentSettingsPageText;
  onInspect: () => void;
  onRemove: () => void;
}) {
  const reachable = isProfileReachable(profile, discovery);

  return (
    <div className="border-border/70 bg-background/80 flex items-center gap-3 rounded-xl border px-3 py-2">
      <span
        className={cn(
          "mt-px size-2 shrink-0 rounded-full",
          reachable ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 font-medium">
          {profile.profile_name || text.mcpUnknownProfile}
        </p>
        <p className="text-muted-foreground truncate text-[11px] leading-4">
          {profile.server_name ?? discovery?.server_name ?? profile.ref}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {typeof discovery?.latency_ms === "number" ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {text.mcpLatency(discovery.latency_ms)}
          </span>
        ) : null}
        <Badge variant="outline" className="px-1.5 text-[10px]">
          {text.mcpToolCount(discovery?.tool_count ?? 0)}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={profile.missing}
          onClick={onInspect}
        >
          {text.mcpViewTools}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onRemove}
        >
          <Trash2Icon className="size-3.5" />
          {text.mcpRemoveProfile}
        </Button>
      </div>
    </div>
  );
}

function MCPToolsSheet({
  open,
  onOpenChange,
  profile,
  discovery,
  text,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: SelectedMCPProfile | null;
  discovery?: MCPProfileDiscoveryResult;
  text: AgentSettingsPageText;
}) {
  const reachable = profile ? isProfileReachable(profile, discovery) : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-hidden sm:max-w-2xl">
        <SheetHeader className="border-border/70 shrink-0 border-b px-6 py-5">
          <SheetTitle className="text-base">
            {profile?.profile_name ?? text.mcpUnknownProfile}
          </SheetTitle>
          <SheetDescription>{text.mcpDialogDescription}</SheetDescription>
        </SheetHeader>

        {profile && (
          <div className="border-border/70 flex shrink-0 items-center gap-2 border-b px-6 py-2.5">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                reachable ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {profile.server_name ?? discovery?.server_name ?? profile.ref}
            </p>
            {typeof discovery?.latency_ms === "number" ? (
              <Badge variant="outline" className="px-1.5 text-[10px]">
                {text.mcpLatency(discovery.latency_ms)}
              </Badge>
            ) : null}
            <Badge variant="outline" className="px-1.5 text-[10px]">
              {text.mcpToolCount(discovery?.tool_count ?? 0)}
            </Badge>
          </div>
        )}

        <div className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-4 px-6 py-5">
              {profile?.missing ? (
                <p className="text-destructive text-sm">
                  {text.mcpProfileMissing}
                </p>
              ) : discovery?.error ? (
                <p className="text-destructive text-sm">{discovery.error}</p>
              ) : discovery && discovery.tools.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
                    {text.mcpAvailableTools}
                  </p>
                  {discovery.tools.map((tool) => (
                    <div
                      key={`${profile?.ref ?? "unknown"}:${tool.name}`}
                      className="border-border/70 bg-background/90 space-y-2 rounded-xl border p-4"
                    >
                      <Badge
                        variant="secondary"
                        className="rounded-full px-2.5 text-xs"
                      >
                        {tool.name}
                      </Badge>
                      <p className="text-muted-foreground text-sm leading-6">
                        {tool.description || text.mcpNoDescription}
                      </p>
                      <div className="space-y-1.5">
                        <p className="text-muted-foreground text-[10px] font-medium tracking-[0.14em] uppercase">
                          {text.mcpInputSchema}
                        </p>
                        <pre className="overflow-x-auto rounded-lg bg-slate-950/95 p-3 text-[11px] leading-5 text-slate-100">
                          {JSON.stringify(tool.input_schema ?? {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              ) : discovery ? (
                <p className="text-muted-foreground text-sm">
                  {text.mcpNoDiscoveredTools}
                </p>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
