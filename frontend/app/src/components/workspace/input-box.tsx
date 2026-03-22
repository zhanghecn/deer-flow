import type { ChatStatus } from "ai";
import {
  CheckIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  RocketIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ComponentProps,
} from "react";
import { useSearchParams } from "react-router-dom";

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
import {
  getReasoningEffortForMode,
  getResolvedThreadMode,
  type ThreadMode,
  type ThreadReasoningEffort,
} from "@/core/threads/mode";
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
import {
  getNextPickerIndex,
  SkillReferencePicker,
  type QuickInsertSuggestion,
} from "./skill-reference-picker";
import { Tooltip } from "./tooltip";

type InputMode = ThreadMode;
type ReasoningEffort = ThreadReasoningEffort;
type InputBoxContext = Omit<
  AgentThreadContext,
  "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
> & {
  mode: InputMode | undefined;
  reasoning_effort?: ReasoningEffort;
};
type ModelSelection = Pick<Model, "name">;
type ModeOption = {
  mode: InputMode;
  label: string;
  description: string;
  icon: LucideIcon;
  activeIconClassName?: string;
  activeLabelClassName?: string;
};

function resolveInputContext(
  context: InputBoxContext,
  modelSelection: ModelSelection,
  requestedMode: InputMode | undefined = context.mode,
): InputBoxContext {
  const nextMode = getResolvedThreadMode(requestedMode);

  return {
    ...context,
    model_name: modelSelection.name,
    mode: nextMode,
    reasoning_effort: getReasoningEffortForMode(nextMode),
  };
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
  const [searchParams] = useSearchParams();
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

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    const normalizedContext = resolveInputContext(context, selectedModel);

    if (
      context.model_name === normalizedContext.model_name &&
      context.mode === normalizedContext.mode &&
      context.reasoning_effort === normalizedContext.reasoning_effort
    ) {
      return;
    }

    onContextChange?.(normalizedContext);
  }, [context, onContextChange, selectedModel]);

  const displayedMode = getResolvedThreadMode(context.mode);

  const modeOptions = useMemo<ModeOption[]>(
    () => [
      {
        mode: "flash",
        label: t.inputBox.flashMode,
        description: t.inputBox.flashModeDescription,
        icon: ZapIcon,
      },
      {
        mode: "pro",
        label: t.inputBox.proMode,
        description: t.inputBox.proModeDescription,
        icon: RocketIcon,
        activeIconClassName: "text-[#dabb5e]",
        activeLabelClassName: "golden-text",
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
      onContextChange?.(resolveInputContext(context, model, context.mode));
      setModelDialogOpen(false);
    },
    [onContextChange, context, models],
  );

  const handleModeSelect = useCallback(
    (mode: InputMode) => {
      if (!selectedModel) {
        return;
      }

      onContextChange?.(resolveInputContext(context, selectedModel, mode));
    },
    [onContextChange, context, selectedModel],
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

  const quickInsertSuggestions = useMemo<QuickInsertSuggestion[]>(() => {
    if (slashSuggestions.length > 0) {
      return slashSuggestions.map((command) => ({
        id: `command:${command.name}`,
        title: `/${command.name}`,
        description: command.description,
        value: `/${command.name} `,
        badge: "Command",
      }));
    }

    return skillReferenceSuggestions.map((skill) => ({
      id: `skill:${skill.category}:${skill.name}`,
      title: `$${skill.name}`,
      description: skill.description,
      value: `$${skill.name} `,
      badge: skill.category.replace("/", " "),
    }));
  }, [skillReferenceSuggestions, slashSuggestions]);
  const quickInsertLabel = slashSuggestions.length > 0 ? "Commands" : "Skills";
  const quickInsertQueryKey = slashQuery !== null
    ? `command:${slashQuery}`
    : skillReferenceQuery !== null
      ? `skill:${skillReferenceQuery}`
      : null;
  const [dismissedQuickInsertKey, setDismissedQuickInsertKey] = useState<
    string | null
  >(null);
  const [activeQuickInsertIndex, setActiveQuickInsertIndex] = useState(0);
  const quickInsertOpen =
    quickInsertSuggestions.length > 0 &&
    quickInsertQueryKey !== null &&
    dismissedQuickInsertKey !== quickInsertQueryKey;

  useEffect(() => {
    if (!quickInsertQueryKey) {
      setDismissedQuickInsertKey(null);
      setActiveQuickInsertIndex(0);
      return;
    }

    setActiveQuickInsertIndex(0);
    if (dismissedQuickInsertKey !== quickInsertQueryKey) {
      setDismissedQuickInsertKey(null);
    }
  }, [dismissedQuickInsertKey, quickInsertQueryKey]);

  const handleQuickInsertSelect = useCallback(
    (suggestion: QuickInsertSuggestion) => {
      applyInputText(suggestion.value);
      setDismissedQuickInsertKey(null);
      setActiveQuickInsertIndex(0);
    },
    [applyInputText],
  );

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!quickInsertOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedQuickInsertKey(quickInsertQueryKey);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveQuickInsertIndex((currentIndex) =>
          getNextPickerIndex(
            currentIndex,
            "down",
            quickInsertSuggestions.length,
          ),
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveQuickInsertIndex((currentIndex) =>
          getNextPickerIndex(currentIndex, "up", quickInsertSuggestions.length),
        );
        return;
      }

      if (event.key === "PageDown") {
        event.preventDefault();
        setActiveQuickInsertIndex((currentIndex) =>
          getNextPickerIndex(
            currentIndex,
            "page_down",
            quickInsertSuggestions.length,
          ),
        );
        return;
      }

      if (event.key === "PageUp") {
        event.preventDefault();
        setActiveQuickInsertIndex((currentIndex) =>
          getNextPickerIndex(
            currentIndex,
            "page_up",
            quickInsertSuggestions.length,
          ),
        );
        return;
      }

      if (event.key === "Enter") {
        const selectedSuggestion = quickInsertSuggestions[activeQuickInsertIndex];
        if (!selectedSuggestion) {
          return;
        }

        event.preventDefault();
        handleQuickInsertSelect(selectedSuggestion);
      }
    },
    [
      activeQuickInsertIndex,
      handleQuickInsertSelect,
      quickInsertOpen,
      quickInsertQueryKey,
      quickInsertSuggestions,
    ],
  );
  return (
    <PromptInput
      className={cn(
        "rounded-2xl border border-border bg-background transition-all duration-300 ease-out *:data-[slot='input-group']:rounded-2xl dark:glass dark:border-primary/20 dark:bg-background/85 dark:backdrop-blur-sm",
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
          className={cn("size-full dark:placeholder:text-primary/30")}
          disabled={disabled}
          placeholder={t.inputBox.placeholder}
          autoFocus={autoFocus}
          onKeyDown={handleTextareaKeyDown}
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
                      displayedMode === "pro" && "text-[#dabb5e]",
                    )}
                  />
                </div>
                <div
                  className={cn(
                    "text-xs font-normal",
                    displayedMode === "pro" ? "golden-text" : "",
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
      {quickInsertOpen && (
        <div className="absolute right-0 bottom-18 left-0 z-20 flex justify-center px-4">
          <SkillReferencePicker
            label={quickInsertLabel}
            suggestions={quickInsertSuggestions}
            selectedIndex={activeQuickInsertIndex}
            onSelect={handleQuickInsertSelect}
          />
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
