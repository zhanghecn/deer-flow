import type { ToolCall } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/langgraph-sdk";

import type { Translations } from "../i18n";
import { hasToolCalls } from "../messages/utils";

function getStringArg(args: unknown, ...keys: string[]) {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const source = args as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

export function explainLastToolCall(message: AIMessage, t: Translations) {
  if (hasToolCalls(message)) {
    const lastToolCall = message.tool_calls![message.tool_calls!.length - 1]!;
    return explainToolCall(lastToolCall, t);
  }
  return t.common.thinking;
}

export function explainToolCall(toolCall: ToolCall, t: Translations) {
  if (toolCall.name === "web_search" || toolCall.name === "image_search") {
    return t.toolCalls.searchFor(toolCall.args.query);
  } else if (toolCall.name === "web_fetch") {
    return t.toolCalls.viewWebPage;
  } else if (toolCall.name === "execute" || toolCall.name === "bash") {
    const command = getStringArg(toolCall.args, "command", "cmd");
    return command ? `${t.toolCalls.executeCommand}: ${command}` : t.toolCalls.executeCommand;
  } else if (toolCall.name === "read_file") {
    const path = getStringArg(toolCall.args, "path", "file_path");
    return path ? `${t.toolCalls.readFile}: ${path}` : t.toolCalls.readFile;
  } else if (
    toolCall.name === "write_file" ||
    toolCall.name === "edit_file" ||
    toolCall.name === "str_replace"
  ) {
    const path = getStringArg(toolCall.args, "path", "file_path");
    return path ? `${t.toolCalls.writeFile}: ${path}` : t.toolCalls.writeFile;
  } else if (toolCall.name === "grep") {
    const pattern = getStringArg(toolCall.args, "pattern");
    return pattern ? `${t.toolCalls.useTool("grep")}: ${pattern}` : t.toolCalls.useTool("grep");
  } else if (toolCall.name === "glob") {
    const pattern = getStringArg(toolCall.args, "pattern");
    return pattern ? `${t.toolCalls.useTool("glob")}: ${pattern}` : t.toolCalls.useTool("glob");
  } else if (toolCall.name === "present_files") {
    return t.toolCalls.presentFiles;
  } else if (toolCall.name === "write_todos") {
    return t.toolCalls.writeTodos;
  } else if (toolCall.args.description) {
    return toolCall.args.description;
  } else {
    return t.toolCalls.useTool(toolCall.name);
  }
}
