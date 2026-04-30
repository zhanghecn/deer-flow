import type { ChatStatus } from "ai";
import {
  CheckIcon,
  PaperclipIcon,
  PlusIcon,
  RocketIcon,
  SquareIcon,
  SparklesIcon,
  UploadIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useArtifacts } from "@/components/workspace/artifacts";
import { getPromptCommands } from "@/core/commands";
import {
  buildPromptExtraContext,
  getSlashQuery,
} from "@/core/commands/transform";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import type { Model } from "@/core/models/types";
import type {
  AgentThreadContext,
  ContextWindowState,
  ExecutionStatus,
} from "@/core/threads";
import {
  getEffortForMode,
  getResolvedThreadMode,
  type ThreadMode,
  type ThreadEffort,
} from "@/core/threads/mode";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";
import type {
  DesignSelectionContext,
  SurfaceContextPayload,
} from "@/core/workspace-surface/types";
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
import { KnowledgeBaseUploadDialog } from "./knowledge/knowledge-base-upload-dialog";
import { KnowledgeSelectorDialog } from "./knowledge/knowledge-selector-dialog";
import { ThreadKnowledgeAttachmentStrip } from "./knowledge/thread-knowledge-attachment-strip";
import { ModeHoverGuide } from "./mode-hover-guide";
import {
  getNextPickerIndex,
  SkillReferencePicker,
  type QuickInsertSuggestion,
} from "./skill-reference-picker";
import { Tooltip } from "./tooltip";

type InputMode = ThreadMode;
type Effort = ThreadEffort;
type InputBoxContext = Omit<
  AgentThreadContext,
  "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
> & {
  mode: InputMode | undefined;
  effort?: Effort;
  subagent_enabled?: boolean;
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

function formatRetryTime(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRetryDelay(seconds: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: seconds < 1 ? 2 : 1,
  }).format(seconds);
}

function formatExecutionDuration(durationMs: number, locale: string) {
  return `${formatRetryDelay(durationMs / 1000, locale)}s`;
}

