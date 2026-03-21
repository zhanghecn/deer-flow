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

function inferTargetSkillName(argsText: string): string | undefined {
  const patterns = [
    /(?:名为|名字叫|叫做)\s+([A-Za-z0-9][A-Za-z0-9/_-]*)/i,
    /(?:skill[_\s-]*name|name)\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9/_-]*)/i,
    /source_path\s*[:=]\s*(?:shared|store\/(?:dev|prod))\/([A-Za-z0-9][A-Za-z0-9/_-]*)/i,
    /(?:shared|store\/(?:dev|prod))\/([A-Za-z0-9][A-Za-z0-9/_-]*)/i,
    /(?:^|[\s,.:;!?，。：；！？()（）])(?:已有|已存在|现有|保存|发布|推送|创建|这个|该)?\s*(?:(?:dev|prod)\s+)?(?:skill|技能)\s*[`'"]?([A-Za-z0-9][A-Za-z0-9/_-]*)[`'"]?/i,
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
  const targetSkillName = command.name.includes("skill")
    ? inferTargetSkillName(argsText)
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
      target_skill_name: targetSkillName,
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
