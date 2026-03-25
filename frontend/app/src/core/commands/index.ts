import type { Translations } from "@/core/i18n";

import type { PromptCommand } from "./types";

const PROMPT_COMMAND_NAMES = [
  "knowledge-add",
  "create-agent",
  "create-skill",
  "save-agent-to-store",
  "save-skill-to-store",
  "push-agent-prod",
  "push-skill-prod",
  "promote-skill-shared",
] as const;

export function getPromptCommands(t: Translations): PromptCommand[] {
  return [
    {
      name: "knowledge-add",
      description: t.commands.knowledgeAdd,
    },
    {
      name: "create-agent",
      description: t.commands.createAgent,
    },
    {
      name: "create-skill",
      description: t.commands.createSkill,
    },
    {
      name: "save-agent-to-store",
      description: t.commands.saveAgentToStore,
    },
    {
      name: "save-skill-to-store",
      description: t.commands.saveSkillToStore,
    },
    {
      name: "push-agent-prod",
      description: t.commands.pushAgentProd,
    },
    {
      name: "push-skill-prod",
      description: t.commands.pushSkillProd,
    },
    {
      name: "promote-skill-shared",
      description: t.commands.promoteSkillShared,
    },
  ];
}

export function findPromptCommand(rawName: string): PromptCommand | undefined {
  const normalized = rawName.trim().replace(/^\//, "");
  if (
    !PROMPT_COMMAND_NAMES.includes(
      normalized as (typeof PROMPT_COMMAND_NAMES)[number],
    )
  ) {
    return undefined;
  }
  return {
    name: normalized,
    description: normalized,
  };
}
