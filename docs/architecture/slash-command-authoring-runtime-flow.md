# Slash Command / Authoring 运行架构

本文记录当前 OpenAgents 在 slash command、agent authoring、skill 装配上的运行架构。

目标只有两个：

1. slash command 只负责路由和模板，不负责理解“目标是谁”
2. 业务目标必须落在工具参数里，不保留任何 fallback 或双重真相

这份文档是中文收口版，后续改动请先对照：

- `docs/architecture/agent-authoring-command-contract.md`
- `docs/architecture/runtime-semantic-boundary.md`
- `backend/agents/AGENTS.md`

## 核心原则

### 1. slash command 只是路由，不是语义解析器

- 前端可以识别 `/create-agent`
- 前端可以保留原始参数尾巴为 `command_args`
- 前端可以传显式 UI 字段，例如 `target_agent_name`
- 前端和后端都不能从自然语言里猜 `target_agent_name` / `target_skill_name`

### 2. command 元数据只来自 command markdown

- `kind`
- `authoring_actions`
- `prompt template`

这些字段只能从 `.openagents/commands/common/*.md` 读取。

运行时允许传入的只有：

- `command_name`
- `command_args`
- `original_user_input`
- 显式 UI 结构化字段，例如 `target_agent_name`

不再接受“外部顺手塞一个 `command_kind` / `authoring_actions` 当 fallback”。

### 3. 执行目标必须在工具参数里

正确做法：

- `setup_agent(agent_name=..., skills=[...])`
- `save_agent_to_store(agent_name=...)`
- `push_agent_prod(agent_name=...)`
- `save_skill_to_store(skill_name=...)`
- `push_skill_prod(skill_name=...)`

唯一允许的隐式默认值：

- 非 `lead_agent` 的 dev agent 自修改自己时，`setup_agent` / `save_agent_to_store` / `push_agent_prod` 可以默认当前 agent

### 4. guard 由 command 状态触发，不由猜测目标触发

- `/create-agent` 只要命令成立，guard 就生效
- `/push-*`、`/save-*` 这类 hard command 只要命令成立，direct-authoring guard 就生效
- guard 不等待“先猜出目标是谁”

### 5. 结构化解析可以保留，语义猜测必须禁止

允许：

- slash token / `command_args`
- 显式 `@document` 语法
- `<next_steps>` JSON
- `question_result` JSON
- 显式 UI 字段

禁止：

- 从用户自然语言里猜 target agent / target skill / KB mode
- 从 assistant prose 里猜 next-step agent 切换或线程复用
- 在 middleware 里用关键词表猜 visual/debug/research/intake mode
- 先有结构化协议，再补一层 heuristic/fallback

## ASCII 架构图

```text
┌──────────────┐
│   Frontend   │
│ slash 路由/UI │
└──────┬───────┘
       │ 只传 syntax-level 信息
       │ command_name / command_args / original_user_input
       │ + 显式 UI 字段(target_agent_name 等)
       v
┌──────────────┐
│   Gateway    │
│ 透明转发上下文 │
└──────┬───────┘
       v
┌──────────────────────────────────────────┐
│ lead_agent.make_lead_agent               │
│                                          │
│ 1. resolve_runtime_command()             │
│    - 读 command markdown                 │
│    - 生成 kind / authoring_actions       │
│    - 渲染 command prompt                 │
│                                          │
│ 2. apply_prompt_template()               │
│    - 只生成基础 system prompt            │
│    - 不拼每轮 command 状态               │
│                                          │
│ 3. RuntimeCommandMiddleware              │
│    - 把当轮 command 元数据注入 system    │
│                                          │
│ 4. AuthoringGuardMiddleware              │
│    - 阻止错误路径、宿主路径、绕过工具     │
└──────┬───────────────────────────────────┘
       │
       v
┌──────────────────────────────────────────┐
│ Tools + Filesystem                       │
│                                          │
│ read_file / ls / grep                    │
│   └─ 读取 copied skill，或读取选中的     │
│      /mnt/skills/store/.../SKILL.md      │
│                                          │
│ setup_agent(...)                         │
│   └─ 持久化 agent + 显式 skill 装配      │
│                                          │
│ save/push_*                              │
│   └─ 显式保存/发布                       │
└──────┬───────────────────────────────────┘
       │
       v
┌──────────────────────────────────────────┐
│ Archive / Runtime                        │
│                                          │
│ .openagents/commands/common/*.md         │
│ .openagents/agents/{dev,prod}/...        │
│ .openagents/skills/store/{dev,prod}/...  │
│ /mnt/user-data/agents/...                │
└──────────────────────────────────────────┘
```

