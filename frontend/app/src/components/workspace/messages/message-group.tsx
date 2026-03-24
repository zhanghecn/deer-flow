import type { Message } from "@langchain/langgraph-sdk";
import {
  BookOpenTextIcon,
  ChevronUp,
  FolderOpenIcon,
  GlobeIcon,
  LightbulbIcon,
  ListTodoIcon,
  MessageCircleQuestionMarkIcon,
  NotebookPenIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractReasoningContentFromMessage,
  extractTextFromMessage,
} from "@/core/messages/utils";
import { workspaceMessageRehypePlugins } from "@/core/streamdown";
import { extractClarificationRequestFromArgs } from "@/core/threads/interrupts";
import { getUserVisibleRuntimePath } from "@/core/utils/files";
import { extractTitleFromMarkdown } from "@/core/utils/markdown";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { useArtifacts } from "../artifacts";
import { FlipDisplay } from "../flip-display";
import { Tooltip } from "../tooltip";

import { MarkdownContent } from "./markdown-content";

function getStringArg(args: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function getNumberArg(args: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function getPathArg(args: Record<string, unknown>) {
  return getStringArg(args, "path", "file_path");
}

export function MessageGroup({
  className,
  messages,
  isLoading = false,
  showTrailingReasoning = true,
}: {
  className?: string;
  messages: Message[];
  isLoading?: boolean;
  showTrailingReasoning?: boolean;
}) {
  const { t } = useI18n();
  const [showAbove, setShowAbove] = useState(
    env.VITE_STATIC_WEBSITE_ONLY === "true",
  );
  const [showLastThinking, setShowLastThinking] = useState(
    env.VITE_STATIC_WEBSITE_ONLY === "true",
  );
  const steps = useMemo(() => convertToSteps(messages), [messages]);
  const lastToolCallStep = useMemo(() => {
    const filteredSteps = steps.filter((step) => step.type === "toolCall");
    return filteredSteps[filteredSteps.length - 1];
  }, [steps]);
  const aboveLastToolCallSteps = useMemo(() => {
    if (lastToolCallStep) {
      const index = steps.indexOf(lastToolCallStep);
      return steps.slice(0, index);
    }
    return [];
  }, [lastToolCallStep, steps]);
  const lastReasoningStep = useMemo(() => {
    if (lastToolCallStep) {
      const index = steps.indexOf(lastToolCallStep);
      return steps.slice(index + 1).find((step) => step.type === "reasoning");
    } else {
      const filteredSteps = steps.filter((step) => step.type === "reasoning");
      return filteredSteps[filteredSteps.length - 1];
    }
  }, [lastToolCallStep, steps]);

  const visibleLastReasoningStep = showTrailingReasoning
    ? lastReasoningStep
    : undefined;

  if (
    aboveLastToolCallSteps.length === 0 &&
    !lastToolCallStep &&
    !visibleLastReasoningStep
  ) {
    return null;
  }

  return (
    <ChainOfThought
      className={cn("w-full gap-2 rounded-lg border p-0.5", className)}
      open={true}
    >
      {aboveLastToolCallSteps.length > 0 && (
        <Button
          key="above"
          className="w-full items-start justify-start text-left"
          variant="ghost"
          onClick={() => setShowAbove(!showAbove)}
        >
          <ChainOfThoughtStep
            label={
              <span className="opacity-60">
                {showAbove
                  ? t.toolCalls.lessSteps
                  : t.toolCalls.moreSteps(aboveLastToolCallSteps.length)}
              </span>
            }
            icon={
              <ChevronUp
                className={cn(
                  "size-4 opacity-60 transition-transform duration-200",
                  showAbove ? "rotate-180" : "",
                )}
              />
            }
          ></ChainOfThoughtStep>
        </Button>
      )}
      {lastToolCallStep && (
        <ChainOfThoughtContent className="px-4 pb-2">
          {showAbove &&
            aboveLastToolCallSteps.map((step) =>
              step.type === "reasoning" ? (
                <ChainOfThoughtStep
                  key={step.id}
                  label={
                    <MarkdownContent
                      content={step.reasoning ?? ""}
                      isLoading={isLoading}
                      rehypePlugins={workspaceMessageRehypePlugins}
                    />
                  }
                ></ChainOfThoughtStep>
              ) : (
                <ToolCall key={step.id} {...step} isLoading={isLoading} />
              ),
            )}
          {lastToolCallStep && (
            <FlipDisplay uniqueKey={lastToolCallStep.id ?? ""}>
              <ToolCall
                key={lastToolCallStep.id}
                {...lastToolCallStep}
                isLast={true}
                isLoading={isLoading}
              />
            </FlipDisplay>
          )}
        </ChainOfThoughtContent>
      )}
      {visibleLastReasoningStep && (
        <>
          <Button
            key={visibleLastReasoningStep.id}
            className="w-full items-start justify-start text-left"
            variant="ghost"
            onClick={() => setShowLastThinking(!showLastThinking)}
          >
            <div className="flex w-full items-center justify-between">
              <ChainOfThoughtStep
                className="font-normal"
                label={t.common.thinking}
                icon={LightbulbIcon}
              ></ChainOfThoughtStep>
              <div>
                <ChevronUp
                  className={cn(
                    "text-muted-foreground size-4",
                    showLastThinking ? "" : "rotate-180",
                  )}
                />
              </div>
            </div>
          </Button>
          {showLastThinking && (
            <ChainOfThoughtContent className="px-4 pb-2">
              <ChainOfThoughtStep
                key={visibleLastReasoningStep.id}
                label={
                  <MarkdownContent
                    content={visibleLastReasoningStep.reasoning ?? ""}
                    isLoading={isLoading}
                    rehypePlugins={workspaceMessageRehypePlugins}
                  />
                }
                ></ChainOfThoughtStep>
            </ChainOfThoughtContent>
          )}
        </>
      )}
    </ChainOfThought>
  );
}

function ToolCall({
  id,
  messageId,
  name,
  args,
  result,
  isLast = false,
  isLoading = false,
}: {
  id?: string;
  messageId?: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  isLast?: boolean;
  isLoading?: boolean;
}) {
  const { t } = useI18n();
  const { setOpen, autoOpen, autoSelect, selectedArtifact, select } =
    useArtifacts();

  if (name === "web_search") {
    let label: React.ReactNode = t.toolCalls.searchForRelatedInfo;
    if (typeof args.query === "string") {
      label = t.toolCalls.searchOnWebFor(args.query);
    }
    return (
      <ChainOfThoughtStep key={id} label={label} icon={SearchIcon}>
        {Array.isArray(result) && (
          <ChainOfThoughtSearchResults>
            {result.map((item) => (
              <ChainOfThoughtSearchResult key={item.url}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              </ChainOfThoughtSearchResult>
            ))}
          </ChainOfThoughtSearchResults>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "image_search") {
    let label: React.ReactNode = t.toolCalls.searchForRelatedImages;
    if (typeof args.query === "string") {
      label = t.toolCalls.searchForRelatedImagesFor(args.query);
    }
    const results = (
      result as {
        results: {
          source_url: string;
          thumbnail_url: string;
          image_url: string;
          title: string;
        }[];
      }
    )?.results;
    return (
      <ChainOfThoughtStep key={id} label={label} icon={SearchIcon}>
        {Array.isArray(results) && (
          <ChainOfThoughtSearchResults>
            {Array.isArray(results) &&
              results.map((item) => (
                <Tooltip key={item.image_url} content={item.title}>
                  <a
                    className="size-24 overflow-hidden rounded-lg object-cover"
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="bg-accent size-24">
                      <img
                        className="size-full object-cover"
                        src={item.thumbnail_url}
                        alt={item.title}
                        width={100}
                        height={100}
                      />
                    </div>
                  </a>
                </Tooltip>
              ))}
          </ChainOfThoughtSearchResults>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "web_fetch") {
    const url = (args as { url: string })?.url;
    let title = url;
    if (typeof result === "string") {
      const potentialTitle = extractTitleFromMarkdown(result);
      if (potentialTitle && potentialTitle.toLowerCase() !== "untitled") {
        title = potentialTitle;
      }
    }
    return (
      <ChainOfThoughtStep
        key={id}
        className="cursor-pointer"
        label={t.toolCalls.viewWebPage}
        icon={GlobeIcon}
        onClick={() => {
          window.open(url, "_blank");
        }}
      >
        <ChainOfThoughtSearchResult>
          {url && (
            <a href={url} target="_blank" rel="noreferrer">
              {title}
            </a>
          )}
        </ChainOfThoughtSearchResult>
      </ChainOfThoughtStep>
    );
  } else if (name === "ls") {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = t.toolCalls.listFolder;
    }
    const path = getStringArg(args, "path", "dir_path", "directory");
    return (
      <ChainOfThoughtStep key={id} label={description} icon={FolderOpenIcon}>
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {getUserVisibleRuntimePath(path)}
          </ChainOfThoughtSearchResult>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "read_file") {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = t.toolCalls.readFile;
    }
    const path = getPathArg(args);
    const offset = getNumberArg(args, "offset");
    const limit = getNumberArg(args, "limit");
    return (
      <ChainOfThoughtStep key={id} label={description} icon={BookOpenTextIcon}>
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {getUserVisibleRuntimePath(path)}
          </ChainOfThoughtSearchResult>
        )}
        {(offset !== undefined || limit !== undefined) && (
          <ChainOfThoughtSearchResult className="text-muted-foreground">
            offset={offset ?? 0}, limit={limit ?? 2000}
          </ChainOfThoughtSearchResult>
        )}
      </ChainOfThoughtStep>
    );
  } else if (
    name === "write_file" ||
    name === "str_replace" ||
    name === "edit_file"
  ) {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = name === "edit_file" ? t.toolCalls.useTool(name) : t.toolCalls.writeFile;
    }
    const path = getPathArg(args);
    const content = getStringArg(args, "content");
    const canOpenContent =
      (name === "write_file" || name === "str_replace") &&
      Boolean(path && typeof content === "string");

    if (isLoading && isLast && autoOpen && autoSelect && canOpenContent) {
      setTimeout(() => {
        const url = new URL(
          `write-file:${path}?message_id=${messageId}&tool_call_id=${id}`,
        ).toString();
        if (selectedArtifact === url) {
          return;
        }
        select(url, true);
        setOpen(true);
      }, 100);
    }

    return (
      <ChainOfThoughtStep
        key={id}
        className={canOpenContent ? "cursor-pointer" : undefined}
        label={description}
        icon={NotebookPenIcon}
        onClick={
          canOpenContent
            ? () => {
                select(
                  new URL(
                    `write-file:${path}?message_id=${messageId}&tool_call_id=${id}`,
                  ).toString(),
                );
                setOpen(true);
              }
            : undefined
        }
      >
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {getUserVisibleRuntimePath(path)}
          </ChainOfThoughtSearchResult>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "bash" || name === "execute") {
    const description: string | undefined = (args as { description: string })
      ?.description;
    const command = getStringArg(args, "command", "cmd");
    return (
      <ChainOfThoughtStep
        key={id}
        label={description ?? t.toolCalls.executeCommand}
        icon={SquareTerminalIcon}
      >
        {command && (
          <CodeBlock
            className="mx-0 cursor-pointer border-none px-0"
            showLineNumbers={false}
            language="bash"
            code={command}
          />
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "grep") {
    const description: string | undefined = (args as { description: string })
      ?.description;
    const pattern = getStringArg(args, "pattern");
    const path = getStringArg(args, "path");
    const glob = getStringArg(args, "glob");
    const outputMode = getStringArg(args, "output_mode");
    return (
      <ChainOfThoughtStep
        key={id}
        label={description ?? t.toolCalls.useTool(name)}
        icon={SearchIcon}
      >
        {pattern && (
          <CodeBlock
            className="mx-0 cursor-pointer border-none px-0"
            showLineNumbers={false}
            language="bash"
            code={pattern}
          />
        )}
        {path && (
          <ChainOfThoughtSearchResult className="text-muted-foreground">
            path: {getUserVisibleRuntimePath(path)}
          </ChainOfThoughtSearchResult>
        )}
        {glob && (
          <ChainOfThoughtSearchResult className="text-muted-foreground">
            glob: {glob}
          </ChainOfThoughtSearchResult>
        )}
        {outputMode && (
          <ChainOfThoughtSearchResult className="text-muted-foreground">
            output_mode: {outputMode}
          </ChainOfThoughtSearchResult>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "glob") {
    const description: string | undefined = (args as { description: string })
      ?.description;
    const pattern = getStringArg(args, "pattern");
    const path = getStringArg(args, "path");
    return (
      <ChainOfThoughtStep
        key={id}
        label={description ?? t.toolCalls.useTool(name)}
        icon={SearchIcon}
      >
        {pattern && (
          <CodeBlock
            className="mx-0 cursor-pointer border-none px-0"
            showLineNumbers={false}
            language="bash"
            code={pattern}
          />
        )}
        {path && (
          <ChainOfThoughtSearchResult className="text-muted-foreground">
            path: {getUserVisibleRuntimePath(path)}
          </ChainOfThoughtSearchResult>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "ask_clarification") {
    const clarification = extractClarificationRequestFromArgs(args);
    return (
      <ChainOfThoughtStep
        key={id}
        label={clarification?.question ?? t.toolCalls.needYourHelp}
        icon={MessageCircleQuestionMarkIcon}
      >
        {clarification?.context && (
          <ChainOfThoughtSearchResult className="text-muted-foreground">
            {clarification.context}
          </ChainOfThoughtSearchResult>
        )}
        {clarification?.options.map((option, index) => (
          <ChainOfThoughtSearchResult key={`${option}-${index}`}>
            {option}
          </ChainOfThoughtSearchResult>
        ))}
      </ChainOfThoughtStep>
    );
  } else if (name === "write_todos") {
    return (
      <ChainOfThoughtStep
        key={id}
        label={t.toolCalls.writeTodos}
        icon={ListTodoIcon}
      ></ChainOfThoughtStep>
    );
  } else {
    const description: string | undefined = (args as { description: string })
      ?.description;
    return (
      <ChainOfThoughtStep
        key={id}
        label={description ?? t.toolCalls.useTool(name)}
        icon={WrenchIcon}
      ></ChainOfThoughtStep>
    );
  }
}

interface GenericCoTStep<T extends string = string> {
  id?: string;
  messageId?: string;
  type: T;
}

interface CoTReasoningStep extends GenericCoTStep<"reasoning"> {
  reasoning: string | null;
}

interface CoTToolCallStep extends GenericCoTStep<"toolCall"> {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

type CoTStep = CoTReasoningStep | CoTToolCallStep;

export function shouldShowTrailingReasoning(
  nextGroupType: string | undefined,
  isLoading: boolean,
) {
  if (isLoading) {
    return true;
  }

  if (!nextGroupType) {
    return true;
  }

  return !nextGroupType.startsWith("assistant") ||
    nextGroupType === "assistant:processing";
}

function convertToSteps(messages: Message[]): CoTStep[] {
  const steps: CoTStep[] = [];
  const toolResults = new Map<string, string>();

  for (const message of messages) {
    if (message.type !== "tool" || !message.tool_call_id) {
      continue;
    }
    const content = extractTextFromMessage(message);
    if (content) {
      toolResults.set(message.tool_call_id, content);
    }
  }

  for (const message of messages) {
    if (message.type === "ai") {
      const reasoning = extractReasoningContentFromMessage(message);
      if (reasoning) {
        const step: CoTReasoningStep = {
          id: message.id,
          messageId: message.id,
          type: "reasoning",
          reasoning,
        };
        steps.push(step);
      }
      for (const tool_call of message.tool_calls ?? []) {
        if (tool_call.name === "task") {
          continue;
        }
        const step: CoTToolCallStep = {
          id: tool_call.id,
          messageId: message.id,
          type: "toolCall",
          name: tool_call.name,
          args: tool_call.args,
        };
        const toolCallId = tool_call.id;
        if (toolCallId) {
          const toolCallResult = toolResults.get(toolCallId);
          if (toolCallResult) {
            try {
              const json = JSON.parse(toolCallResult);
              step.result = json;
            } catch {
              step.result = toolCallResult;
            }
          }
        }
        steps.push(step);
      }
    }
  }
  return steps;
}
