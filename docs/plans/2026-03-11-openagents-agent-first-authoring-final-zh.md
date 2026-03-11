# OpenAgents 智能体优先创作方案（中文说明版）

这份文档给你确认产品方案和架构思路。

英文版执行计划仍然保留在：

- `docs/plans/2026-03-11-openagents-agent-first-authoring-final.md`

中文版重点是：

- 把现在真实执行链路讲清楚
- 把目录结构和生命周期讲清楚
- 把“哪些交给大模型自主决策，哪些必须系统强约束”讲清楚

---

## 1. 当前系统的真实工作方式

先明确一个关键点：你现在的系统底子其实已经对了。

### 1.1 真实执行链路

当前运行时大致是：

```text
前端发起对话
  ->
LeadAgent 组装运行时
  ->
把 agent 的 AGENTS.md / config.yaml / skills 拷贝到线程隔离目录
  ->
deepagents 接管 SkillsMiddleware 和文件系统工具
  ->
智能体在线程运行时目录里自主读写、测试、调用工具
```

这意味着：

- 你不需要再人为设计一套很重的“流程编排器”
- 真正要做的是“让运行时草稿如何安全地落盘到 `.openagents`”

### 1.2 deepagents 已经做掉的事情

这部分很重要，因为后面方案必须顺着它来，而不是和它对着干。

- `deepagents` 已经负责：
  - `SkillsMiddleware`
  - 文件系统工具
  - 子智能体相关能力
- OpenAgents 现在只补充：
  - thread data
  - uploads
  - title
  - image
  - artifacts

所以后面不要把复杂能力继续硬塞到提示词里。
应该让：

- agent 自己规划
- skill 自己披露规则
- 系统只提供目录、工具、权限边界

---

## 2. 这次方案的核心结论

一句话总结：

**大模型负责规划，agent 负责执行，系统负责保存边界。**

进一步拆开就是：

- 创建 agent / skill 的过程，尽量完全交给智能体自主完成
- 用户只通过一个输入框和智能体交互
- `/create-*` 这类命令只是快捷入口，不是死板流程
- `/save-*`、`/push-*`、`/promote-*` 才是明确授权
- 持久化统一走 `.openagents`
- 不做通用 `sync_tool`

---

## 3. 最终目录结构

你这轮新增要求里有一条很关键：

**skills 也统一放进 `.openagents`。**

最终建议目录如下：

```text
.openagents/
  agents/
    dev/
      <agent>/
        AGENTS.md
        config.yaml
        skills/
    prod/
      <agent>/
        AGENTS.md
        config.yaml
        skills/

  skills/
    shared/
      <skill>/
        SKILL.md
    store/
      dev/
        <skill>/
          SKILL.md
      prod/
        <skill>/
          SKILL.md

  threads/
    <thread_id>/
      user-data/
        workspace/
        uploads/
        outputs/
        authoring/
          agents/
            <agent>/
          skills/
            <skill>/

  commands/
    common/
      create-agent.md
      create-skill.md
      save-agent-to-store.md
      save-skill-to-store.md
      push-agent-prod.md
      push-skill-prod.md
      promote-skill-shared.md
```

---

## 4. 这几个目录各自干什么

### 4.1 `.openagents/agents/dev`

这里放开发中的智能体定义，是最终可以反复测试、导出、导入的文件版智能体。

### 4.2 `.openagents/agents/prod`

这里放正式发布的智能体。

### 4.3 `.openagents/skills/shared`

这里放真正稳定、基础、公共的共享 skill。

这个目录不能被“新创建 skill”直接污染。

### 4.4 `.openagents/skills/store/dev`

这里放新发现、新创建、待验证的 skill。

它们是“候选能力仓库”，不是基础共享库。

### 4.5 `.openagents/skills/store/prod`

这里放已经通过验证、可以复用的 skill。

它们还不一定进入 `shared`，但已经是成熟可复用的产物。

### 4.6 `.openagents/threads/<thread>/user-data/authoring`

这里是本次方案最关键的新增层。

它的作用是：

- 让智能体在当前线程中自主创建 agent / skill 草稿
- 允许先生成、先测试、先修改
- 只有在用户确认时，才复制到外部 `.openagents`

这就把“自主创作”和“正式持久化”分开了。

---

## 5. 为什么不做通用 sync_tool

你之前提到想做 `sync_tool`，直觉上像是合理的，但实际上不适合这里。

问题主要有这几个：

