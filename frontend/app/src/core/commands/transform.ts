import type { ResolvedCommandIntent } from "./types";

import { findPromptCommand } from "./index";

export function resolveCommandIntent(
  input: string,
): ResolvedCommandIntent | null {
  const rawInput = input.trim();
  if (!rawInput.startsWith("/")) {
    return null;
  }

  const firstSpace = rawInput.indexOf(" ");
  const commandText =
    firstSpace === -1 ? rawInput.slice(1) : rawInput.slice(1, firstSpace);
  const argsText =
    firstSpace === -1 ? "" : rawInput.slice(firstSpace + 1).trim();
  const command = findPromptCommand(commandText);
  if (!command) {
    return null;
  }

  const promptText = command.promptTemplate.replace(
    "{{user_text}}",
    argsText || "无",
  );

  return {
    command,
    rawInput,
    commandText: command.name,
    argsText,
    promptText,
    extraContext: {
      command_name: command.name,
      command_kind: command.kind,
      authoring_actions: command.authoringActions ?? [],
      original_user_input: rawInput,
    },
  };
}

export function getSlashQuery(input: string): string | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const withoutSlash = trimmed.slice(1);
  const firstSpace = withoutSlash.indexOf(" ");
  if (firstSpace !== -1) {
    return null;
  }
  return withoutSlash;
}