## 关键链路

### A. `/create-agent`

1. 前端只声明：这是 `/create-agent`
2. 后端读取 `create-agent.md`，得到模板和 command 元数据
3. `RuntimeCommandMiddleware` 把本轮 command 提示注入模型
4. 模型自己决定：
   - 是否先读已有 agent
   - 如果用户要“找现有 skill”，是否先读 attached `find-skills` skill
   - 是否先在 `/mnt/skills/store/dev/...` 与 `/mnt/skills/store/prod/...` 中找本地 archived skill
   - 如果已经确定具体 archived skill，是否读取对应 `/mnt/skills/<source_path>/SKILL.md`
   - 最后是否 `setup_agent(agent_name=..., skills=[...])`
5. `AuthoringGuardMiddleware` 阻止它去写错误目录、宿主路径、或绕过 `setup_agent`

### B. 非 `lead_agent` 的 dev agent 自修改

1. 运行时 prompt 会额外注入 `<self_authoring>`
2. agent 先读自己当前 `/mnt/user-data/agents/{status}/{agent_name}/...`
3. 最终必须走 `setup_agent`
4. 禁止直接 `write_file` / `edit_file` 改 runtime copy

### C. canonical skill 链路

当前 OpenAgents 的 canonical runtime skill mechanism 已经收口：

1. archived skill 存在于 `.openagents/skills/store/{dev,prod}/...`
2. `setup_agent(..., skills=[{source_path: "..."}])` 把 skill materialize 到 agent archive
3. agent archive copied skill 位于 `.openagents/agents/{status}/{name}/skills/...`
4. runtime 只读 `/mnt/user-data/agents/{status}/{name}/skills/...`
5. `apply_prompt_template()` 只暴露 attached skill 的名称、描述和 copied `SKILL.md` 虚拟路径
6. 模型自己用 `read_file` 读取 copied `SKILL.md` 并执行

当前明确不再使用的 OpenAgents runtime 路径：

- 不再把 copied skills 通过 Deep Agents `skills=` 注入
- 不再把 `SkillsMiddleware` / `skills_metadata` 当作 OpenAgents runtime skill 生效的必要条件

这不影响 `opencode` 本身仍然拥有显式 `skill` 工具；只是 OpenAgents 没有照搬那套 runtime 工具契约。

仍然成立的生命周期规则：

- archived store skill 被修改后，不会自动回写到已经存在的 agent-owned copied skill
- 现有 agent 想拿到新版 skill，必须再走一次显式 agent 更新/materialize 流程

### D. `find-skills` 的定位

`find-skills` 在 OpenAgents 里是一个发现策略 skill，不是新的 runtime skill 注入架构。

当前固定规则：

- 先搜索本地 archived store
  - `/mnt/skills/store/dev/...`
  - `/mnt/skills/store/prod/...`
- 先读取候选 skill 的 `SKILL.md` 再判断是否匹配
- 如果要把本地 archived skill 装到 agent 上，最终仍然靠
  `setup_agent(..., skills=[{source_path: "..."}])`
- 只有在用户明确要安装外部 skill，或本地 archived store 没有合适 skill 时，才进入 registry 搜索 / 安装

这意味着：

- `find-skills` 不替代 copied skill
- `find-skills` 不替代 `setup_agent`
- `find-skills` 也不意味着 OpenAgents 已切换到 `opencode` 的显式 `skill` 工具模型

### E. hard authoring command

`/save-*`、`/push-*` 这类 command 会触发 direct-authoring guard：

