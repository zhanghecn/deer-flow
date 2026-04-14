# Deer Flow 对齐 Manus 工作台方案（中文说明版）

这份文档给你确认产品方向、交互拆法和实施顺序。

英文版执行计划保留在：

- `docs/plans/2026-04-12-manus-workspace-alignment.md`

中文版重点是：

- 先把“为什么现在不好用”讲清楚
- 再把“Manus 式体验到底差在哪”讲清楚
- 最后把“要改哪些 UI、哪些能力、哪些边界”拆清楚

---

## 1. 先说结论

你现在的问题，本质上不是“缺一个设计页”。

而是：

- 聊天在一边
- 设计板在另一个新窗口
- 运行空间又在另一个新窗口
- 文件预览还在聊天页右侧

这导致用户脑子里要切 3 套工作区。

Manus 给人的感觉不是“功能更多”，而是：

- 所有动作都围绕同一个任务工作台展开
- 对话、预览、执行状态、编辑对象是持续可见的
- 用户不会反复问“我现在到底在改哪一块、agent 现在到底在干嘛”

所以这次对齐 Manus，核心不是再加一个入口，而是：

**把 Deer Flow 从“聊天页 + 弹窗工具”改成“线程内统一工作台 + 全尺寸新标签”的混合模式。**

---

## 2. 当前 Deer Flow 的真实问题

### 2.1 设计板是“外部页”，不是工作台的一部分

你现在已经把 OpenPencil 接进来了，但它的主入口仍然是：

- 点按钮
- `window.open()`
- 新开一个设计页

这会带来几个问题：

- 对话和设计分离
- 用户选中了哪块区域，聊天侧并不知道
- 设计保存、冲突、脏状态也没有回到主线程 UI

所以它更像“外挂编辑器”，不像任务工作台里的设计面板。

### 2.2 运行空间也是“外部页”，不是任务状态的一部分

运行空间现在也还是点一下开新窗口。

这意味着：

- agent 在跑什么，聊天里不直观
- 用户看运行结果要切页
- 运行空间和当前设计任务没有形成并列关系

而 Manus 的浏览器/运行区之所以顺手，是因为它一直在当前任务上下文里。

### 2.3 右侧现在只有 artifacts，不是完整工作面

你现在聊天页右边其实已经有一个雏形：

- artifacts panel
- 文件预览
- PDF / ONLYOFFICE / markdown 这些能力

这说明你不是没有“右侧工作区”，而是现在这块太窄了，只承载“文件预览”，没有承载：

- 设计
- 运行
- 任务状态
- 当前选中对象

### 2.4 “当前正在编辑哪里”没有结构化表达

这一点很关键。

现在用户如果在设计板里选中了某个区域，再回来对话说一句：

- “把这里改一下”

系统其实没有可靠的结构化上下文来知道“这里”到底是哪。

如果继续靠自然语言猜，会直接违反你仓库现在已经定下来的边界：

- 不要在模型外做语义推断
- 不要靠 regex / heuristics 猜业务意图

所以必须走显式桥接。

---

## 3. 对齐 Manus，真正要学的是什么

不是照抄视觉风格。

真正值得对齐的是这 5 点：

### 3.1 任务工作台是一等公民

不是“聊天是主页面，其他是辅助页面”。

而是：

- 这个 thread 本身就是工作台
- chat、design、runtime、preview 都只是同一工作台的不同面

### 3.2 artifact / preview 持续可见

用户给 agent 下命令时，结果不是藏在别处，而是就摆在旁边。

这会显著减少：

- 来回切页
- 误解 agent 当前上下文
- 反复重复“你看的是哪个页面/文件”

### 3.3 agent 行为要在对话里体现

不是只显示最后一句结果。

而是中间状态也要看得见，比如：

- 正在读取设计稿
- 正在修改选中节点
- 正在打开运行空间
- 设计稿已保存
- 预览已更新

Manus 的“活”感，很大一部分来自这个。

### 3.4 选区必须是显式上下文

用户点了哪个节点、哪几个区域，系统必须明确知道。