- 不清楚到底是从运行时同步到外部，还是外部同步回运行时
- 删除语义很危险
- 覆盖语义不清楚
- 容易把运行时垃圾、临时测试文件一起同步出去
- 一旦 agent 自主执行，很难追踪“到底改了什么”

所以这里不应该做“通用同步”。

应该做明确语义的工具：

- `save_agent_to_store`
- `save_skill_to_store`
- `push_agent_prod`
- `push_skill_prod`
- `promote_skill_shared`

也就是：

**不是 sync，而是有意图的保存与发布。**

---

## 6. agent 与 skill 的生命周期拆分

你这次强调得很对：

**skill 创建流程和 agent 创建流程要分开。**

因为现实里会有两类情况：

### 6.1 先有需求，再临时做 skill

例如用户对某个 agent 说：

- “把你现在这套合同风险分析能力封装成一个专属 skill”
- “找一个现成 skill，如果没有就自己创建”

这时候重点是产出 skill，而不是产出 agent。

### 6.2 直接创建 agent

例如：

- “帮我创建个合同审查智能体”

这时候 agent 会：

- 先看已有 skills
- 再看 bootstrap
- 再决定是否需要 `find-skills`
- 再决定是否需要 `skill-creator`
- 再决定是否要联网检索

整个流程本身就是 agent 自主规划，不应该再额外造一个死板 orchestrator。

---

## 7. `config.yaml` 的角色

这一点也按你的要求保留：

- 每个 agent 都有自己的 `config.yaml`
- `config.yaml` 是 agent 的描述文件
- `skill_refs` 决定运行时要复制哪些 skill 到线程目录

建议这里做一个小改造：

不要再只支持旧的 `public/custom` 分类。

建议把 `skill_refs[].source_path` 改成相对 `.openagents/skills` 的通用路径。

例如：

```yaml
skill_refs:
  - name: bootstrap
    source_path: shared/bootstrap
  - name: contract-risk-rating
    source_path: store/prod/contract-risk-rating
```

这样更贴合现在的目录模型。

---

## 8. slash 命令的正确定位

你说得对，整个系统入口本质上仍然应该只有一个输入框。

所以 `/...` 命令不要设计成“第二套系统”。

它真正的定位应该是：

- 给用户一个明确、可控、低心智负担的入口
- 帮助前端做智能提示
- 帮助后端判定“这轮是否允许持久化工具出现”

### 8.1 软命令

这些命令只是快捷入口：

- `/create-agent`
- `/create-skill`
- `/improve-agent`
- `/improve-skill`

它们的作用是：

- 把输入转换成更标准的提示词
- 或者附带结构化命令元数据
- 交给 agent 自己规划

### 8.2 硬命令

这些命令才是授权命令：

- `/save-agent-to-store`
- `/save-skill-to-store`
- `/push-agent-prod`
- `/push-skill-prod`
- `/promote-skill-shared`

它们的作用是：

- 告诉系统：这轮用户明确允许执行某种保存/发布动作
- 系统只在这轮暴露对应工具给 agent

这点非常关键。

---

## 9. 为什么不能把所有 authoring 工具一直暴露给模型

你已经意识到这个问题了，而且判断是对的。

如果工具太多：

- 模型会更难决策
- 误调用概率会升高
- prod 环境风险会变大

所以建议这样做：

### 9.1 prod 模式

完全不注入保存/发布类工具。

### 9.2 dev 模式普通聊天

也不默认注入这些工具。

### 9.3 只有当前一轮用户输入了硬命令

比如 `/save-agent-to-store`，才在这一轮把 `save_agent_to_store` 这个工具注入给 agent。

这样工具负担最小，也最安全。

---

## 10. 真正适合你的完整流程

下面这版流程，基本就是你想要的未来方向。

### 10.1 创建 agent

```text
用户输入：
  /create-agent 我想创建个合同审查智能体

前端：
  识别命令
  加载命令模板
  把标准化后的提示和命令元数据发给 agent

agent：
  读取现有 skills
  发现 bootstrap
  根据 bootstrap 逐步澄清需求
  判断是否需要现成 skill
  判断是否需要 find-skills
  判断是否需要 skill-creator
  判断是否需要联网搜索
  在当前线程 authoring 目录下生成 agent 草稿

生成位置：
  /mnt/user-data/authoring/agents/contract-review/
    AGENTS.md
    config.yaml
    skills/

用户确认后输入：
  /save-agent-to-store

系统：
  暴露 save_agent_to_store 工具
  把 authoring 草稿复制到
  .openagents/agents/dev/contract-review/
```

### 10.2 测试 agent

