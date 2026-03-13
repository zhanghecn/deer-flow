import type { AIMessage, Message } from "@langchain/langgraph-sdk";

interface GenericMessageGroup<T = string> {
  type: T;
  id: string | undefined;
  messages: Message[];
}

interface HumanMessageGroup extends GenericMessageGroup<"human"> {}

interface AssistantProcessingGroup extends GenericMessageGroup<"assistant:processing"> {}

interface AssistantMessageGroup extends GenericMessageGroup<"assistant"> {}

interface AssistantPresentFilesGroup extends GenericMessageGroup<"assistant:present-files"> {}

interface AssistantClarificationGroup extends GenericMessageGroup<"assistant:clarification"> {}

interface AssistantSubagentGroup extends GenericMessageGroup<"assistant:subagent"> {}

export type MessageGroup =
  | HumanMessageGroup
  | AssistantProcessingGroup
  | AssistantMessageGroup
  | AssistantPresentFilesGroup
  | AssistantClarificationGroup
  | AssistantSubagentGroup;

type MessageContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  reasoning?: string;
  reasoning_content?: string;
};

function isToolCompatibleGroup(group: MessageGroup) {
  return (
    group.type === "assistant:processing" ||
    group.type === "assistant:present-files" ||
    group.type === "assistant:subagent"
  );
}

function groupContainsToolCall(group: MessageGroup, toolCallId: string) {
  return group.messages.some(
    (message) =>
      message.type === "ai" &&
      message.tool_calls?.some((toolCall) => toolCall.id === toolCallId),
  );
}

function findGroupForToolMessage(groups: MessageGroup[], message: Message) {
  if (message.type !== "tool") {
    return undefined;
  }

  const toolCallId = message.tool_call_id;
  if (toolCallId) {
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      if (!group || !isToolCompatibleGroup(group)) {
        continue;
      }
      if (groupContainsToolCall(group, toolCallId)) {
        return group;
      }
    }
  }

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group && isToolCompatibleGroup(group)) {
      return group;
    }
  }

  return undefined;
}

export function groupMessages<T>(
  messages: Message[],
  mapper: (group: MessageGroup) => T,
): T[] {
  if (messages.length === 0) {
    return [];
  }
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    const lastGroup = groups[groups.length - 1];
    if (message.type === "human") {
      groups.push({
        id: message.id,
        type: "human",
        messages: [message],
      });
    } else if (message.type === "tool") {
      const matchedGroup = findGroupForToolMessage(groups, message);

      // Check if this is a clarification tool message
      if (isClarificationToolMessage(message)) {
        // Add to processing group if available (to maintain tool call association)
        if (matchedGroup) {
          matchedGroup.messages.push(message);
        }
        // Also create a separate clarification group for prominent display
        groups.push({
          id: message.id,
          type: "assistant:clarification",
          messages: [message],
        });
      } else if (matchedGroup) {
        matchedGroup.messages.push(message);
      } else {
        groups.push({
          id: message.id ?? message.tool_call_id,
          type: "assistant:processing",
          messages: [message],
        });
      }
    } else if (message.type === "ai") {
      if (hasReasoning(message) || hasToolCalls(message)) {
        if (hasPresentFiles(message)) {
          groups.push({
            id: message.id,
            type: "assistant:present-files",
            messages: [message],
          });
        } else if (hasSubagent(message)) {
          groups.push({
            id: message.id,
            type: "assistant:subagent",
            messages: [message],
          });
        } else {
          if (lastGroup?.type !== "assistant:processing") {
            groups.push({
              id: message.id,
              type: "assistant:processing",
              messages: [],
            });
          }
          const currentGroup = groups[groups.length - 1];
          if (currentGroup?.type === "assistant:processing") {
            currentGroup.messages.push(message);
          } else {
            throw new Error(
              "Assistant message with reasoning or tool calls must be preceded by a processing group",
            );
          }
        }
      }
      if (hasContent(message) && !hasToolCalls(message)) {
        groups.push({
          id: message.id,
          type: "assistant",
          messages: [message],
        });
      }
    }
  }

  const resultsOfGroups: T[] = [];
  for (const group of groups) {
    const resultOfGroup = mapper(group);
    if (resultOfGroup !== undefined && resultOfGroup !== null) {
      resultsOfGroups.push(resultOfGroup);
    }
  }
  return resultsOfGroups;
}

export function extractTextFromMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

export function extractContentFromMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => {
        switch (content.type) {
          case "text":
            return content.text;
          case "image_url":
            const imageURL = extractURLFromImageURLContent(content.image_url);
            return `![image](${imageURL})`;
          default:
            return "";
        }
      })
      .join("\n")
      .trim();
  }
  return "";
}

