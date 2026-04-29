# OpenPencil / Manus 对齐总任务计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Deer Flow 完成 OpenPencil 设计板集成，支持通过对话创建或更新带设计 skill 的 agent，支持基于显式选区的设计稿修改，并把设计预览、运行状态、文件预览整合成接近 Manus 的混合式工作台体验。

**Architecture:** 保持现有 Deer Flow runtime / gateway / sandbox 分层不变，继续使用 `/mnt/user-data/...` 作为唯一 agent-visible 路径合同；OpenPencil 作为独立 Web 应用由 Nginx 反向代理到 `/openpencil`；线程页新增右侧轻量工作台承接 `Preview | Files | Design Context | Runtime Context`，重度设计编辑与运行空间默认在新标签页打开，设计选区与保存状态通过显式 bridge 事件回流到线程页面。

**Tech Stack:** React 19, React Router, TanStack Query, LangGraph SDK React hooks, Go Gateway, Python LangGraph runtime, OpenPencil web app, Docker Compose, Nginx, Playwright.

---

## 0. 范围定义

这次要完成的不是“把一个设计页能打开”这么窄，而是把下面 4 件事一起打通：

1. 在 Deer Flow 对话里创建 agent，并且这个 agent 可直接带上或编辑 `openpencil-design` skill。
2. 在线程对话里直接让 agent 创建或修改设计稿文件。
3. 用户能持续看到当前设计稿 / 预览 / 运行状态，而不是来回切多个割裂窗口。
4. 用户在设计器里选中某块区域后，线程对话能显式知道“现在在改哪里”，而不是靠自然语言猜。

## 1. 当前状态结论

### 已有基础，但不能算真正完成

- 已接入设计板打开链路：
  - `frontend/app/src/core/design-board/api.ts`
  - `frontend/app/src/core/design-board/hooks.ts`
  - `backend/gateway/internal/handler/design_board.go`
  - `backend/gateway/internal/service/design_board_service.go`
- 已有 canonical 设计文件合同：
  - `/mnt/user-data/authoring/designs/main/canvas.op`
- 已补上 `openpencil-design` copied skill 到 `lead_agent`：
  - `.openagents/system/agents/dev/lead_agent/skills/openpencil-design/SKILL.md`
  - `.openagents/system/agents/prod/lead_agent/skills/openpencil-design/SKILL.md`
- 已补一层 `setup_agent` skill 保留逻辑，避免更新 agent 时把 thread-local 编辑过的 skill 静默冲掉：
  - `backend/agents/src/tools/builtins/setup_agent_tool.py`
  - `backend/agents/src/config/agent_skill_preservation.py`
- 已对 `kimi-k2.5` 加了临时止血：
  - `backend/agents/src/models/factory.py`
  - 工具调用场景默认 `disable_streaming="tool_calling"`

### 仍未完成的关键能力

- 线程页还没有真正的 Manus 式工作台。
- 设计选区还没有显式 bridge 回 Deer Flow。
- 用户还不能在聊天输入框里清楚看到“当前正在改哪个设计区域”。
- 运行空间还没有变成线程上下文的一部分。
- 还没有完成基于 prod compose 的真实链路验收。
- `kimi-k2.5` 工具调用异常目前只是临时规避，不是根因修复。

## 2. P0：必须完成后，才算满足原始需求

### Task 1: 收敛并验收 Docker / Nginx / OpenPencil 代理链路

**Files:**
- Modify: `docker/docker-compose-prod.yaml`
- Modify: `docker/nginx/nginx.prod.conf`
- Modify: `docker/README.md`
- Modify: `docs/guides/docker-compose-prod-selfhost-zh.md`

**Current State:**
- `openpencil` 服务已加入 compose，`/openpencil/*` 反代规则也已存在。
- 用户已明确指出之前出现过“为了绕过问题强行加 proxy shim”的风险，因此这里必须重新收口为仓库认可的单一路径。

**Work:**
1. 核对 compose 中是否还残留临时模型代理、host-network 旁路、只为救火加入的特殊说明。
2. 确认 `openpencil`、`gateway`、`nginx`、`langgraph` 都走同一个 `openagents` bridge 网络。
3. 确认浏览器访问链路固定为：
   - `http://127.0.0.1:8083/openpencil/...`
   - `http://127.0.0.1:8083/api/design/...`
