---
name: create-agent
kind: soft
description: 开始创建一个新智能体
authoring_actions: []
---

你现在开始一个 agent 创作任务。
用户需求：
{{user_text}}

请自主判断是否需要 bootstrap、现有 skills、find-skills、skill-creator 或联网检索。
如果当前运行已经提供固定的目标 agent 名称并允许直接建档，请在完成必要澄清后调用 `setup_agent` 直接创建或更新对应的 dev agent。
只有在没有固定目标名称、或当前流程明确要求先出草稿时，才先在 `/mnt/user-data/authoring/agents` 下起草并等待用户明确保存。
调用 `setup_agent` 时请严格区分 skill 来源：复用现有 shared/store skill 时，在 `skills` 里只传 `{name}`；如果是新写的 agent 专属 skill，必须在对应 skill 条目里传完整 `content`，也就是完整的 `SKILL.md`。
