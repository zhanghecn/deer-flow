import type { PromptCommand } from "./types";

export const PROMPT_COMMANDS: PromptCommand[] = [
  {
    name: "create-agent",
    description: "开始创建一个新智能体",
  },
  {
    name: "create-skill",
    description: "开始创建一个新技能",
  },
  {
    name: "save-agent-to-store",
    description: "确认将当前 agent 草稿保存到 dev 仓库",
  },
  {
    name: "save-skill-to-store",
    description: "确认将当前 skill 草稿保存到 dev 仓库",
  },
  {
    name: "push-agent-prod",
    description: "确认将 dev agent 推送到 prod",
  },
  {
    name: "push-skill-prod",
    description: "确认将 dev skill 推送到 prod",
  },
  {
    name: "promote-skill-shared",
    description: "确认将 prod skill 提升为 shared",
  },
];

export function findPromptCommand(rawName: string): PromptCommand | undefined {
  const normalized = rawName.trim().replace(/^\//, "");
  return PROMPT_COMMANDS.find((command) => command.name === normalized);
}
