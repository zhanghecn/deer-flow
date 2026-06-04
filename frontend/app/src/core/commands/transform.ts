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

  return {
    command,
    rawInput,
    commandText: command.name,
    argsText,
    extraContext: {
      command_name: command.name,
      command_args: argsText,
      original_user_input: rawInput,
    },
  };
}

export function buildPromptExtraContext(
  input: string,
): Record<string, unknown> | undefined {
  const extraContext: Record<string, unknown> = {};
  const resolvedCommand = resolveCommandIntent(input);
  if (resolvedCommand) {
    Object.assign(extraContext, resolvedCommand.extraContext);
  }

  return Object.keys(extraContext).length > 0 ? extraContext : undefined;
}

export function buildCreateAgentFlowExtraContext(
  input: string,
  targetAgentName: string,
): Record<string, unknown> | undefined {
  const trimmed = input.trim();
  const baseContext = buildPromptExtraContext(input) ?? {};

  if (trimmed && !("command_name" in baseContext)) {
    baseContext.command_name = "create-agent";
    baseContext.command_args = trimmed;
    baseContext.original_user_input = trimmed;
  }

  if (
    targetAgentName.trim() &&
    (!("target_agent_name" in baseContext) ||
      baseContext.target_agent_name == null ||
      baseContext.target_agent_name === "")
  ) {
    baseContext.target_agent_name = targetAgentName.trim();
  }

  return Object.keys(baseContext).length > 0 ? baseContext : undefined;
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