4. 文档只保留一种正式部署建议：
   - 外部模型网关接入同一个 Docker bridge 网络
   - 不再在 compose 里内置宿主机端口代理补丁

**Acceptance:**
- `docker compose -f docker/docker-compose-prod.yaml config` 结果清晰可解释。
- `http://127.0.0.1:8083/openpencil/editor` 可打开。
- 线程内点击设计板时，最终打开的 URL 和代理路径一致。
- 不再依赖临时 host-network proxy 服务。

**Tests:**
- `docker compose --env-file ../.env -p openagents-prod -f docker/docker-compose-prod.yaml up -d --build`
- `curl -I http://127.0.0.1:8083/openpencil/editor`
- `curl -I http://127.0.0.1:8083/health`

### Task 2: 验收“通过对话创建 agent + 挂载 openpencil-design skill”链路

**Files:**
- Modify: `.openagents/commands/common/create-agent.md`
- Modify: `.openagents/system/agents/dev/lead_agent/config.yaml`
- Modify: `.openagents/system/agents/prod/lead_agent/config.yaml`
- Modify: `backend/agents/src/tools/builtins/setup_agent_tool.py`
- Modify: `backend/agents/src/config/agent_skill_preservation.py`
- Test: `backend/agents/tests/test_commands_config.py`
- Test: `backend/agents/tests/test_lead_agent_backend.py`
- Test: `backend/agents/tests/test_lead_agent_prompt.py`

**Current State:**
- `lead_agent` 已经有 copied `openpencil-design` skill。
- `/create-agent` 路由与 `setup_agent` 保留 skill 的基础能力已改过，但还没有把“真实用户在对话里创建设计 agent”这条路径验透。

**Work:**
1. 确认 `create-agent` 工作流在需要复用设计 skill 时，会显式带上正确 `source_path`。
2. 确认 brand-new agent、更新已有 agent、编辑 thread-local copied skill 这三种情况都不会丢 skill。
3. 确认 agent 的 `AGENTS.md` 仍保持精简，不把 skill 工作流再复制一份。
4. 跑一轮真实对话创建 agent，检查：
   - agent 是否创建成功
   - copied skill 是否 materialize
   - 新 agent 切换后是否能读到 `SKILL.md`

**Acceptance:**
- 用户通过对话创建的新 agent，能稳定附带 `openpencil-design`。
- 更新 agent 时不会把已编辑的 thread-local copied skill 意外覆盖掉。
- trace 中能看到模型读取 copied `SKILL.md`。

**Tests:**
- `uv run pytest tests/test_commands_config.py tests/test_lead_agent_backend.py tests/test_lead_agent_prompt.py`
- 浏览器实测一次 `/create-agent` 流程

### Task 3: 完成设计板后端合同收尾并做真实链路验收

**Files:**
- Modify: `backend/gateway/internal/handler/design_board.go`
- Modify: `backend/gateway/internal/service/design_board_service.go`
- Modify: `backend/gateway/internal/handler/design_board_test.go`
- Modify: `frontend/app/src/core/design-board/api.ts`
- Modify: `frontend/app/src/core/design-board/hooks.ts`

**Current State:**
- 已有 `open -> read -> write` 基础 API。
- 已有 canonical `.op` 文件路径和 revision 冲突控制。
- 还缺 prod/UI 级别的真实验收。

**Work:**
1. 固化 `design-board/open` 的线程级语义：
   - 只接受 thread 级 target
   - 只允许 `/mnt/user-data/authoring/designs/...`
2. 确认 `read` / `write` 的 revision 语义在 UI 中可被消费。
3. 明确是否需要补充错误态：
   - token 失效
   - target_path 非法
   - revision conflict
4. 做一次真实设计文档 round-trip：
   - 打开设计板
   - 读取默认 `canvas.op`
   - 保存修改
   - 再次读取确认内容与 revision 更新

**Acceptance:**
- 默认打开线程设计板时，一定对应到 `canvas.op`。
- 非法 target_path 被拒绝。
- 并发冲突会返回可识别错误。
- UI 层能拿到 `target_path` 和 `relative_url`。

**Tests:**
- `go test ./internal/handler -run TestDesignBoard`
- 浏览器手动执行一次读写 round-trip

