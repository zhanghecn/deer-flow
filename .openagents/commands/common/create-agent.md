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
如果你是在修复 target agent 已有的 agent 专属 copied skill（它只存在于 `/mnt/user-data/agents/{status}/{target_agent_name}/skills/...`，并不在 shared/store 里），不要只传 `{name}`。先读取它当前的 `SKILL.md`，再以 `{name, content}` 形式传给 `setup_agent`。
当你需要查看当前运行时已经可见的 copied skills 时，只能查看 `/mnt/user-data/agents/{status}/lead_agent/skills/`、`/mnt/user-data/agents/{status}/{agent}/skills/` 或 `/mnt/user-data/authoring/...` 这些运行时路径。不要猜测或读取宿主路径、包安装路径、隐藏目录路径，例如 `~/.agents`、`.openagents`、`/app/.kimi`、`/home/user/.local/...` 等。
`/mnt/user-data` 下的规范顶层目录只有 `agents`、`authoring`、`uploads`、`workspace`、`outputs`。不要发明 `/mnt/user-data/agentz` 之类的路径变体。
当当前运行已经提供 `target_agent_name` 时，不要为了“确认目标 agent 是否存在”去搜索运行时文件路径。`setup_agent` 会按这个目标名直接创建或更新归档 agent。
如果你确实需要对已存在的 target agent 做只读检查，只看 `/mnt/user-data/agents/{status}/{target_agent_name}/...` 这一条规范路径；如果这里没有，不要再猜别的路径。
除非用户明确要求切换模型，否则调用 `setup_agent` 时不要传 `model` 字段；省略后会自动继承当前运行时模型选择。
如果用户已经明确指定要复用某个现有 skill 名称，优先直接把该 skill 名称放进 `setup_agent.skills`，而不是先去推测 skill 的宿主文件位置。

当前回合结束时，必须给出简短结果说明，并附上 `<next_steps>`。
- 第一个 next-step 默认应是“测试 agent”。
- “测试 agent” 这个 next-step 必须在 JSON 里带上新建 agent 的 `agent_name` 和 `agent_status: "dev"`，让 UI 可以直接切换过去。
- “测试 agent” 的 `prompt` 默认不要让后续回合去模拟、杜撰或自动生成一份示例合同。若当前线程里已有合适的真实上传文件，就直接让新 agent 用那个文件测试；若还没有真实文件，就让新 agent 先提示用户上传或选择一份真实合同再开始测试。
- 第二个可选 next-step 再考虑“优化 agent”或“调整 AGENTS.md / skills”；如果适用，再提供保存/发布相关动作。
