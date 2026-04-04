# Opencode 对齐与 Skill 边界

这份文档记录 OpenAgents 当前已经收口的最终方案，避免下次再把 slash command、skill 发现、runtime skill 消费混成一套。

## 本地参考仓库

如果声称“已对齐 opencode”，必须先检查本地源码：

- 相对路径：`../opencode`
- 绝对路径：`/root/project/ai/opencode`

至少核对这些文件：

- `../opencode/packages/app/src/components/prompt-input.tsx`
- `../opencode/packages/opencode/src/config/config.ts`
- `../opencode/packages/opencode/src/session/prompt.ts`
- `../opencode/packages/opencode/src/command/index.ts`
- `../opencode/packages/opencode/src/tool/skill.ts`

## 对齐范围

OpenAgents 只在下面两层对齐 `opencode`：

1. slash command 是显式路由 / 模板选择入口
2. skill 详细内容不提前全部塞进系统提示词，而是由模型在需要时再读取

不对齐的部分也必须说清楚：

- OpenAgents 没有把 `opencode` 的显式 `skill` 工具原样搬过来
- OpenAgents 的 agent skill 仍然通过 `setup_agent(..., skills=[...])` 归档并 materialize
- OpenAgents runtime 消费的是 agent-owned copied skill，不是 archived store 本身

## OpenAgents 当前唯一 canonical skill 链路

```text
archived authored skill
  .openagents/system/skills/... or
  .openagents/custom/skills/...
        │
        │ 通过 setup_agent(..., skills=[{source_path: "..."}])
        v
agent archive copied skill
  .openagents/system/agents/{status}/lead_agent/skills/... or
  .openagents/custom/agents/{status}/{name}/skills/...
        │
        │ runtime seed
        v
thread runtime copied skill
  /mnt/user-data/agents/{status}/{name}/skills/...
        │
        │ apply_prompt_template() 仅暴露 attached skill 名称/描述/虚拟路径
        v
model uses read_file
  读取 copied SKILL.md
  并按该 skill 执行
```

## 当前实现 ASCII 架构图

下面这张图只描述 OpenAgents 当前认可的 runtime skill 链路，不包含旧的 `shared` 概念，也不把 Deep Agents 通用 `skills=` 注入误认为 OpenAgents 的 domain-skill 运行机制。

```text
用户
  │
  │ 1. 显式 slash command / 普通对话
  v
前端 / 网关 / 后端命令层
  - 只做语法级路由
  - 不从自然语言猜 agent / skill
  │
  │ 2. lead_agent 决定是否复用现有 skill
  v
lead_agent
  - 需要找现有 skill 时，先用 copied `find-skills`
  - 选中 archived store skill 后，通过 setup_agent 显式装配
  │
  │ 3. setup_agent(..., skills=[{source_path: "..."}])
  v
agent archive materialization
  .openagents/system/agents/{dev,prod}/lead_agent/ or
  .openagents/custom/agents/{dev,prod}/{agent}/
  - 写入 AGENTS.md
  - 写入 config.yaml.skill_refs[]
  - 复制 archived skill -> agent-owned copied skill
  │
  │ 4. 每个 thread 启动时 seed 到 runtime
  v
thread runtime copy
  /mnt/user-data/agents/{status}/{agent}/skills/.../SKILL.md
  │
  │ 5. prompt 只暴露 attached skill 名称 / 描述 / runtime 路径
  v
runtime model
  - 先 read_file copied SKILL.md
  - 如果 skill 要求 references/checklist.md，则继续 read_file
  - 再调用领域工具
  - 按 skill 输出契约给出可见答复
  │
  │ 6. 仅在用户显式要求文件，或 skill 当前模式强制要求文件时
  v
可选 artifact
  /mnt/user-data/outputs/...
```

当前 OpenAgents 的明确规则：

