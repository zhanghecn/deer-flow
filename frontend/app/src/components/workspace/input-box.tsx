"use client";

import type { ChatStatus } from "ai";
import {
  CheckIcon,
  GraduationCapIcon,
  LightbulbIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  RocketIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";

import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { ConfettiButton } from "@/components/ui/confetti-button";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PROMPT_COMMANDS } from "@/core/commands";
import {
  buildPromptExtraContext,
  getSlashQuery,
} from "@/core/commands/transform";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import type { Model } from "@/core/models/types";
import { getSkillReferenceQuery } from "@/core/skills";
import { useSkills } from "@/core/skills/hooks";
import type { AgentThreadContext, ContextWindowState } from "@/core/threads";
import { cn } from "@/lib/utils";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../ai-elements/model-selector";
import { Suggestion, Suggestions } from "../ai-elements/suggestion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

import { ContextWindowCard } from "./context-window-card";
import { ModeHoverGuide } from "./mode-hover-guide";
import { Tooltip } from "./tooltip";

type InputMode = "flash" | "thinking" | "pro" | "ultra";
type ReasoningEffort = "minimal" | "low" | "medium" | "high";
type InputBoxContext = Omit<
  AgentThreadContext,
  "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
> & {
  mode: InputMode | undefined;
  reasoning_effort?: ReasoningEffort;
};
type ModelCapabilities = {
  modelName: string;
  supportsThinking: boolean;
  supportsReasoningEffort: boolean;
};
type ModeOption = {
  mode: InputMode;
  label: string;
  description: string;
  icon: LucideIcon;
  activeIconClassName?: string;
  activeLabelClassName?: string;
};
type ReasoningEffortOption = {
  effort: ReasoningEffort;
  label: string;
  description: string;
};

function getResolvedMode(
  mode: InputMode | undefined,
  supportsThinking: boolean,
  supportsReasoningEffort: boolean,
): InputMode {
  if (!supportsThinking && mode !== "flash") {
    return "flash";
  }

  // Models without reasoning-effort controls still benefit from thinking mode,
  // but "pro" should degrade to plain thinking instead of disabling thinking.
  if (!supportsReasoningEffort) {
    if (mode === "flash" || mode === "ultra") {
      return mode;
    }
    return "thinking";
  }

  if (mode) {
    return mode;
  }
  return "pro";
}

function getReasoningEffortForMode(
  mode: InputMode,
): ReasoningEffort {
  if (mode === "flash") {
    return "minimal";
  }
  return "high";
}

function getDisplayedMode(mode: InputMode | undefined): InputMode {
  return mode ?? "flash";
}

function getModelCapabilities(model: Model): ModelCapabilities {
  return {
    modelName: model.name,
    supportsThinking: model.supports_thinking ?? false,
    supportsReasoningEffort: model.supports_reasoning_effort ?? false,
  };
}

function resolveInputContext(
  context: InputBoxContext,
  modelCapabilities: ModelCapabilities,
  requestedMode: InputMode | undefined = context.mode,
  requestedReasoningEffort: ReasoningEffort | undefined = context.reasoning_effort,
): InputBoxContext {
  const nextMode = getResolvedMode(
    requestedMode,
    modelCapabilities.supportsThinking,
    modelCapabilities.supportsReasoningEffort,
  );

  return {
    ...context,
    model_name: modelCapabilities.modelName,
    mode: nextMode,
    reasoning_effort:
      requestedReasoningEffort ?? getReasoningEffortForMode(nextMode),
  };
}

function getReasoningEffortLabel(
  t: ReturnType<typeof useI18n>["t"],
  effort: ReasoningEffort | undefined,
) {
  switch (effort) {
    case "minimal":
      return t.inputBox.reasoningEffortMinimal;
    case "low":
      return t.inputBox.reasoningEffortLow;
    case "high":
      return t.inputBox.reasoningEffortHigh;
    case "medium":
    default:
      return t.inputBox.reasoningEffortMedium;
  }
}