### Task 4: 给 OpenPencil 补 Host Bridge，让选区和保存状态回流 Deer Flow

**Files:**
- Modify: `/root/project/ai/openpencil/apps/web/src/utils/design-bridge.ts`
- Create: `/root/project/ai/openpencil/apps/web/src/utils/host-bridge.ts`
- Modify: `/root/project/ai/openpencil/apps/web/src/stores/canvas-store.ts`
- Modify: `/root/project/ai/openpencil/apps/web/src/components/editor/editor-layout.tsx`
- Modify: `/root/project/ai/openpencil/apps/web/src/hooks/use-design-bridge-document.ts`

**Current State:**
- OpenPencil 已有文档读写 bridge。
- 还没有把“当前选中了什么”“文档是否 dirty”“保存是否成功”回传 Deer Flow。

**Work:**
1. 新增结构化 host 消息：
   - `design.document.loaded`
   - `design.document.saved`
   - `design.document.dirty`
   - `design.selection.changed`
2. 在 `canvas-store` 里订阅选区状态并事件化发送。
3. 仅在 bridge 模式开启时启用，不影响独立 OpenPencil。
4. 如果保存失败，把错误态显式抛回宿主页面。

**Acceptance:**
- 在 OpenPencil 里选中节点后，宿主 Deer Flow 页面能收到明确 node ids。
- 文档 dirty / saved 状态会实时同步。
- 独立运行 OpenPencil 时不受影响。

**Tests:**
- OpenPencil 本地前端测试
- 宿主页 `postMessage` 联调

### Task 5: 在线程页补一套真正的混合式工作台 Dock

**Files:**
- Create: `frontend/app/src/core/workspace-surface/types.ts`
- Create: `frontend/app/src/core/workspace-surface/context.tsx`
- Create: `frontend/app/src/core/workspace-surface/storage.ts`
- Create: `frontend/app/src/components/workspace/surfaces/workspace-surface-dock.tsx`
- Create: `frontend/app/src/components/workspace/surfaces/workspace-surface-tabs.tsx`
- Create: `frontend/app/src/components/workspace/surfaces/workspace-surface-empty.tsx`
- Modify: `frontend/app/src/components/workspace/chats/chat-box.tsx`
- Modify: `frontend/app/src/components/workspace/workspace-header.tsx`
- Modify: `frontend/app/src/app/workspace/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/app/workspace/chats/[thread_id]/layout.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/layout.tsx`

**Current State:**
- 右侧目前主要还是 artifact/file preview。
- 设计板和运行空间仍是 popup/new window 主导，不是线程工作台的一部分。

**Work:**
1. 把右侧统一成 `Preview | Files | Design | Runtime` 四个 tab。
2. `Preview` 和 `Files` 继续复用现有 artifacts / outputs 发现逻辑。
3. `Design` tab 只放轻量上下文：
   - 当前 `target_path`
   - 当前选区 chips
   - dirty / saved / conflict 状态
   - 打开完整设计器按钮
4. `Runtime` tab 只放轻量上下文：
   - 当前运行状态
   - 最新 URL / snapshot
   - 打开完整运行空间按钮
5. 大型编辑器默认在新标签页打开，不强塞右侧。

**Acceptance:**
- 线程页右侧成为统一工作台，而不是单一 artifacts 面板。
- 不新增 workspace manifest API。
- 文件和预览仍按 path + extension 自动分类。

**Tests:**
- `frontend/app/src/components/workspace/chats/chat-box.test.tsx`
- 手动验证 dock 切换和空状态

### Task 6: 把设计选区变成输入框上方的显式上下文，而不是隐式状态

**Files:**
- Create: `frontend/app/src/components/workspace/surfaces/design-selection-chips.tsx`
- Modify: `frontend/app/src/components/workspace/input-box.tsx`
- Modify: `frontend/app/src/components/workspace/chats/new-chat-sender.tsx`
- Modify: `frontend/app/src/components/workspace/messages/context.ts`
- Modify: `frontend/app/src/core/threads/hooks.ts`
- Modify: `frontend/app/src/core/threads/types.ts`

**Current State:**
- 现在用户在设计器里选中区域后，线程对话还不能显式展示“当前选的是哪里”。
- 继续靠自然语言“这里”“这个按钮”会违反 runtime semantic boundary。