- 优先调用对应 authoring tool
- 不允许转去文件系统 workaround
- 不允许走 shell + host path 绕过发布/保存流程

### F. `AGENTS.md` 和 `SKILL.md` 的职责分离

如果一个 agent 的核心能力来自 attached copied skill：

- `AGENTS.md` 只保留高层角色、边界、少量非 skill 层运行约束
- 详细流程、审查顺序、检查清单、输出模板，应以 copied `SKILL.md` 为唯一详细来源
- 不要在 `AGENTS.md` 里重写一遍 skill 流程，否则会形成第二套弱指令源

推荐形态：

- `AGENTS.md` 说清楚“这是合同审查 agent，先读 attached `contract-review` skill，再按 skill 执行”
- `SKILL.md` 才放四层审查、引用规则、输出结构、知识库模式等细节

错误形态：

- `AGENTS.md` 自己再写一套“六步工作流 / 输出目录 / 风险分级”
- copied `SKILL.md` 又写另一套更细规则
- 运行时模型在两套相似但不完全相同的说明之间摇摆

### G. task mode 归 skill，不归前端或额外 prompt 猜测

当同一个领域 skill 既可能处理：

- 可编辑 DOCX 审批产物
- 知识库中的 PDF / Markdown / Word 检索审查

应由 `SKILL.md` 自己定义不同 mode 的行为边界，而不是：

- 前端做正则/启发式猜测
- 在 `AGENTS.md` 再补一套半重叠说明
- 在没有完成迁移定义前，额外补一套未定义清楚的 skill inventory / tool 契约

这样可以把“领域行为”收敛回 skill 文件本身，避免运行时出现多套半同步契约。

## 本次记录的关键教训

### 需要长期记住的点

- `apply_prompt_template(...)` 中不再保留未使用的 command 参数
- `RuntimeCommandMiddleware.build_runtime_command_prompt(...)` 去掉未使用的 `state`
- `resolve_runtime_command(...)` 不再接受外部注入的 `command_kind` / `authoring_actions`
- `../opencode` 是本地对齐参考仓库，不允许只凭记忆说“已经对齐 opencode”
- slash-command 对齐与 runtime skill 架构是两个不同问题，不能互相替代
- OpenAgents runtime 当前唯一 skill 消费真相是“copied skill + prompt 暴露路径 + 模型 read_file”

## 关键源码索引

### Slash command 解析

- `backend/agents/src/config/commands_config.py`
  - `resolve_runtime_command(...)`
  - 关键注释：command 元数据只来自 archived command definition

### 基础 prompt 与当轮 command 注入

- `backend/agents/src/agents/lead_agent/prompt.py`
  - `apply_prompt_template(...)`
  - `_get_authoring_context(...)`
- `backend/agents/src/agents/middlewares/runtime_command_middleware.py`
  - `build_runtime_command_prompt(...)`

### Guard

- `backend/agents/src/agents/middlewares/authoring_guard_middleware.py`
  - `/create-agent` guard
  - self-authoring persistence guard
  - direct-authoring guard

### Skill 装配与去重

- `backend/agents/src/skills/archive.py`
  - `find_archived_skills_by_name(...)`
  - `find_archived_skill_by_source_path(...)`
- `backend/agents/src/tools/builtins/install_skill_from_registry_tool.py`
- `backend/agents/src/tools/builtins/setup_agent_tool.py`

## 审查重点

如果以后再看到下面任一形态，默认视为架构回退：

- 前端 regex 猜 agent/skill 目标
- 后端从自然语言里推断 `target_*`
- command 元数据同时从 UI 和 markdown 两边读取
- archived skill 范围在多个工具里各写一套
- 用“对齐 opencode”作为 runtime skill 重构的笼统理由
- 重新把 copied skill 接回 Deep Agents `skills=` / `SkillsMiddleware`
- `setup_agent` 因为本轮看过某个 skill 就自动继承它
- `/create-agent` 不经 `setup_agent` 持久化
- dev agent 直接改 `/mnt/user-data/agents/...` 代替 `setup_agent`
- skill 主导型 agent 的 `AGENTS.md` 里再复制一套详细 skill 流程