```text
用户进入统一聊天测试页
  agent_name = contract-review
  agent_status = dev

运行时：
  把 dev agent 复制到线程运行时目录

agent：
  在运行时目录中继续改 AGENTS.md、改 agent 私有 skills、继续测试

用户满意后输入：
  /save-agent-to-store

系统：
  把运行时调优后的版本覆盖保存回
  .openagents/agents/dev/contract-review/
```

### 10.3 发布 agent

```text
用户输入：
  /push-agent-prod

系统：
  暴露 push_agent_prod 工具
  将 .openagents/agents/dev/contract-review/
  复制到 .openagents/agents/prod/contract-review/
```

### 10.4 创建 skill

```text
用户输入：
  /create-skill 做一个合同风险分级 skill

agent：
  先检查是否已有可复用的 skill
  没有就自主调用 skill-creator / find-skills / 联网搜索
  在当前线程 authoring 目录下生成 skill 草稿

生成位置：
  /mnt/user-data/authoring/skills/contract-risk-rating/
    SKILL.md
    scripts/
    references/

用户确认：
  /save-skill-to-store

系统保存到：
  .openagents/skills/store/dev/contract-risk-rating/
```

### 10.5 发布 skill

```text
/push-skill-prod
  ->
.openagents/skills/store/prod/<skill>

/promote-skill-shared
  ->
.openagents/skills/shared/<skill>
```

---

## 11. ASCII 总流程图

### 11.1 agent 流程

```text
用户一句话
  |
  v
/create-agent
  |
  v
agent 自主规划
  |-- 检查已有 skills
  |-- 使用 bootstrap 澄清
  |-- 必要时 find-skills
  |-- 必要时 skill-creator
  |-- 必要时联网搜索
  v
thread authoring 草稿
  /mnt/user-data/authoring/agents/<agent>/
  |
  v
用户确认 /save-agent-to-store
  |
  v
.openagents/agents/dev/<agent>/
  |
  v
统一测试页继续测试
  |
  v
运行时持续优化
  |
  v
再次 /save-agent-to-store
  |
  v
dev agent 更新
  |
  v
/push-agent-prod
  |
  v
.openagents/agents/prod/<agent>/
```

### 11.2 skill 流程

```text
用户一句话
  |
  v
/create-skill
  |
  v
agent 自主规划
  |-- 检查已有 skill
  |-- 必要时 find-skills
  |-- 必要时 skill-creator
  |-- 必要时联网搜索
  v
thread authoring 草稿
  /mnt/user-data/authoring/skills/<skill>/
  |
  v
用户确认 /save-skill-to-store
  |
  v
.openagents/skills/store/dev/<skill>/
  |
  v
/push-skill-prod
  |
  v
.openagents/skills/store/prod/<skill>/
  |
  v
/promote-skill-shared
  |
  v
.openagents/skills/shared/<skill>/
```

---

## 12. 哪些交给模型，哪些必须系统兜底

### 12.1 交给模型的部分

- 是否先澄清问题
- 是否用 bootstrap
- 是否查现有 skill
- 是否走 `find-skills`
- 是否走 `skill-creator`
- 是否联网搜索
- 如何组织 AGENTS.md
- 如何组织 SKILL.md
- 如何设计测试

### 12.2 系统必须强约束的部分

- 持久化目录在哪里
- 哪一轮允许出现 save/push/promote 工具
- prod 环境禁止 authoring/publish 工具
- 保存时做结构校验
- 覆盖时做备份
- 线程运行时与外部持久层分离

也就是说：

**规划自由交给模型，保存边界交给系统。**

---

## 13. 最后定案

这版方案最终定案如下：

- `skills` 统一进入 `.openagents`
- `agent` 与 `skill` 生命周期分离
- `config.yaml` 保留，`skill_refs` 保留
- `skill_refs` 改为引用 `.openagents/skills` 下的通用路径
- 运行时新增 `authoring/` 草稿区
- 不做通用 `sync_tool`
- `/create-*` 是快捷入口
- `/save-*`、`/push-*`、`/promote-*` 是显式授权
- 持久化工具只按当前命令按需注入
- 未来通用 agent 基础架构稳定后，新增能力主要就是改 `AGENTS.md` 或新增 skill

如果你认可这版，下一步就可以直接进入实现。
建议的第一步是：

- 先把 `.openagents` 路径体系和 `skill_refs.source_path` 改正确
- 再补 `authoring/` 目录
- 再做 save/push/promote 工具
- 最后接前端 slash command 提示和按需注入