- archived reusable skills 的 canonical authored roots 是 `.openagents/system/skills/...` 与 `.openagents/custom/skills/...`
- `.openagents/skills/store/{dev,prod}` 只作为历史迁移输入保留，不再是新的 canonical write target
- `shared` 已废弃，不再作为单独 runtime scope
- `setup_agent(..., skills=[{source_path: "..."}])` 是 archived skill 装配的唯一正式入口
- agent config 记录 `skill_refs[].source_path`
- materialize 后的 copied skill 进入 `.openagents/system/agents/...` 或 `.openagents/custom/agents/...`
- runtime 只读 `/mnt/user-data/agents/{status}/{name}/skills/...`
- 模型必须用正常文件工具读取 copied `SKILL.md`

## Runtime Skill 执行顺序

运行时技能不是“提示词里摘要一遍就算执行”。

一旦当前任务命中了 attached copied skill，期望执行顺序是：

```text
匹配到 attached copied skill
  -> read_file 读取 copied SKILL.md
  -> 如果 SKILL.md 明确要求某个 relative reference
     例如 references/checklist.md
     则继续 read_file 读取该 reference
  -> 再调用该 skill 所要求的领域工具
  -> 最终按 SKILL.md 的输出契约组织可见答案
```

这里的关键边界：

- copied `SKILL.md` 是详细 workflow contract
- `references/*.md` 是 skill 明确要求时必须读取的补充 contract
- runtime prompt 只负责暴露路径和强调“先读再做”
- 不在 frontend / gateway / middleware 里替模型补业务理解

如果 copied `SKILL.md` 还区分了“默认聊天回答”与“显式文件交付”，也要按 skill 原文执行：

- 用户没有明确要求文件、报告 artifact、markdown/text 下载件时，优先直接在聊天中完成回答
- 只有 skill 明确要求或用户明确点名文件交付时，才生成额外 artifact
- 即便生成了 artifact，也不能以“只 present_files、不输出可见正文”结束当前回合

## Runtime Prompt 规则

当前 OpenAgents runtime 不再把 copied skills 走 Deep Agents `skills=` 注入。

也就是说：

- OpenAgents runtime 不再依赖 `SkillsMiddleware`
- OpenAgents runtime 不要求出现 `skills_metadata`
- 内部审计如果看不到 `skills_metadata`，这本身不是 bug

现在的 prompt 合同是：

- `AGENTS.md` 负责角色、边界、少量运行约束
- `apply_prompt_template()` 只补一段很薄的 `<attached_skills>`
- `<attached_skills>` 只列：
  - skill 名称
  - skill 简短描述
  - copied `SKILL.md` 的 runtime 虚拟路径
  - 可选 archived `source_path`
- 模型自己决定何时读取 skill
- 详细流程以 copied `SKILL.md` 为唯一详细来源

这条设计的目的只有一个：

- 不把整个 skill 仓库或大段 skill 内容强塞进系统提示词
- 也不靠前端 / gateway / middleware 去替模型做技能理解

为什么这里要保持“薄 prompt”：

- prompt 负责暴露 runtime 路径和执行边界，不复述整份 skill checklist
- copied `SKILL.md` 才是领域流程、覆盖要求、输出格式的唯一详细来源
- 这样可以避免把长流程拆成两份弱指令，导致 prompt 与 skill 漂移

## 为什么 `skills_metadata` 缺失不等于 bug

这里必须把 OpenAgents 和 Deep Agents 的通用能力分开看：

- Deep Agents 库本身仍然支持 `create_deep_agent(..., skills=[...])`
- 这条通用链路会挂 `SkillsMiddleware`，并在 state 中产生 `skills_metadata`
- 但 OpenAgents 当前 domain agent runtime **没有**把 attached copied skills 走这条注入链

OpenAgents 当前实际做法是：