**Work:**
1. 在 composer 上方显示选区 chips：
   - 目标文件
   - 选中节点数量
   - 1 到 3 个节点短标签
2. 提交消息时，把显式 `selection_context` / `surface_context` 注入 `extraContext`。
3. 保证这套结构化字段与 slash command 共存，不互相覆盖。
4. 增加快速清除选区动作。

**Acceptance:**
- 用户选中设计区域后，不需要靠自然语言猜上下文。
- agent 端能从显式结构化字段知道当前编辑目标。
- 中间件不做任何文本语义推断。

**Tests:**
- `backend/agents/tests/test_tool_runtime_context.py`
- 前端组件测试覆盖 chips 显示与清除

### Task 7: 把运行空间也拉回线程工作台

**Files:**
- Create: `frontend/app/src/components/workspace/surfaces/runtime-surface-panel.tsx`
- Create: `frontend/app/src/core/runtime-workspaces/state.ts`
- Modify: `frontend/app/src/core/runtime-workspaces/api.ts`
- Modify: `frontend/app/src/core/runtime-workspaces/hooks.ts`
- Modify: `frontend/app/src/components/workspace/workspace-header.tsx`

**Current State:**
- 运行空间现在仍然主要是“点按钮开外部页”。
- 线程里没有稳定展示运行状态的地方。

**Work:**
1. 增加 `Runtime Context` panel。
2. 明确显示 runtime session 状态：
   - idle
   - opening
   - active
   - failed
3. 保留“在新标签打开完整运行空间”作为重操作入口。
4. 对 remote backend 保持边界清晰：
   - 当前不支持 embed 的只做外部打开，不假装已经可嵌入

**Acceptance:**
- 用户在聊天页能知道 agent 当前是否打开了运行空间。
- 运行空间不再只是一个脱离线程的外部窗口。

**Tests:**
- 前端状态测试
- 浏览器实测运行空间打开、状态显示、再次打开

## 3. P1：对齐 Manus 体验的重要增强

### Task 8: 在线程消息流里补 Workspace Event Card

**Files:**
- Create: `frontend/app/src/components/workspace/messages/workspace-event-card.tsx`
- Modify: `frontend/app/src/components/workspace/messages/message-list.tsx`
- Modify: `frontend/app/src/components/workspace/messages/message-list-item.tsx`
- Modify: `frontend/app/src/components/workspace/messages/message-group.tsx`
- Modify: `backend/agents/src/observability/callbacks.py`
- Modify: `backend/agents/src/client.py`

**Current State:**
- 用户几乎只能看到最终回答或原始工具轨迹。
- Manus 式“我知道 agent 正在做什么”的中间态还没有产品化。

**Work:**
1. 定义少量显式 workspace 事件：
   - design selection updated
   - design saved
   - runtime opened
   - preview updated
2. 在线程里显示短卡片，而不是低层日志。
3. 事件来源只能是显式 bridge / tool payload，不能解析 assistant prose。

**Acceptance:**
- 用户在对话流里能感知任务状态推进。
- 消息卡片不依赖 regex 猜动作语义。

**Tests:**
- 前端 message list 测试
- 后端事件序列测试

### Task 9: 重构文件 / 预览面，使其成为工作台子域而不是全局 owner

**Files:**
- Modify: `frontend/app/src/components/workspace/artifacts/context.tsx`
- Modify: `frontend/app/src/components/workspace/artifacts/artifact-file-detail.tsx`
- Modify: `frontend/app/src/components/workspace/artifacts/artifact-file-list.tsx`
- Modify: `frontend/app/src/components/workspace/artifacts/artifact-trigger.tsx`
- Modify: `frontend/app/src/components/workspace/citations/citation-link.tsx`

**Current State:**
- `ArtifactsContext` 当前作用域太大，但又不够支撑完整 workspace。

**Work:**
1. 把 `ArtifactsContext` 降级为文件预览 owner。
2. 所有跨 surface 状态迁移到 `workspace-surface` provider。
3. citation / reveal 动作能切换到正确 tab：
   - rich preview -> `Preview`
   - 文件列表定位 -> `Files`

**Acceptance:**
- 现有 PDF / markdown / ONLYOFFICE 预览不回退。
- 右侧工作台状态和文件预览状态职责清晰。

**Tests:**
- `frontend/app/src/components/workspace/artifacts/context.test.tsx`
- 文档预览回归测试