export function extractReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai") {
    return null;
  }

  const reasoningFromKwargs = message.additional_kwargs?.reasoning_content;
  if (
    typeof reasoningFromKwargs === "string" &&
    reasoningFromKwargs.trim().length > 0
  ) {
    return reasoningFromKwargs;
  }

  if (!Array.isArray(message.content)) {
    return null;
  }

  const parts = message.content
    .map((block) => extractReasoningFromContentBlock(block))
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
  if (parts.length > 0) {
    return parts.join("\n\n");
  }
  return null;
}

function extractReasoningFromContentBlock(block: unknown): string | null {
  if (!block || typeof block !== "object") {
    return null;
  }

  const contentBlock = block as MessageContentBlock;
  const blockType = contentBlock.type;
  if (blockType !== "thinking" && blockType !== "reasoning") {
    return null;
  }

  for (const key of [
    "thinking",
    "reasoning",
    "reasoning_content",
    "text",
  ] as const) {
    const value = contentBlock[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

export function removeReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai") {
    return;
  }
  if (message.additional_kwargs) {
    delete message.additional_kwargs.reasoning_content;
  }
  if (Array.isArray(message.content)) {
    message.content = message.content.filter((block) => {
      if (!block || typeof block !== "object") {
        return true;
      }
      const blockType = (block as MessageContentBlock).type;
      return blockType !== "thinking" && blockType !== "reasoning";
    });
  }
}

export function extractURLFromImageURLContent(
  content:
    | string
    | {
        url: string;
      },
) {
  if (typeof content === "string") {
    return content;
  }
  return content.url;
}

export function hasContent(message: Message) {
  if (typeof message.content === "string") {
    return message.content.trim().length > 0;
  }
  if (Array.isArray(message.content)) {
    return message.content.length > 0;
  }
  return false;
}

export function hasReasoning(message: Message) {
  return typeof extractReasoningContentFromMessage(message) === "string";
}

export function hasToolCalls(message: Message) {
  return (
    message.type === "ai" && message.tool_calls && message.tool_calls.length > 0
  );
}

export function hasPresentFiles(message: Message) {
  return (
    message.type === "ai" &&
    message.tool_calls?.some((toolCall) => toolCall.name === "present_files")
  );
}

export function isClarificationToolMessage(message: Message) {
  return message.type === "tool" && message.name === "ask_clarification";
}

export function extractPresentFilesFromMessage(message: Message) {
  if (message.type !== "ai" || !hasPresentFiles(message)) {
    return [];
  }
  const files: string[] = [];
  for (const toolCall of message.tool_calls ?? []) {
    if (
      toolCall.name === "present_files" &&
      Array.isArray(toolCall.args.filepaths)
    ) {
      files.push(...(toolCall.args.filepaths as string[]));
    }
  }
  return files;
}

export function hasSubagent(message: AIMessage) {
  for (const toolCall of message.tool_calls ?? []) {
    if (toolCall.name === "task") {
      return true;
    }
  }
  return false;
}

export function findToolCallResult(toolCallId: string, messages: Message[]) {
  for (const message of messages) {
    if (message.type === "tool" && message.tool_call_id === toolCallId) {
      const content = extractTextFromMessage(message);
      if (content) {
        return content;
      }
    }
  }
  return undefined;
}

/**
 * Represents a file stored in message additional_kwargs.files.
 * Used for optimistic UI (uploading state) and structured file metadata.
 */
export interface FileInMessage {
  filename: string;
  size: number; // bytes
  path?: string; // virtual path, may not be set during upload
  status?: "uploading" | "uploaded";
}

/**
 * Strip <uploaded_files> tag from message content.
 * Returns the content with the tag removed.
 */
export function stripUploadedFilesTag(content: string): string {
  return content
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, "")
    .trim();
}

export function parseUploadedFiles(content: string): FileInMessage[] {
  // Match <uploaded_files>...</uploaded_files> tag
  const uploadedFilesRegex = /<uploaded_files>([\s\S]*?)<\/uploaded_files>/;
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
  const match = content.match(uploadedFilesRegex);

  if (!match) {
    return [];
  }

  const uploadedFilesContent = match[1];

  // Check if it's "No files have been uploaded yet."
  if (uploadedFilesContent?.includes("No files have been uploaded yet.")) {
    return [];
  }

  // Check if the backend reported no new files were uploaded in this message
  if (uploadedFilesContent?.includes("(empty)")) {
    return [];
  }

  // Parse file list
  // Format: - filename (size)\n  Path: /path/to/file
  const fileRegex = /- ([^\n(]+)\s*\(([^)]+)\)\s*\n\s*Path:\s*([^\n]+)/g;
  const files: FileInMessage[] = [];
  let fileMatch;

  while ((fileMatch = fileRegex.exec(uploadedFilesContent ?? "")) !== null) {
    files.push({
      filename: fileMatch[1].trim(),
      size: parseInt(fileMatch[2].trim(), 10) ?? 0,
      path: fileMatch[3].trim(),
    });
  }

  return files;
}