function ModeOptionItem({
  option,
  selected,
  onSelect,
}: {
  option: ModeOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = option.icon;
  const iconClassName = cn(
    "mr-2 size-4",
    selected && (option.activeIconClassName ?? "text-accent-foreground"),
  );

  return (
    <PromptInputActionMenuItem
      className={cn(
        selected ? "text-accent-foreground" : "text-muted-foreground/65",
      )}
      onSelect={onSelect}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 font-bold">
          <Icon className={iconClassName} />
          <div className={cn(selected && option.activeLabelClassName)}>
            {option.label}
          </div>
        </div>
        <div className="pl-7 text-xs">{option.description}</div>
      </div>
      {selected ? (
        <CheckIcon className="ml-auto size-4" />
      ) : (
        <div className="ml-auto size-4" />
      )}
    </PromptInputActionMenuItem>
  );
}

function ReasoningEffortOptionItem({
  option,
  selected,
  onSelect,
}: {
  option: ReasoningEffortOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <PromptInputActionMenuItem
      className={cn(
        selected ? "text-accent-foreground" : "text-muted-foreground/65",
      )}
      onSelect={onSelect}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 font-bold">{option.label}</div>
        <div className="pl-2 text-xs">{option.description}</div>
      </div>
      {selected ? (
        <CheckIcon className="ml-auto size-4" />
      ) : (
        <div className="ml-auto size-4" />
      )}
    </PromptInputActionMenuItem>
  );
}

export function InputBox({
  className,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  contextWindow,
  isNewThread,
  initialValue,
  onContextChange,
  onSubmit,
  onStop,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  context: InputBoxContext;
  extraHeader?: React.ReactNode;
  contextWindow?: ContextWindowState;
  isNewThread?: boolean;
  initialValue?: string;
  onContextChange?: (context: InputBoxContext) => void;
  onSubmit?: (
    message: PromptInputMessage,
    extraContext?: Record<string, unknown>,
  ) => void;
  onStop?: () => void;
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { models } = useModels();
  const { skills } = useSkills();
  const promptInputController = usePromptInputController();
  const draftText = promptInputController.textInput.value;

  useEffect(() => {
    if (typeof initialValue !== "string") {
      return;
    }
    promptInputController.textInput.setInput(initialValue);
  }, [initialValue, promptInputController]);

  const selectedModel = useMemo(() => {
    if (models.length === 0) {
      return undefined;
    }
    return models.find((m) => m.name === context.model_name) ?? models[0];
  }, [context.model_name, models]);

  const selectedModelCapabilities = useMemo(
    () =>
      selectedModel ? getModelCapabilities(selectedModel) : undefined,
    [selectedModel],
  );

  useEffect(() => {
    if (!selectedModelCapabilities) {
      return;
    }

    const normalizedContext = resolveInputContext(
      context,
      selectedModelCapabilities,
    );

    if (
      context.model_name === normalizedContext.model_name &&
      context.mode === normalizedContext.mode &&
      context.reasoning_effort === normalizedContext.reasoning_effort
    ) {
      return;
    }

    onContextChange?.(normalizedContext);
  }, [context, onContextChange, selectedModelCapabilities]);

  const displayedMode = getDisplayedMode(context.mode);
  const supportsThinking = selectedModelCapabilities?.supportsThinking ?? false;
  const supportsReasoningEffort =
    selectedModelCapabilities?.supportsReasoningEffort ?? false;

  const modeOptions = useMemo<ModeOption[]>(
    () => [
      {
        mode: "flash",
        label: t.inputBox.flashMode,
        description: t.inputBox.flashModeDescription,
        icon: ZapIcon,
      },
      ...(supportsThinking
        ? [
            {
              mode: "thinking" as const,
              label: t.inputBox.reasoningMode,
              description: t.inputBox.reasoningModeDescription,
              icon: LightbulbIcon,
            },
          ]
        : []),
      {
        mode: "pro",
        label: t.inputBox.proMode,
        description: t.inputBox.proModeDescription,
        icon: GraduationCapIcon,
      },
      {
        mode: "ultra",
        label: t.inputBox.ultraMode,
        description: t.inputBox.ultraModeDescription,
        icon: RocketIcon,
        activeIconClassName: "text-[#dabb5e]",
        activeLabelClassName: "golden-text",
      },
    ],
    [supportsThinking, t],
  );

  const reasoningEffortOptions = useMemo<ReasoningEffortOption[]>(
    () => [
      {
        effort: "minimal",
        label: t.inputBox.reasoningEffortMinimal,
        description: t.inputBox.reasoningEffortMinimalDescription,
      },
      {
        effort: "low",
        label: t.inputBox.reasoningEffortLow,
        description: t.inputBox.reasoningEffortLowDescription,
      },
      {
        effort: "medium",
        label: t.inputBox.reasoningEffortMedium,
        description: t.inputBox.reasoningEffortMediumDescription,
      },
      {
        effort: "high",
        label: t.inputBox.reasoningEffortHigh,
        description: t.inputBox.reasoningEffortHighDescription,
      },
    ],
    [t],
  );

  const selectedModeOption =
    modeOptions.find((option) => option.mode === displayedMode) ?? modeOptions[0]!;

  const handleModelSelect = useCallback(
    (model_name: string) => {
      const model = models.find((m) => m.name === model_name);
      if (!model) {
        return;
      }
      onContextChange?.(
        resolveInputContext(
          context,
          getModelCapabilities(model),
          context.mode,
          undefined,
        ),
      );
      setModelDialogOpen(false);
    },
    [onContextChange, context, models],
  );

  const handleModeSelect = useCallback(
    (mode: InputMode) => {
      if (!selectedModelCapabilities) {
        return;
      }

      onContextChange?.(
        resolveInputContext(context, selectedModelCapabilities, mode, undefined),
      );
    },
    [onContextChange, context, selectedModelCapabilities],
  );

  const handleReasoningEffortSelect = useCallback(
    (effort: ReasoningEffort) => {
      onContextChange?.({
        ...context,
        reasoning_effort: effort,
      });
    },
    [onContextChange, context],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (status === "streaming") {
        onStop?.();
        return;
      }
      if (!message.text) {
        return;
      }
      const extraContext = buildPromptExtraContext(message.text);
      onSubmit?.(
        {
          ...message,
          text: message.text,
        },
        extraContext,
      );
      promptInputController.textInput.clear();
    },
    [onSubmit, onStop, promptInputController, status],
  );

  const applyInputText = useCallback((nextValue: string) => {
    promptInputController.textInput.setInput(nextValue);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "textarea[name='message']",
    );
    if (!textarea) {
      return;
    }
    textarea.value = nextValue;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  }, [promptInputController]);

  const slashQuery = getSlashQuery(draftText);
  const slashSuggestions =
    slashQuery === null
      ? []
      : PROMPT_COMMANDS.filter((command) => command.name.startsWith(slashQuery));
  const skillReferenceQuery = getSkillReferenceQuery(draftText);
  const skillReferenceSuggestions =
    skillReferenceQuery === null
      ? []
      : skills
          .filter((skill) => skill.enabled)
          .filter((skill) => skill.name.startsWith(skillReferenceQuery))
          .slice(0, 8);
  return (
    <PromptInput
      className={cn(
        "bg-background/85 rounded-2xl backdrop-blur-sm transition-all duration-300 ease-out *:data-[slot='input-group']:rounded-2xl",
        className,
      )}
      disabled={disabled}
      globalDrop
      multiple
      onSubmit={handleSubmit}
      {...props}
    >
      {extraHeader && (
        <div className="absolute top-0 right-0 left-0 z-10">
          <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center">
            {extraHeader}
          </div>
        </div>
      )}
      <PromptInputAttachments>
        {(attachment) => <PromptInputAttachment data={attachment} />}
      </PromptInputAttachments>
      <PromptInputBody className="absolute top-0 right-0 left-0 z-3">
        <PromptInputTextarea
          className={cn("size-full")}
          disabled={disabled}
          placeholder={t.inputBox.placeholder}
          autoFocus={autoFocus}
        />
      </PromptInputBody>
      <PromptInputFooter className="flex">
        <PromptInputTools>
          {/* TODO: Add more connectors here
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger className="px-2!" />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments
                label={t.inputBox.addAttachments}
              />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu> */}
          <AddAttachmentsButton className="px-2!" />
          <PromptInputActionMenu>
            <ModeHoverGuide mode={displayedMode}>
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div>
                  <selectedModeOption.icon
                    className={cn(
                      "size-3",
                      displayedMode === "ultra" && "text-[#dabb5e]",
                    )}
                  />
                </div>
                <div
                  className={cn(
                    "text-xs font-normal",
                    displayedMode === "ultra" ? "golden-text" : "",
                  )}
                >
                  {selectedModeOption.label}
                </div>
              </PromptInputActionMenuTrigger>
            </ModeHoverGuide>
            <PromptInputActionMenuContent className="w-80">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t.inputBox.mode}
                </DropdownMenuLabel>
                <PromptInputActionMenu>
                  {modeOptions.map((option) => (
                    <ModeOptionItem
                      key={option.mode}
                      option={option}
                      selected={displayedMode === option.mode}
                      onSelect={() => handleModeSelect(option.mode)}
                    />
                  ))}
                </PromptInputActionMenu>
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          {supportsReasoningEffort && displayedMode !== "flash" && (
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div className="text-xs font-normal">
                  {t.inputBox.reasoningEffort}:{" "}
                  {getReasoningEffortLabel(t, context.reasoning_effort)}
                </div>
              </PromptInputActionMenuTrigger>
              <PromptInputActionMenuContent className="w-70">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    {t.inputBox.reasoningEffort}
                  </DropdownMenuLabel>
                  <PromptInputActionMenu>
                    {reasoningEffortOptions.map((option) => (
                      <ReasoningEffortOptionItem
                        key={option.effort}
                        option={option}
                        selected={
                          (context.reasoning_effort ?? "medium") === option.effort
                        }
                        onSelect={() =>
                          handleReasoningEffortSelect(option.effort)
                        }
                      />
                    ))}
                  </PromptInputActionMenu>
                </DropdownMenuGroup>
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          )}
        </PromptInputTools>
        {contextWindow && (
          <PromptInputTools className="min-w-0 flex-1 justify-center px-2">
            <ContextWindowCard contextWindow={contextWindow} />
          </PromptInputTools>
        )}
        <PromptInputTools>
          <ModelSelector
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
          >
            <ModelSelectorTrigger asChild>
              <PromptInputButton>
                <ModelSelectorName className="text-xs font-normal">
                  {selectedModel?.display_name}
                </ModelSelectorName>
              </PromptInputButton>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder={t.inputBox.searchModels} />
              <ModelSelectorList>
                {models.map((m) => (
                  <ModelSelectorItem
                    key={m.name}
                    value={m.name}
                    onSelect={() => handleModelSelect(m.name)}
                  >
                    <ModelSelectorName>{m.display_name}</ModelSelectorName>
                    {m.name === context.model_name ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
          <PromptInputSubmit
            className="rounded-full"
            disabled={disabled}
            variant="outline"
            status={status}
          />
        </PromptInputTools>
      </PromptInputFooter>
      {(slashSuggestions.length > 0 || skillReferenceSuggestions.length > 0) && (
        <div className="absolute right-0 bottom-18 left-0 z-20 flex justify-center px-4">
          <div className="bg-background/95 w-full max-w-(--container-width-md) rounded-2xl border p-2 shadow-lg backdrop-blur">
            <div className="text-muted-foreground px-2 py-1 text-[11px] uppercase tracking-[0.18em]">
              {slashSuggestions.length > 0 ? "Commands" : "Skills"}
            </div>
            <div className="flex flex-col gap-1">
              {slashSuggestions.map((command) => (
                <button
                  key={command.name}
                  type="button"
                  className="hover:bg-muted flex items-start justify-between rounded-xl px-3 py-2 text-left transition-colors"
                  onClick={() => applyInputText(`/${command.name} `)}
                >
                  <span className="font-mono text-sm">/{command.name}</span>
                  <span className="text-muted-foreground ml-4 text-xs">
                    {command.description}
                  </span>
                </button>
              ))}
              {skillReferenceSuggestions.map((skill) => (
                <button
                  key={`${skill.category}:${skill.name}`}
                  type="button"
                  className="hover:bg-muted flex items-start justify-between rounded-xl px-3 py-2 text-left transition-colors"
                  onClick={() => applyInputText(`$${skill.name} `)}
                >
                  <span className="font-mono text-sm">${skill.name}</span>
                  <span className="text-muted-foreground ml-4 text-xs">
                    {skill.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {isNewThread && searchParams.get("mode") !== "skill" && (
        <div className="absolute right-0 -bottom-20 left-0 z-0 flex items-center justify-center">
          <SuggestionList onInsertPrompt={applyInputText} />
        </div>
      )}
      {!isNewThread && (
        <div className="bg-background absolute right-0 -bottom-[17px] left-0 z-0 h-4"></div>
      )}
    </PromptInput>
  );
}

function SuggestionList({
  onInsertPrompt,
}: {
  onInsertPrompt: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const handleSuggestionClick = useCallback(
    (prompt: string | undefined) => {
      if (!prompt) return;
      onInsertPrompt(prompt);
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          "textarea[name='message']",
        );
        if (textarea) {
          const selStart = prompt.indexOf("[");
          const selEnd = prompt.indexOf("]");
          if (selStart !== -1 && selEnd !== -1) {
            textarea.setSelectionRange(selStart, selEnd + 1);
          }
          textarea.focus();
        }
      }, 0);
    },
    [onInsertPrompt],
  );
  return (
    <Suggestions className="min-h-16 w-fit items-start">
      <ConfettiButton
        className="text-muted-foreground cursor-pointer rounded-full px-4 text-xs font-normal"
        variant="outline"
        size="sm"
        onClick={() => handleSuggestionClick(t.inputBox.surpriseMePrompt)}
      >
        <SparklesIcon className="size-4" /> {t.inputBox.surpriseMe}
      </ConfettiButton>
      {t.inputBox.suggestions.map((suggestion) => (
        <Suggestion
          key={suggestion.suggestion}
          icon={suggestion.icon}
          suggestion={suggestion.suggestion}
          onClick={() => handleSuggestionClick(suggestion.prompt)}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Suggestion icon={PlusIcon} suggestion={t.common.create} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            {t.inputBox.suggestionsCreate.map((suggestion, index) =>
              "type" in suggestion && suggestion.type === "separator" ? (
                <DropdownMenuSeparator key={index} />
              ) : (
                !("type" in suggestion) && (
                  <DropdownMenuItem
                    key={suggestion.suggestion}
                    onClick={() => handleSuggestionClick(suggestion.prompt)}
                  >
                    {suggestion.icon && <suggestion.icon className="size-4" />}
                    {suggestion.suggestion}
                  </DropdownMenuItem>
                )
              ),
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Suggestions>
  );
}

function AddAttachmentsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const attachments = usePromptInputAttachments();
  return (
    <Tooltip content={t.inputBox.addAttachments}>
      <PromptInputButton
        className={cn("px-2!", className)}
        onClick={() => attachments.openFileDialog()}
      >
        <PaperclipIcon className="size-3" />
      </PromptInputButton>
    </Tooltip>
  );
}
