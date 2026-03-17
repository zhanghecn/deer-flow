---
name: create-agent
kind: hard
description: 开始创建一个新智能体
authoring_actions:
  - setup_agent
---

你现在开始一个 agent 创作任务。
用户需求：
{{user_text}}

请自主判断是否需要 bootstrap、现有 skills、find-skills、skill-creator 或联网检索。
如果当前运行已经提供固定的目标 agent 名称并允许直接建档，你必须在完成必要澄清后调用 `setup_agent` 直接创建或更新对应的 dev agent。
不要使用 `write_file`、`execute`、`mkdir`、`cp` 等手段手动往 `/mnt/user-data/agents/...` 写 agent 目录；那只会产生线程内临时文件，无法成为可切换测试的正式 agent。
只有在没有固定目标名称、或当前流程明确要求先出草稿时，才先在 `/mnt/user-data/authoring/agents` 下起草并等待用户明确保存。
调用 `setup_agent` 时请严格区分 skill 来源：复用现有 shared/store skill 时，在 `skills` 里只传 `{name}`；如果是新写的 agent 专属 skill，必须在对应 skill 条目里传完整 `content`，也就是完整的 `SKILL.md`。

当前回合结束时，必须给出简短结果说明，并附上 `<next_steps>`。
- 第一个 next-step 默认应是“测试 agent”。
- “测试 agent” 这个 next-step 必须在 JSON 里带上新建 agent 的 `agent_name` 和 `agent_status: "dev"`，让 UI 可以直接切换过去。
- “测试 agent” 的 `prompt` 默认不要让后续回合去模拟、杜撰或自动生成一份示例合同。若当前线程里已有合适的真实上传文件，就直接让新 agent 用那个文件测试；若还没有真实文件，就让新 agent 先提示用户上传或选择一份真实合同再开始测试。
- 第二个可选 next-step 再考虑“优化 agent”或“调整 AGENTS.md / skills”；如果适用，再提供保存/发布相关动作。
