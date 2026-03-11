import type { PromptCommand } from "./types";

export const PROMPT_COMMANDS: PromptCommand[] = [
  {
    name: "create-agent",
    kind: "soft",
    description: "开始创建一个新智能体草稿",
    promptTemplate:
      "你现在开始一个 agent 创作任务。\n用户需求：\n{{user_text}}\n\n请自主判断是否需要 bootstrap、现有 skills、find-skills、skill-creator 或联网检索。先在 /mnt/user-data/authoring/agents 下起草，再等待用户明确保存。",
  },
  {
    name: "create-skill",
    kind: "soft",
    description: "开始创建一个新技能草稿",
    promptTemplate:
      "你现在开始一个 skill 创作任务。\n用户需求：\n{{user_text}}\n\n请自主判断是否先复用现有 skills、使用 find-skills、使用 skill-creator 或联网检索。先在 /mnt/user-data/authoring/skills 下起草，再等待用户明确保存。",
  },
  {
    name: "save-agent-to-store",
    kind: "hard",
    description: "确认将当前 agent 草稿保存到 dev 仓库",
    authoringActions: ["save_agent_to_store"],
    promptTemplate:
      "用户已明确确认：现在允许把当前 agent 草稿或当前线程里的 dev 运行时修改版保存到 `.openagents/agents/dev`。\n如果条件满足，请调用 `save_agent_to_store`。\n附加说明：{{user_text}}",
  },
  {
    name: "save-skill-to-store",
    kind: "hard",
    description: "确认将当前 skill 草稿保存到 dev 仓库",
    authoringActions: ["save_skill_to_store"],
    promptTemplate:
      "用户已明确确认：现在允许把当前 skill 草稿保存到 `.openagents/skills/store/dev`。\n如果条件满足，请调用 `save_skill_to_store`。\n附加说明：{{user_text}}",
  },
  {
    name: "push-agent-prod",
    kind: "hard",
    description: "确认将 dev agent 推送到 prod",
    authoringActions: ["push_agent_prod"],
    promptTemplate:
      "用户已明确确认：现在允许把指定的 dev agent 推送到 `.openagents/agents/prod`。\n如果条件满足，请调用 `push_agent_prod`。\n附加说明：{{user_text}}",
  },
  {
    name: "push-skill-prod",
    kind: "hard",
    description: "确认将 dev skill 推送到 prod",
    authoringActions: ["push_skill_prod"],
    promptTemplate:
      "用户已明确确认：现在允许把指定的 dev skill 推送到 `.openagents/skills/store/prod`。\n如果条件满足，请调用 `push_skill_prod`。\n附加说明：{{user_text}}",
  },
  {
    name: "promote-skill-shared",
    kind: "hard",
    description: "确认将 prod skill 提升为 shared",
    authoringActions: ["promote_skill_shared"],
    promptTemplate:
      "用户已明确确认：现在允许把指定的 prod store skill 提升到 `.openagents/skills/shared`。\n如果条件满足，请调用 `promote_skill_shared`。\n附加说明：{{user_text}}",
  },
];

export function findPromptCommand(rawName: string): PromptCommand | undefined {
  const normalized = rawName.trim().replace(/^\//, "");
  return PROMPT_COMMANDS.find((command) => command.name === normalized);
}