- graph 构建时不把 attached copied skills 作为 `skills=` 传给 `create_deep_agent`
- 改为由 `apply_prompt_template()` 生成一个很薄的 `<attached_skills>` 段
- 模型自行 `read_file` 读取 `/mnt/user-data/agents/.../skills/.../SKILL.md`

所以：

- trace 里没有 `skills_metadata`，本身不构成 OpenAgents skill 失效的证据
- 真正应该检查的是“模型是否读取 copied `SKILL.md` 并遵循它”

## `find-skills` 的定位

`find-skills` 仍然是 OpenAgents 的发现策略 skill，不是新的 runtime skill 注入机制。

固定规则：

- 先查本地 canonical archived library：
  - `/mnt/skills/system/skills/...`
  - `/mnt/skills/custom/skills/...`
- `/mnt/skills/store/...` 只作为迁移期兼容输入
- 先读取候选 `SKILL.md` 再判断是否匹配
- 如果复用本地 archived skill，最后必须通过
  `setup_agent(..., skills=[{source_path: "..."}])`
  完成装配
- 只有本地没有合适 skill，或用户明确要求安装外部 skill，才走 registry / install

## 与 opencode 的边界

`opencode` 的 `skill` 工具与 OpenAgents 当前方案不是一回事。

`opencode`：

- 命令层显式路由
- skill 层有显式 `skill` 工具

OpenAgents：

- 命令层对齐 `opencode`
- runtime skill 消费不走显式 `skill` 工具
- runtime 通过 copied skill + prompt 暴露路径 + `read_file` 自主读取

因此以后如果写“对齐 opencode”，必须明确到底指：

- slash command routing
- command template loading
- skill discovery 思路

不能再把它笼统说成“所以 OpenAgents runtime skill 也该怎样”。

## 关键源码定位

按实际执行顺序，先看这些文件：

1. `backend/agents/src/tools/builtins/setup_agent_tool.py`
   - `setup_agent()` 是创建/更新 agent 的唯一正式入口
   - `_split_skill_inputs()` 区分 archived copied skill 与 inline agent-owned skill
   - `_refresh_thread_runtime_materials()` 把归档后的 agent/copied skill 同步到当前 thread runtime

2. `backend/agents/src/config/agent_materialization.py`
   - `materialize_agent_definition()` 原子化写入 agent archive
   - `materialize_agent_skill_refs()` 复制 archived store skill 到 agent-owned `skills/`
   - `validate_skill_refs_for_status()` 约束 dev/prod 可用 scope

3. `backend/agents/src/agents/lead_agent/prompt.py`
   - `_load_attached_skills_section()` 只暴露 attached copied skill 的名称、描述、runtime 路径
   - `apply_prompt_template()` 组装薄 prompt，不内联整份 skill 内容

4. `backend/agents/src/agents/lead_agent/agent.py`
   - `_build_graph_parts()` / `_create_lead_agent()` 负责把 prompt、middleware、tools 组装进 OpenAgents runtime
   - 当前并未在这里把 attached copied skills 作为 `skills=` 传给 `create_deep_agent`

5. `backend/agents/src/client.py`
   - embedded lead-agent 也走同一套 `apply_prompt_template()`，避免本地嵌入调用与服务端 runtime 分叉

6. `backend/deepagents/libs/deepagents/deepagents/graph.py`
   - 这是 Deep Agents 通用实现
   - 只有调用方显式传 `skills=` 时，才会挂 `SkillsMiddleware`
   - 这是库能力，不等于 OpenAgents 当前 runtime skill 合同

## 源码阅读顺序与注释

下面不是重新贴整份源码，而是给出建议的阅读顺序和每段代码真正承担的合同。

### A. `setup_agent` 为什么是唯一装配入口

先看 `backend/agents/src/tools/builtins/setup_agent_tool.py`：

- `skills=[{source_path: "..."}]`
  - 表示“复用 archived store skill，并复制到 agent archive”
- `skills=[{name: "...", content: "..."}]`
  - 表示“创建或覆盖 agent-owned inline skill”
