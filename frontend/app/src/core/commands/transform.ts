import { extractSkillReferences } from "../skills/references";

import type { ResolvedCommandIntent } from "./types";

import { findPromptCommand } from "./index";

function inferTargetAgentName(argsText: string): string | undefined {
  const patterns = [
    /(?:名为|名字叫|叫做)\s+([A-Za-z0-9-]+)/i,
    /(?:named|called)\s+([A-Za-z0-9-]+)/i,
    /(?:agent[_\s-]*name|name)\s*[:=]\s*([A-Za-z0-9-]+)/i,
  ];

  for (const pattern of patterns) {
    const matched = argsText.match(pattern)?.[1]?.trim();
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

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

  const targetAgentName =
    command.name === "create-agent"
      ? inferTargetAgentName(argsText)
      : undefined;

  return {
    command,
    rawInput,
    commandText: command.name,
    argsText,
    extraContext: {
      command_name: command.name,
      command_args: argsText,
      target_agent_name: targetAgentName,
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

  const referencedSkillNames = extractSkillReferences(input);
  if (referencedSkillNames.length > 0) {
    extraContext.referenced_skill_names = referencedSkillNames;
  }

  return Object.keys(extraContext).length > 0 ? extraContext : undefined;
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