不能靠：

- “这里”
- “这个按钮”
- “左边那块”

这种自由文本去猜。

### 3.5 新窗口只是补充，不是主路径

全屏工作、调试、独立查看当然可以保留。

但默认路径必须是：

- 留在 thread 里
- 继续看 chat
- 继续看设计/运行状态

这里的“留在 thread 里”不等于“所有东西都塞进右侧”。

更准确地说应该是：

- thread 页面负责持续显示当前任务上下文
- 重度编辑面放到新标签
- thread 页面里的右侧区负责承接这些外部工作面的状态回流

---

## 4. 先定边界：哪些放右侧，哪些开新标签

这一条需要先拍板，不然 UI 会反复重做。

### 4.1 适合放右侧的内容

右侧应该放“轻量、持续可见、紧贴对话”的内容：

- `Preview`
  - 当前文件的快速预览
  - 文档截图 / 页面快照
  - citation 跳转后的定位预览
- `Files`
  - thread artifacts
  - 输出文件列表
  - 当前目标文件切换
- `Design Context`
  - 当前 target_path
  - 当前选中节点 chips
  - 文档保存/同步状态
  - 小型预览缩略图
  - 打开完整设计器按钮
- `Runtime Context`
  - 当前 URL / 状态
  - 最近截图或轻量 live 缩略视图
  - busy / idle / error 状态
  - 打开完整运行空间按钮

这里还有一个明确取舍：

- `Preview` 和 `Files` 不需要新的工作区参数或新的响应协议
- 直接复用现有 artifacts / outputs 发现逻辑
- 再根据路径和文件后缀判断展示方式

例如：

- `pdf`
- `xlsx`
- `pptx`
- `html`
- `png`
- `md`

这些都可以直接决定右侧如何展示。

一句话说：

**右侧放上下文，不放重度编辑器。**

### 4.2 适合开新标签的内容

凡是需要大空间、密集交互、持续操作的内容，都应该开新标签：

- 完整 OpenPencil 画布编辑
- 完整浏览器 / IDE / 终端运行空间
- 大型文档编辑
- 大尺寸页面预览 / 响应式预览
- 任何需要接近全宽工作区的交互

一句话说：

**新标签放真正干活的主工作面。**

### 4.3 popup 不是主路径

这里我建议明确一下：

- 默认用正常新标签
- popup 只做次级能力

因为 popup 的问题很多：

- 容易被浏览器拦截
- 生命周期难管理
- 分享链接不自然
- 用户容易丢失窗口

所以更好的层次是：

- 主路径：thread 内上下文 + 新标签工作面
- 次路径：popup / detached window

---

## 5. 最终产品形态应该长什么样

建议收敛成一个非常明确的结构：

```text
左侧：导航 / 线程 / agent
中间：聊天主列
右侧：统一工作台 Dock
       - Preview
       - Design Context
       - Runtime Context
       - Files
底部/输入区上方：当前上下文条
       - 当前 surface
       - 当前 target_path
       - 当前 selected nodes
       - 当前 runtime 状态
```

这套结构的关键点是：

- 不要再把 thread 页面当成“纯聊天页”
- 也不要把完整设计器和完整运行空间硬塞右侧
- 右侧负责承接上下文
- 重度编辑放新标签

---

## 6. 这次改造的主目标

### 目标一：右侧承接 Design Context，而不是承接完整设计器

用户点开 thread 后，右侧能看到：

- 当前设计目标文件
- 当前选区
- 当前同步状态
- 当前预览缩略图

真正的 OpenPencil 编辑器默认在新标签打开。

### 目标二：右侧承接 Runtime Context，而不是承接完整运行空间

用户在 thread 内就能看到：

- 当前运行状态
- 当前 URL
- 最近截图/轻量预览

真正的浏览器 / IDE / 终端工作面默认在新标签打开。

### 目标三：把“选中区域”变成聊天可见的结构化上下文

设计板选中后，composer 上方出现 chips，比如：