- `skills` 省略
  - 表示“保留当前 agent 已有 skill 组合”

这里的关键注释理解是：

- 装配发生在 authoring 阶段
- runtime 阶段不再临时去 store 动态挂 skill

### B. copied skill 为什么要先落到 agent archive

再看 `backend/agents/src/config/agent_materialization.py`：

- archived skill 先复制进 `.openagents/system/agents/...` 或 `.openagents/custom/agents/...`
- `config.yaml` 中记录 `skill_refs[].source_path`
- 运行时永远消费 agent-owned copied skill，而不是直接消费 store 目录

这样做的原因：

- agent 行为有稳定快照
- store skill 后续变更不会静默改写已存在 agent 的运行契约
- agent 自己的 copied skill 与技能仓库可以分离演进

### C. prompt 为什么只能做“薄桥接”

再看 `backend/agents/src/agents/lead_agent/prompt.py`：

- `_load_attached_skills_section()` 只告诉模型：
  - 有哪些 attached skills
  - 它们的 runtime 路径是什么
  - 要先读 copied `SKILL.md`
  - skill 若要求读 `references/*`，必须继续读
- 它不直接把 `SKILL.md` 全文塞进系统提示词

这正是这次补的注释要表达的意思：

- prompt 是薄桥接合同
- copied `SKILL.md` 是唯一详细 workflow contract

### D. 为什么看不到 `skills_metadata`

最后对照：

- `backend/deepagents/libs/deepagents/deepagents/graph.py`
  - 只有传 `skills=` 才会挂 `SkillsMiddleware`
- `backend/agents/src/agents/lead_agent/agent.py`
  - OpenAgents 当前构图没有把 attached copied skill 当成 `skills=` 传进去

所以审查时不要再把下面两件事混成一件事：

- “Deep Agents 通用 skills 注入”
- “OpenAgents agent-owned copied skill runtime”

## 当前 clean-code 收口点

本轮只保留与 runtime skill 边界直接相关、且已经能自圆其说的收口：

- `prompt.py`
  - attached copied skill 改为薄桥接，不在 prompt 中内联大段领域细则
  - 明确“Mode B 默认聊天回答，不默认 artifact”
  - 明确“即使生成 artifact，也必须有可见正文”
- `contract-review` skill
  - 把 Mode B 的默认输出与覆盖要求写回 skill 本体，而不是写到外围 prompt/middleware
- 文档
  - 用这份文档固定“对齐 opencode 的范围”和“OpenAgents runtime skill 边界”

## 审查时建议重点看什么

1. `setup_agent(..., skills=[{source_path: "..."}])` 是否真的把 store skill 复制进 agent archive
2. thread runtime 中是否真的存在 `/mnt/user-data/agents/{status}/{agent}/skills/.../SKILL.md`
3. prompt 是否只暴露路径，而没有复述大段 skill checklist
4. trace 中模型是否先读 copied `SKILL.md`，再读 skill 明确要求的 `references/*`
5. 最终输出是否遵循 skill 的模式约束，而不是 middleware/前端在替模型做业务理解

## 审计与测试应看什么

以后验证“skill 真的生效了”，优先看这些信号：

1. agent archive 的 `config.yaml` 是否存在正确的 `skill_refs[].source_path`
2. agent archive 的 `skills/.../SKILL.md` 是否真的 materialize 出来
3. runtime prompt 是否暴露了 `<attached_skills>`
4. trace 中模型是否真的读取了 copied `SKILL.md`
5. 最终执行是否遵循 copied `SKILL.md` 的流程和输出契约
6. 如果 skill 默认要求聊天回答，trace 不应在未被用户要求时先落成可下载文件再结束
7. 即使调用了 `present_files`，最终仍应有非空 assistant 可见答复

不要再把“有没有 `skills_metadata`”当成 OpenAgents skill 生效的必要条件。
