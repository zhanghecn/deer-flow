import type { Message } from "@langchain/langgraph-sdk";

import { isDesignDocumentPath } from "@/core/design-board/paths";
const PATH_FIELD_NAMES = new Set([
  "file_path",
  "target_path",
  "path",
  "paths",
  "filepaths",
]);

function normalizePath(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function collectPathFieldValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizePath(item))
      .filter((item): item is string => item !== null);
  }

  const normalizedPath = normalizePath(value);
  return normalizedPath ? [normalizedPath] : [];
}

function extractStructuredToolPaths(message: Message): string[] {
  if (message.type !== "ai") {
    return [];
  }

  const paths: string[] = [];
  for (const toolCall of message.tool_calls ?? []) {
    const args = toolCall.args;
    if (!args || typeof args !== "object") {
      continue;
    }

    for (const [fieldName, value] of Object.entries(args)) {
      if (!PATH_FIELD_NAMES.has(fieldName)) {
        continue;
      }
      paths.push(...collectPathFieldValues(value));
    }
  }
  return paths;
}

export function inferWorkbenchSurfaceFromMessages(messages: Message[]) {
  // Only inspect structured tool arguments here. This keeps the routing hint on
  // the machine-readable side of the contract instead of inferring intent from
  // free-form assistant or user prose.
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const toolPaths = extractStructuredToolPaths(messages[messageIndex]!);
    const designTargetPath = toolPaths.find(isDesignDocumentPath);
    if (designTargetPath) {
      return {
        surface: "design" as const,
        target_path: designTargetPath,
      };
    }
  }

  return null;
}
