---
name: create-agent
kind: soft
description: 开始创建一个新智能体
authoring_actions:
  - setup_agent
---

你现在开始一个 agent 创作任务。
用户需求：
{{user_text}}

`/create-agent` 只是进入 agent 创作工作流的路由，不负责替你解析目标 agent 名称。你必须自己从用户要求或显式结构化 UI 上下文里判断目标 agent，并在调用 `setup_agent` 时显式传入 `agent_name`。如果用户只描述了角色没有给名称，你也必须先自己选一个简短 kebab-case 名称再调用 `setup_agent`，不要省略该字段。

执行原则：
- 优先产出一个可直接切换测试的 `dev` agent。
- 不要用 `write_file`、`execute`、`mkdir`、`cp` 等方式手动往 `/mnt/user-data/agents/...` 写归档 agent；正式创建或更新必须通过 `setup_agent(...)`。
- 只有在没有固定目标名称、或当前流程明确要求先出草稿时，才先在 `/mnt/user-data/authoring/agents` 下起草并等待用户明确保存。
- 如果当前运行已经提供显式结构化的 `target_agent_name`，不要为了“确认目标 agent 是否存在”去搜索其他路径；如需只读检查，只看 `/mnt/user-data/agents/{status}/{target_agent_name}/...` 这一条规范路径。

skill 选择与装配规则：
- 如果用户要求“找一个现有的 skill”“复用已有 skill”“先找合适的 skill 再创建 agent”，先读取你已附加的 `find-skills` skill（如果当前 agent 已附加它）。
- skill 查找是 **本地 archived skill library 优先**：先在 `/mnt/skills/system/skills/...` 和 `/mnt/skills/custom/skills/...` 中搜索候选 skill，并读取候选 `SKILL.md` 核对是否匹配。
- `/mnt/skills/store/...` 只作为迁移期兼容输入；除非你是在处理已有 legacy `source_path`，否则不要再把它当成新的首选来源。
- 只有在用户明确要求安装外部 skill，或者本地 archived skill library 里没有合适 skill 时，才考虑外部 registry 搜索或安装。
- 一旦选中了本地 archived skill，最终调用 `setup_agent` 时必须把它明确写进 `skills`，并带上精确 `source_path`。不要只在分析里提到 skill 却漏掉装配。
- 当你决定复用一个现有 archived skill 时，先读取 `/mnt/skills/<source_path>/SKILL.md` 和它引用的文件，再继续写 agent 方案或调用 `setup_agent`。
- 如果用户明确指定了 skill 来源，或同名 skill 同时存在于多个归档来源，不要只传裸 `{name}`。这时必须显式传 `{source_path}` 或 `{name, source_path}`，例如 `system/skills/bootstrap` 或 `custom/skills/contract-review`。
- 如果你是在修复 target agent 已有的 agent 专属 copied skill（它只存在于 `/mnt/user-data/agents/{status}/{target_agent_name}/skills/...`，并不在 store 仓库里），先读取它当前的 `SKILL.md`，再以 `{name, content}` 形式传给 `setup_agent`。
- 如果省略 `setup_agent.skills`，语义是“保留 target agent 当前已有 skills”，不是“自动继承你本回合刚看过的 archived skill”。

生成 agent 时：
- 新 agent 的 `AGENTS.md` 必须保持精简，只描述角色、边界、什么时候读 skill，以及少量非 skill 层运行约束。
- 如果详细工作流、审查顺序、输出格式已经由 attached skill 定义，就让 copied `SKILL.md` 成为该领域任务的唯一详细流程来源。不要在 `AGENTS.md` 里再造一套第二流程或第二输出契约。
- 除非用户明确要求切换模型，否则调用 `setup_agent` 时不要传 `model` 字段；省略后会继承当前运行时模型选择。

当前回合结束时，必须给出简短结果说明，并附上 `<next_steps>`。
- 第一个 next-step 默认应是“测试 agent”。
- “测试 agent” 这个 next-step 必须在 JSON 里带上新建 agent 的 `agent_name` 和 `agent_status: "dev"`，让 UI 可以直接切换过去。
- “测试 agent” 的 `prompt` 默认不要让后续回合去模拟、杜撰或自动生成一份示例合同。若当前线程里已有合适的真实上传文件，就直接让新 agent 用那个文件测试；若还没有真实文件，就让新 agent 先提示用户上传或选择一份真实文件再开始测试。
- 第二个可选 next-step 再考虑“优化 agent”或“调整 AGENTS.md / skills”；如果适用，再提供保存/发布相关动作。
