import type { Command } from "@langchain/langgraph-sdk";
import { ArrowLeftIcon, BotIcon, CheckCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArtifactsProvider } from "@/components/workspace/artifacts/context";
import { ThreadContext } from "@/components/workspace/messages/context";
import { MessageList } from "@/components/workspace/messages/message-list";
import { QuestionDock } from "@/components/workspace/messages/question-dock";
import type { Agent } from "@/core/agents";
import { checkAgentName, getAgent } from "@/core/agents/api";
import {
  buildCreateAgentFlowExtraContext,
  buildPromptExtraContext,
} from "@/core/commands/transform";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { useLocalSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";
import { cn } from "@/lib/utils";

type Step = "name" | "chat";

const NAME_RE = /^[A-Za-z0-9-]+$/;
const NEW_AGENT_NAME_DRAFT_KEY = "openagents.new-agent-name-draft";

function readAgentNameDraft(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.sessionStorage.getItem(NEW_AGENT_NAME_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeAgentNameDraft(value: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value.trim()) {
      window.sessionStorage.setItem(NEW_AGENT_NAME_DRAFT_KEY, value);
      return;
    }
    window.sessionStorage.removeItem(NEW_AGENT_NAME_DRAFT_KEY);
  } catch {
    // Ignore storage failures and keep the in-memory draft usable.
  }
}

export default function NewAgentPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [settings, setSettings] = useLocalSettings();
  const { models } = useModels();
  const resolvedContext = useMemo(
    () => ({
      ...settings.context,
      model_name: settings.context.model_name ?? models[0]?.name,
    }),
    [models, settings.context],
  );

  useEffect(() => {
    if (settings.context.model_name || !models[0]?.name) {
      return;
    }
    setSettings("context", {
      ...settings.context,
      model_name: models[0].name,
    });
  }, [models, setSettings, settings.context]);

  // ── Step 1: name form ──────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("name");
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  // ── Step 2: chat ───────────────────────────────────────────────────────────

  useEffect(() => {
    const draft = readAgentNameDraft();
    if (!draft) {
      return;
    }
    setNameInput(draft);
  }, []);

  // Stable thread ID — all turns belong to the same thread
  const threadId = useMemo(() => uuid(), []);

  const [thread, sendMessage, resumeInterrupt, , executionStatus] = useThreadStream({
    context: resolvedContext,
    skipInitialHistory: true,
    onToolEnd({ name }) {
      if (
        !["setup_agent", "save_agent_to_store"].includes(name) ||
        !agentName
      ) {
        return;
      }
      getAgent(agentName)
        .then((fetched) => setAgent(fetched))
        .catch(() => {
          // agent write may not be flushed yet — ignore silently
        });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleConfirmName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (!NAME_RE.test(trimmed)) {
      setNameError(t.agents.nameStepInvalidError);
      return;
    }
    setNameError("");
    setIsCheckingName(true);
    try {
      const result = await checkAgentName(trimmed);
      if (!result.available) {
        setNameError(t.agents.nameStepAlreadyExistsError);
        return;
      }
    } catch {
      setNameError(t.agents.nameStepCheckError);
      return;
    } finally {
      setIsCheckingName(false);
    }
    writeAgentNameDraft("");
    setAgentName(trimmed);
    setStep("chat");
    const initialText = `/create-agent 请帮我创建一个名为 ${trimmed} 的智能体，并先从需求澄清开始。`;
    const createCommand =
      buildPromptExtraContext(initialText) ??
      (() => {
        throw new Error("Missing create-agent prompt context");
      })();
    await sendMessage(
      threadId,
      {
        text: initialText,
        files: [],
      },
      {
        target_agent_name: trimmed,
        ...createCommand,
      },
    );
  }, [
    nameInput,
    sendMessage,
    threadId,
    t.agents.nameStepInvalidError,
    t.agents.nameStepAlreadyExistsError,
    t.agents.nameStepCheckError,
  ]);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleConfirmName();
    }
  };

  const handleChatSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thread.isLoading) return;
      const extraContext = buildCreateAgentFlowExtraContext(trimmed, agentName);
      await sendMessage(
        threadId,
        {
          text: trimmed,
          files: [],
        },
        extraContext,
      );
    },
    [thread.isLoading, sendMessage, threadId, agentName],
  );
  const handleAgentSendMessage = useCallback(
    async (
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      const nextContext = {
        ...(buildCreateAgentFlowExtraContext(message.text ?? "", agentName) ??
          {}),
        ...(extraContext ?? {}),
      };
      await sendMessage(threadId, message, {
        ...nextContext,
      });
    },
    [agentName, sendMessage, threadId],
  );
  const handleResumeInterrupt = useCallback(
    async (command: Command, extraContext?: Record<string, unknown>) => {
      const nextContext = {
        ...(buildCreateAgentFlowExtraContext("", agentName) ?? {}),
        ...(extraContext ?? {}),
      };
      await resumeInterrupt(threadId, command, {
        ...nextContext,
      });
    },
    [agentName, resumeInterrupt, threadId],
  );

  // ── Shared header ──────────────────────────────────────────────────────────

  const header = (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => navigate("/workspace/agents")}
      >
        <ArrowLeftIcon className="h-4 w-4" />
      </Button>
      <h1 className="text-sm font-semibold">{t.agents.createPageTitle}</h1>
    </header>
  );

  // ── Step 1: name form ──────────────────────────────────────────────────────

  if (step === "name") {
    return (
      <div className="flex size-full flex-col">
        {header}
        <main className="flex flex-1 flex-col items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-8">
            <div className="space-y-3 text-center">
              <div className="bg-primary/10 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
                <BotIcon className="text-primary h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">
                  {t.agents.nameStepTitle}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t.agents.nameStepHint}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Input
                autoFocus
                placeholder={t.agents.nameStepPlaceholder}
                value={nameInput}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setNameInput(nextValue);
                  setNameError("");
                  writeAgentNameDraft(nextValue);
                }}
                onKeyDown={handleNameKeyDown}
                className={cn(nameError && "border-destructive")}
              />
              {nameError && (
                <p className="text-destructive text-sm">{nameError}</p>
              )}
              <Button
                className="w-full"
                onClick={() => void handleConfirmName()}
                disabled={!nameInput.trim() || isCheckingName}
              >
                {t.agents.nameStepContinue}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Step 2: chat ───────────────────────────────────────────────────────────

  return (
    <ThreadContext.Provider
      value={{
        thread,
        sendMessage: handleAgentSendMessage,
        resumeInterrupt: handleResumeInterrupt,
      }}
    >
      <ArtifactsProvider>
        <div className="flex size-full flex-col">
          {header}

          <main className="flex min-h-0 flex-1 flex-col">
            {/* ── Message area ── */}
            <div className="flex min-h-0 flex-1 justify-center">
              <MessageList
                className="size-full pt-10"
                threadId={threadId}
                thread={thread}
                executionStatus={executionStatus}
              />
            </div>

            {/* ── Bottom action area ── */}
            <div className="bg-background flex shrink-0 justify-center border-t px-4 py-4">
              <div className="w-full max-w-(--container-width-md)">
                {agent ? (
                  // ✅ Success card
                  <div className="flex flex-col items-center gap-4 rounded-2xl border py-8 text-center">
                    <CheckCircleIcon className="text-primary h-10 w-10" />
                    <p className="font-semibold">{t.agents.agentCreated}</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          navigate(`/workspace/agents/${agentName}/chats/new`)
                        }
                      >
                        {t.agents.startChatting}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate("/workspace/agents")}
                      >
                        {t.agents.backToGallery}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <QuestionDock />
                    <PromptInput
                      onSubmit={({ text }) => void handleChatSubmit(text)}
                    >
                      <PromptInputTextarea
                        autoFocus
                        placeholder={t.agents.createPageSubtitle}
                        disabled={thread.isLoading}
                      />
                      <PromptInputFooter className="justify-end">
                        <PromptInputSubmit disabled={thread.isLoading} />
                      </PromptInputFooter>
                    </PromptInput>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </ArtifactsProvider>
    </ThreadContext.Provider>
  );
}