## 4. P2：稳定性和根因收尾

### Task 10: 继续追 `kimi-k2.5` 工具调用参数损坏根因

**Files:**
- Modify: `backend/agents/src/models/factory.py`
- Modify: `backend/agents/tests/test_model_factory.py`
- Create or Modify: `backend/agents/tests/` 下的 provider-streaming reproduction tests

**Current State:**
- 当前只是在 Kimi 的 Anthropic-compatible 工具调用场景下默认关闭 tool streaming。
- 这能止血，但不能证明根因是 provider、本地拼接、还是特定上下文污染。

**Work:**
1. 抓一轮原始 provider SSE / delta 事件。
2. 隔离复现最小 case：
   - 长 JSON
   - tool args streaming
   - Anthropic-compatible Kimi
3. 判断后续是否可以缩小规避面，或者恢复 streaming。

**Acceptance:**
- 能明确证明 malformed args 是在哪一层被引入。
- 决定 `disable_streaming="tool_calling"` 是长期保留还是移除。

**Tests:**
- `uv run pytest tests/test_model_factory.py`
- provider 级复现实验记录

## 5. 验收与测试总表

### 当前明确还没有完成的测试

- 没有完成一次“用户对话创建设计 agent”真实 UI 验收。
- 没有完成一次“线程打开设计板 -> 选中节点 -> 回到聊天修改 -> 保存 -> 再预览”真实链路验收。
- 没有完成一次“线程页右侧 Dock + Design Context + Runtime Context”真实浏览器验收。
- 没有完成一次基于 `docker/docker-compose-prod.yaml` 的当前代码栈回归验收。
- 没有完成 `kimi-k2.5` 工具参数损坏的 provider 级根因定位。

### 必跑测试矩阵

**Backend / Gateway:**
- `go test ./internal/handler -run TestDesignBoard`

**Agents / Python:**
- `cd backend/agents && uv run pytest tests/test_commands_config.py tests/test_lead_agent_backend.py tests/test_lead_agent_prompt.py tests/test_model_factory.py tests/test_tool_runtime_context.py`

**Frontend Component:**
- `chat-box` / `artifacts context` / `workspace surface` / `selection chips` 相关组件测试

**Browser / Real Stack:**
1. Headed 浏览器流量验证：`http://localhost:3000`
2. 当前代码用户前台验证：`http://127.0.0.1:8083`
3. 管理台 / 内审验证：`http://127.0.0.1:8081`

### 关键手工验收场景

1. 在线程中打开设计板，确认打开的是 `canvas.op`。
2. 在 OpenPencil 里选中一个节点，线程输入框上方出现 selection chips。
3. 在聊天里说“把这个 hero 改成深色版本”，agent 拿到结构化选区上下文。
4. 设计保存后，线程页 `Design Context` 显示已同步状态。
5. 切到 `Preview` / `Files` 还能正常查看产物。
6. 打开运行空间，新标签页与线程内 `Runtime Context` 同步。
7. 使用 `kimi-k2.5` 完成一次真实设计修改任务，不再出现损坏的 `read_file` 参数。

## 6. 推荐执行顺序

1. 先完成 Task 1，收敛部署和代理路径。
2. 再完成 Task 2 和 Task 3，确保 agent 创建与设计板后端链路可靠。
3. 再完成 Task 4 到 Task 7，把工作台主链路做通。
4. 最后做 Task 8 到 Task 10，补产品完成度与稳定性根因。

## 7. 完成定义

只有当下面条件同时满足，才算这次需求真正完成：

- 用户能通过 Deer Flow 对话创建带 `openpencil-design` skill 的 agent。
- 该 agent 能直接对 `/mnt/user-data/authoring/designs/main/canvas.op` 创建或修改设计稿。
- 线程页右侧能持续看到 `Preview | Files | Design Context | Runtime Context`。
- OpenPencil 选区会显式回流到聊天输入区，不依赖自然语言猜测。
- 完整设计编辑和运行空间默认走新标签页，而不是强塞窄侧栏或依赖 popup。
- `docker/docker-compose-prod.yaml` 跑出的当前代码栈完成真实浏览器验收。
- `kimi-k2.5` 至少稳定可用；若仍保留 streaming workaround，必须有明确记录说明原因和范围。