- 已选 3 个节点
- 目标文件：`canvas.op`
- 当前区域：Hero / CTA / Header

### 目标四：把 agent 的行为状态做成对话中的工作流卡片

聊天区不只显示最终文本，还要显示：

- 正在编辑设计稿
- 已同步设计稿
- 运行空间已打开
- 预览已刷新

### 目标五：保留 popup，但降到最后一层

不是删除 popup。

而是把层次改成：

- 第一层：thread 内上下文
- 第二层：新标签完整工作面
- 第三层：popup / detached window

---

## 7. UI 层具体要怎么改

### 6.1 Header 要改

现在 Header 里的设计板 / 运行空间按钮是 popup-first。

要改成：

- 一个统一的 Workspace/Dock 开关
- 一个当前 surface 状态显示
- 每个 surface 的“新窗口打开”作为次级动作

也就是说：

- 主动作：展开右侧工作台
- 次动作：在新窗口打开当前面板

### 6.2 ChatBox 要改

现在右侧是 artifact panel。

要扩成统一 Dock：

- Preview
- Design
- Runtime
- Files

现有 artifact 逻辑不要丢，直接收编进来。

### 6.3 InputBox 要改

composer 上面要增加一层上下文条，用来显示：

- 当前工作面
- 选中节点
- 目标文件
- 运行状态

并支持：

- 清空选区
- 切换回相关 surface

### 6.4 MessageList 要改

消息列表里要加“工作台事件卡片”，而不是只显示普通 assistant/tool message。

例如：

- Design selection updated
- Saving design document
- Design document saved
- Runtime workspace opened
- Preview switched to updated file

### 6.5 Preview / Files 要重新定位

不是删除 artifacts。

而是重新定义：

- `Preview`：打开当前活跃文件/文档的详情预览
- `Files`：输出文件和 artifacts 列表

这样右侧结构才清晰。

---

## 8. 能力层具体要补什么

### 7.1 需要一个新的 WorkspaceSurfaceContext

现在的 `ArtifactsContext` 太窄了，只适合文件预览。

不能继续把所有状态塞进去。

应该新建一个工作台上下文，统一管理：

- 当前 active surface
- dock 是否打开
- design session
- runtime session
- design selection
- preview target

而 `ArtifactsContext` 只保留文件预览相关职责。

同时要注意：

- 不要为了文件发现再新增一套 workspace manifest
- 文件列表继续来自现有 thread outputs / artifacts
- 只在前端按文件类型分类

### 7.2 需要一个 Design Host Bridge

这是这次最关键的能力补充。

OpenPencil 嵌入 Deer Flow 后，必须把状态显式回传给宿主页面。

至少要有这些事件：

- `design.selection.changed`
- `design.document.loaded`
- `design.document.dirty`
- `design.document.saved`

这样 Deer Flow 才能知道：

- 用户当前选中了什么
- 文档是否已同步
- 当前 revision 是多少

### 7.3 需要一个 Selection Context 提交链路

一旦用户带着选区发消息，前端必须把结构化上下文带进 thread submit。

建议最小字段：

- `surface_context.surface`
- `surface_context.target_path`
- `selection_context.surface`
- `selection_context.target_path`
- `selection_context.selected_node_ids`
- `selection_context.selection_summary`

这条链路必须是显式的。

### 7.4 需要一个 Runtime Surface State

运行空间不能只是打开成功就结束。

宿主页面至少要感知：

- opening
- active
- failed
- idle

这样聊天区和 header 才能正确显示状态。

这里的意思不是要扩展一套“文件列表响应”。

而是：

- 文件仍然靠 outputs 判断
- 只有 runtime 活跃状态这种动态信息，才需要显式状态

---

## 9. OpenPencil 需要承担什么改动

这次不是 Deer Flow 单边改造。

OpenPencil 兄弟仓库也需要配合。

但要控制在“宿主桥接”这个边界内，不去改它的核心编辑逻辑。

建议只补这几件事：

### 8.1 新增 host bridge 模块

专门负责：