function ExecutionStatusBadge({
  executionStatus,
  locale,
}: {
  executionStatus: ExecutionStatus;
  locale: string;
}) {
  const { t } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (executionStatus.terminal || executionStatus.finished_at) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [executionStatus.event, executionStatus.finished_at, executionStatus.terminal]);

  const startedAt = new Date(executionStatus.started_at);
  const finishedAt = executionStatus.finished_at
    ? new Date(executionStatus.finished_at)
    : null;
  const liveDurationMs =
    executionStatus.terminal && typeof executionStatus.total_duration_ms === "number"
      ? executionStatus.total_duration_ms
      : finishedAt && !Number.isNaN(finishedAt.getTime()) && !Number.isNaN(startedAt.getTime())
        ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
        : !Number.isNaN(startedAt.getTime())
          ? Math.max(0, nowMs - startedAt.getTime())
          : executionStatus.duration_ms;
  const elapsedLabel =
    typeof liveDurationMs === "number"
      ? formatExecutionDuration(liveDurationMs, locale)
      : null;
  const timeLabel = formatRetryTime(
    executionStatus.started_at,
    locale,
  );
  const label =
    executionStatus.event === "retrying"
      ? executionStatus.tool_name
        ? t.inputBox.retryingTool(
            executionStatus.tool_name,
            executionStatus.retry_count ?? 1,
            executionStatus.max_retries ?? 1,
            timeLabel,
          )
        : t.inputBox.retryingModel(
            executionStatus.retry_count ?? 1,
            executionStatus.max_retries ?? 1,
            timeLabel,
          )
      : executionStatus.event === "retry_completed"
        ? t.inputBox.executionRetryCompleted
        : executionStatus.event === "retry_failed"
          ? t.inputBox.executionRetryFailed
          : executionStatus.event === "completed"
            ? t.inputBox.executionCompleted(elapsedLabel ?? undefined)
            : executionStatus.event === "failed"
              ? t.inputBox.executionFailed(elapsedLabel ?? undefined)
              : executionStatus.event === "interrupted"
                ? t.inputBox.executionStopped(elapsedLabel ?? undefined)
                : executionStatus.phase_kind === "tool"
                  ? t.inputBox.executionRunningTool(
                      executionStatus.tool_name,
                      elapsedLabel ?? undefined,
                    )
                  : executionStatus.phase === "thinking_finalize"
                    ? t.inputBox.executionFinalizing(elapsedLabel ?? undefined)
                    : t.inputBox.executionThinking(elapsedLabel ?? undefined);
  const delayLabel =
    typeof executionStatus.delay_seconds === "number"
      ? t.inputBox.retryDelay(
          formatRetryDelay(executionStatus.delay_seconds, locale),
        )
      : null;
  const badgeClassName = cn(
    "text-muted-foreground flex min-w-0 items-center gap-2 overflow-hidden rounded-full border px-3 py-1 text-xs",
    executionStatus.event === "failed" || executionStatus.event === "retry_failed"
      ? "border-red-500/20 bg-red-500/10"
      : executionStatus.event === "completed"
        ? "border-emerald-500/20 bg-emerald-500/10"
        : executionStatus.event === "interrupted"
          ? "border-slate-500/20 bg-slate-500/10"
          : executionStatus.phase_kind === "retry"
            ? "border-amber-500/20 bg-amber-500/10"
            : "border-sky-500/20 bg-sky-500/10",
  );

  return (
    <div className={badgeClassName}>
      <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-current" />
      <span className="truncate">{label}</span>
      {delayLabel ? (
        <span className="truncate text-[11px]">
          {delayLabel}
        </span>
      ) : null}
    </div>
  );
}

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
    effort: getEffortForMode(nextMode),
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
  threadId,
  context,
  executionStatus,
  extraHeader,
  contextWindow,
  isNewThread,
  initialValue,
  onContextChange,
  ensureThreadExists,
  onSubmit,
  onStop,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  threadId: string;
  context: InputBoxContext;
  executionStatus?: ExecutionStatus | null;
  extraHeader?: React.ReactNode;
  contextWindow?: ContextWindowState;
  isNewThread?: boolean;
  initialValue?: string;
  onContextChange?: (context: InputBoxContext) => void;
  ensureThreadExists?: () => Promise<void>;
  onSubmit?: (
    message: PromptInputMessage,
    extraContext?: Record<string, unknown>,
  ) => void;
  onStop?: () => void;
}) {
  const { t, locale } = useI18n();
  const [searchParams] = useSearchParams();
  const { selectedArtifact } = useArtifacts();
  const { designSelection, dockState, runtimeState } = useWorkspaceSurface();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { models } = useModels();
  const promptInputController = usePromptInputController();
  const setPromptInput = promptInputController.textInput.setInput;
  const draftText = promptInputController.textInput.value;
  const appliedInitialValueRef = useRef<string | undefined>(undefined);
  const [knowledgeUploadOpen, setKnowledgeUploadOpen] = useState(false);

  useEffect(() => {
    if (typeof initialValue !== "string") {
      appliedInitialValueRef.current = undefined;
      return;
    }

    if (appliedInitialValueRef.current === initialValue) {
      return;
    }

    // Route prefill is a one-shot seed. Reapplying it after every provider
    // render overwrites user edits and can participate in render loops.
    appliedInitialValueRef.current = initialValue;
    setPromptInput(initialValue);
  }, [initialValue, setPromptInput]);

  const waitsForPinnedAgentModel =
    typeof context.agent_name === "string" &&
    context.agent_name !== "" &&
    context.agent_name !== "lead_agent" &&
    typeof context.model_name !== "string";
  const selectedModel = useMemo(() => {
    if (models.length === 0 || waitsForPinnedAgentModel) {
      return undefined;
    }
    return models.find((m) => m.name === context.model_name) ?? models[0];
  }, [context.model_name, models, waitsForPinnedAgentModel]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    const normalizedContext = resolveInputContext(context, selectedModel);

    if (
      context.model_name === normalizedContext.model_name &&
      context.mode === normalizedContext.mode &&
      context.effort === normalizedContext.effort
    ) {
      return;
    }

    onContextChange?.(normalizedContext);
  }, [context, onContextChange, selectedModel]);

  const displayedMode = getResolvedThreadMode(context.mode);
  const submitButtonLabel =
    status === "streaming" ? t.inputBox.stop : t.inputBox.submit;

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
    modeOptions.find((option) => option.mode === displayedMode) ??
    modeOptions[0]!;

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

  const buildSurfaceContext = useCallback((): SurfaceContextPayload | undefined => {
    if (designSelection && designSelection.selected_node_ids.length > 0) {
      return {
        surface: "design",
        target_path: designSelection.target_path,
      };
    }

    switch (dockState.activeSurface) {
      case "runtime":
        return runtimeState.target_path
          ? {
              surface: "runtime",
              target_path: runtimeState.target_path,
            }
          : undefined;
      case "preview":
      case "files":
        return selectedArtifact
          ? {
              surface: dockState.activeSurface,
              target_path: selectedArtifact,
            }
          : undefined;
      default:
        return undefined;
    }
  }, [
    designSelection,
    dockState.activeSurface,
    runtimeState.target_path,
    selectedArtifact,
  ]);

  const buildSelectionContext = useCallback((): DesignSelectionContext | undefined => {
    if (!designSelection || designSelection.selected_node_ids.length === 0) {
      return undefined;
    }
    return designSelection;
  }, [designSelection]);

  const submitMessage = useCallback(
    (message: PromptInputMessage) => {
      if (status === "streaming") {
        onStop?.();
        return;
      }

      const normalizedText = message.text.trim();
      if (!normalizedText) {
        return;
      }

      const mergedExtraContext = {
        ...(buildPromptExtraContext(normalizedText) ?? {}),
        ...(buildSurfaceContext()
          ? { surface_context: buildSurfaceContext() }
          : {}),
        ...(buildSelectionContext()
          ? { selection_context: buildSelectionContext() }
          : {}),
      } as Record<string, unknown>;

      onSubmit?.(
        {
          ...message,
          text: normalizedText,
        },
        Object.keys(mergedExtraContext).length > 0
          ? mergedExtraContext
          : undefined,
      );
      promptInputController.textInput.clear();
    },
    [
      buildSelectionContext,
      buildSurfaceContext,
      onSubmit,
      onStop,
      promptInputController,
      status,
    ],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      submitMessage(message);
    },
    [submitMessage],
  );

  const submitPromptText = useCallback(
    (text: string) => {
      submitMessage({
        text,
        files: [],
      });
    },
    [submitMessage],
  );

  const applyInputText = useCallback(
    (nextValue: string) => {
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
    },
    [promptInputController],
  );

  const slashQuery = getSlashQuery(draftText);
  const promptCommands = useMemo(() => getPromptCommands(t), [t]);
  const slashSuggestions =
    slashQuery === null
      ? []
      : promptCommands.filter((command) => command.name.startsWith(slashQuery));

  const quickInsertSuggestions = useMemo<QuickInsertSuggestion[]>(() => {
    return slashSuggestions.map((command) => ({
      id: `command:${command.name}`,
      title: `/${command.name}`,
      description: command.description,
      value: `/${command.name} `,
      badge: t.inputBox.quickInsertCommandBadge,
    }));
  }, [slashSuggestions, t]);
  const quickInsertLabel = t.inputBox.quickInsertCommandsLabel;
  const quickInsertQueryKey =
    slashQuery !== null ? `command:${slashQuery}` : null;
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
        const selectedSuggestion =
          quickInsertSuggestions[activeQuickInsertIndex];
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
        /* Cleaner border: stronger in light, subtle in dark. No glass/blur overload. */
        "border-border bg-background rounded-xl border shadow-sm transition-all duration-200 ease-out *:data-[slot='input-group']:rounded-xl",
        "dark:border-white/10 dark:bg-[#0c1220]/80",
        "focus-within:border-ring focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/20",
        className,
      )}
      disabled={disabled}
      globalDrop
      multiple
      onSubmit={handleSubmit}
      {...props}
    >
      <KnowledgeBaseUploadDialog
        threadId={threadId}
        open={knowledgeUploadOpen}
        onOpenChange={setKnowledgeUploadOpen}
        ensureThreadExists={ensureThreadExists}
        defaultModelName={
          typeof context.model_name === "string"
            ? context.model_name
            : undefined
        }
      />
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
          className={cn(
            "size-full placeholder:text-muted-foreground/50",
            "dark:placeholder:text-white/20",
          )}
          disabled={disabled}
          placeholder={t.inputBox.placeholder}
          autoFocus={autoFocus}
          onKeyDown={handleTextareaKeyDown}
        />
      </PromptInputBody>
      {/* Footer — clear left/right separation: secondary tools | primary submit */}
      <PromptInputFooter className="flex items-center px-2 py-1.5">
        <PromptInputTools className="gap-0.5">
          {/* Secondary controls: smaller, ghost style, muted colors */}
          <AddAttachmentsButton className="h-7 w-7 p-0 text-muted-foreground/70 hover:text-foreground" />
          <Tooltip content={t.knowledge.uploadButton}>
            <PromptInputButton
              className="h-7 w-7 p-0 text-muted-foreground/70 hover:text-foreground"
              disabled={disabled}
              onClick={() => setKnowledgeUploadOpen(true)}
            >
              <UploadIcon className="size-3.5" />
            </PromptInputButton>
          </Tooltip>
          <KnowledgeSelectorDialog
            threadId={threadId}
            disabled={disabled}
            ensureThreadExists={ensureThreadExists}
          />
          {/* Mode selector — compact, minimal */}
          <PromptInputActionMenu>
            <ModeHoverGuide mode={displayedMode}>
              <PromptInputActionMenuTrigger
                className={cn(
                  "h-7 gap-1 px-2 text-[11px] font-normal",
                  displayedMode === "pro"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground/60 hover:text-foreground",
                )}
              >
                <selectedModeOption.icon className="size-3" />
                <span>{selectedModeOption.label}</span>
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
        {(contextWindow ?? executionStatus) && (
          <PromptInputTools className="min-w-0 flex-1 justify-center px-2">
            <div className="flex min-w-0 items-center justify-center gap-2">
              {executionStatus ? (
                <ExecutionStatusBadge
                  executionStatus={executionStatus}
                  locale={locale}
                />
              ) : null}
              {contextWindow ? (
                <ContextWindowCard contextWindow={contextWindow} />
              ) : null}
            </div>
          </PromptInputTools>
        )}
        <PromptInputTools className="gap-1">
          {/* Model selector — small, muted, right side */}
          <ModelSelector
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
          >
            <ModelSelectorTrigger asChild>
              <PromptInputButton className="h-7 px-2 text-[11px] text-muted-foreground/60 hover:text-foreground">
                <ModelSelectorName className="font-normal">
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
          {/* Submit button — primary visual anchor, filled style */}
          <PromptInputSubmit
            aria-label={submitButtonLabel}
            title={submitButtonLabel}
            className={cn(
              "h-8 w-8 rounded-lg",
              status === "streaming"
                ? "px-3 w-auto gap-1.5"
                : "bg-primary text-primary-foreground hover:bg-primary/90 border-0",
            )}
            disabled={disabled}
            size={status === "streaming" ? "sm" : "icon-sm"}
            variant={status === "streaming" ? "default" : "default"}
            status={status}
          >
            {status === "streaming" ? (
              <>
                <SquareIcon className="size-3.5" />
                <span className="text-xs">{submitButtonLabel}</span>
              </>
            ) : undefined}
          </PromptInputSubmit>
        </PromptInputTools>
      </PromptInputFooter>
      <ThreadKnowledgeAttachmentStrip threadId={threadId} />
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
      {/* Suggestions — tighter, calmer, below the input */}
      {isNewThread && searchParams.get("mode") !== "skill" && (
        <div className="absolute right-0 -bottom-14 left-0 z-0 flex items-center justify-center">
          <SuggestionList
            onInsertPrompt={applyInputText}
            onSubmitPrompt={submitPromptText}
          />
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
  onSubmitPrompt,
}: {
  onInsertPrompt: (prompt: string) => void;
  onSubmitPrompt?: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const handleSuggestionClick = useCallback(
    (prompt: string | undefined, options?: { submit?: boolean }) => {
      if (!prompt) return;
      if (options?.submit) {
        onSubmitPrompt?.(prompt);
        return;
      }
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
    [onInsertPrompt, onSubmitPrompt],
  );
  return (
    /* Tighter, more compact suggestion row */
    <Suggestions className="min-h-10 w-fit items-center gap-1.5">
      <button
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/25 px-3 py-1 text-xs text-muted-foreground/70 transition-colors hover:border-muted-foreground/40 hover:text-foreground"
        onClick={() =>
          handleSuggestionClick(t.inputBox.surpriseMePrompt, { submit: true })
        }
      >
        <SparklesIcon className="size-3" />
        {t.inputBox.surpriseMe}
      </button>
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
          <button className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/25 px-3 py-1 text-xs text-muted-foreground/70 transition-colors hover:border-muted-foreground/40 hover:text-foreground">
            <PlusIcon className="size-3" />
            {t.common.create}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="text-sm">
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
                    {suggestion.icon && <suggestion.icon className="size-3.5 mr-1.5" />}
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
        className={cn(className)}
        onClick={() => attachments.openFileDialog()}
      >
        <PaperclipIcon className="size-3.5" />
      </PromptInputButton>
    </Tooltip>
  );
}