- 在 bridge mode 下给 `window.parent` 发消息
- 平时 standalone 模式不启用

### 8.2 监听 canvas selection

从 `canvas-store.selection` 把：

- `selectedIds`
- `activeId`

同步给 Deer Flow。

### 8.3 同步文档生命周期

在 bridge mode 下，把：

- 文档加载
- 脏状态
- 保存成功
- 保存失败

同步给 Deer Flow。

### 8.4 不改变 standalone OpenPencil 的默认体验

这点非常重要。

不要让 Deer Flow 的需求反过来污染 OpenPencil 独立使用场景。

---

## 10. Runtime Space 要做到什么程度

第一版不要贪心。

先做到“看得见、切得快、状态清晰”，而不是一上来就追求“完整远程接管”。

第一阶段建议做到：

- 右侧能打开 Runtime Tab
- 能显示当前 runtime workspace
- 能看见状态
- 能重新加载
- 能新窗口打开

先不要把大量人机共控操作塞进 MVP。

---

## 11. 这次改造里最重要的边界

### 10.1 不做自然语言猜选区

必须坚持。

只能用显式 bridge selection。

### 10.2 不要把 ArtifactsContext 扩成万能总线

要新建 workspace surface context。

### 10.3 不要把 OpenPencil 改成 Deer Flow 私有前端

只补 bridge，不重写结构。

### 10.4 不要为了对齐 Manus 再造一套新的 runtime 架构

已有后端 contract 继续用：

- design-board session
- runtime-workspace session
- `/mnt/user-data/...` 路径
- thread 级 runtime context

改重点应该放在前端编排和结构化上下文接线。

补充一点：

- 不要新增“工作区文件清单”类接口
- 能从输出文件和文件类型判断的，就继续在前端判断
- 只对“无法从文件静态推断”的状态保留显式 contract

---

## 12. 建议分阶段落地

### 第一阶段：先搭工作台壳层

先把右侧统一 Dock 做出来：

- Preview
- Files
- 空的 Design
- 空的 Runtime

让页面结构先稳定。

这一阶段文件侧不要新增后端协议。

直接复用现有：

- artifacts
- outputs
- 文件类型判断

### 第二阶段：嵌入 Design

把 OpenPencil 内嵌进右侧 Design Tab。

这一步先做到：

- 打开
- 加载
- 保存
- reload

### 第三阶段：补 Design Selection Bridge

把选区同步到 Deer Flow，并显示到 composer chips。

### 第四阶段：嵌入 Runtime

把运行空间放入 Runtime Tab。

### 第五阶段：补对话内联事件

把 design/runtime 状态卡片接进消息流。

### 第六阶段：做真实浏览器验证

必须按你仓库要求做：

- `http://localhost:3000`
- `http://127.0.0.1:8083`
- `http://localhost:5173`

都要验证。

---

## 13. 这份方案里你最该先拍板的事

我建议你重点确认下面 5 个取舍：

### 12.1 右侧 Dock 是否作为主入口

也就是：

- 设计板 / 运行空间以后默认都在聊天页右侧
- 新窗口只保留成次级动作

### 12.2 选区是否必须显示成 chips

我的建议是必须显示。

不然用户根本不知道当前消息到底是不是“带着选区”发出去的。

### 12.3 Runtime 第一版是否只做“可见 + 状态”

我的建议是先这样，不要在第一轮就追求复杂接管。

### 12.4 OpenPencil 是否接受 bridge 改动

我的建议是接受，但范围只限：

- selection
- load/save/dirty lifecycle

### 12.5 聊天区是否增加 workspace 事件卡片

我的建议是一定要做。

这部分决定 Deer Flow 最终是否真的有 Manus 那种“在对话中体现”的感觉。

---

## 14. 一句话总结这次方案

这次对齐 Manus，不是“把 OpenPencil 搬进来”就结束。

真正要做的是：

**把 Deer Flow 线程页升级成一个统一任务工作台，让 chat、design、runtime、preview 在同一上下文中持续可见，并让 design selection / runtime status 都走显式结构化链路。**
