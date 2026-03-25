# Knowledge Base Architecture

Last updated: 2026-03-26

## 1. Scope

当前知识库实现采用 **PageIndex-first** 路线，优先解决长文档树状索引、可追溯引用、共享知识库管理和 Agent 自主检索。

当前已落地能力：

- PDF / Word / Markdown 建库与持久化索引
- 线程内挂载知识库 + 全局共享知识库管理页
- PageTree 树状检索 + 节点详情展开
- 聊天回答内知识库引用，点击后直接预览并跳转对应页
- 全局共享知识库预览、索引 JSON / canonical 原文对照审查
- 构建进度、事件日志、预览权限控制

## 2. Layering

知识库仍然遵守现有 runtime/backend 分层，不把它做成新的 runtime backend。

```text
Frontend (workspace/chat/knowledge)
        |
        v
Go Gateway
  - auth
  - library APIs
  - thread binding APIs
  - shared preview / tree / debug APIs
        |
        v
PostgreSQL  <------>  Filesystem storage under .openagents/knowledge/...
        ^
        |
Python Agents Runtime
  - indexing pipeline
  - PageIndex adapter
  - canonical markdown generation
  - Agent knowledge tools
```

职责边界：

- **Frontend**
  - 知识库管理页、共享库页、调试预览页
  - 聊天引用渲染与点击跳转
  - 构建进度、事件、索引/原文对照
- **Go Gateway**
  - 知识库元数据 CRUD
  - 线程挂载 / 共享可见性 / 预览权限
  - 面向前端的共享文档文件、树、事件、debug API
- **Python Runtime**
  - 文档归一化
  - PageIndex 树构建
  - canonical markdown / source map / node text 落盘
  - Agent 检索工具与提示约束

## 3. Data Model

### PostgreSQL

当前核心表：

- `knowledge_bases`
- `knowledge_documents`
- `knowledge_document_nodes`
- `knowledge_thread_bindings`
- `knowledge_build_jobs`
- `knowledge_build_events`

关键点：

- 大型结构化索引以 **JSON / JSONB** 存在 PostgreSQL 中是可行的
- PageTree、source map、debug payload 走结构化字段或持久化 JSON 文件
- 原文和预览文件仍保留在文件系统，不直接塞进数据库大对象字段

### Filesystem

共享知识库原始资产位于：

```text
.openagents/knowledge/users/{user_id}/bases/{knowledge_base_id}/documents/{document_id}/
  ├── original source
  ├── preview pdf / source preview
  ├── canonical.md
  ├── canonical.map.json
  └── document_index.json
```

运行时给 Agent 暴露的仍然是虚拟路径：

```text
/mnt/user-data/outputs/.knowledge/{document_id}/...
```

这样可以保持现有 runtime path contract，不把宿主机路径泄漏给 Agent。

## 4. Indexing Pipeline

```text
User uploads file / indexes uploaded file
        |
        v
Gateway creates base + documents + build job
        |
        v
Python worker loads source document
        |
        +--> convert to canonical markdown
        +--> build source map
        +--> run PageIndex tree summarization
        +--> persist nodes / summaries / node_text
        +--> export document_index.json snapshot
        |
        v
Gateway / frontend poll build progress and events
```

当前索引产物包含：

- 文档级描述 `doc_description`
- 树节点 `title`
- 树节点摘要 `summary`
- 面向父子层级的 `prefix_summary`
- 节点原始文本 `node_text`
- canonical markdown
- source map
- debug snapshot

## 5. Retrieval Contract

当前 Agent 侧暴露 4 个知识工具：

- `list_knowledge_documents`
- `get_document_tree`
- `get_document_tree_node_detail`
- `get_document_image`

推荐调用顺序：

```text
list_knowledge_documents
    -> get_document_tree
        -> get_document_tree_node_detail
            -> get_document_image (only when a page figure needs vision)
```

设计原则：

- 先看树，不直接看全文
- 树只给标题、摘要、页范围，不直接给原文
- 真正回答前必须通过 `get_document_tree_node_detail` 读取 grounded text
- PDF 多页节点拆成 `page_chunks[]`，优先使用单页 citation
- 图片不单独再用 LLM描述；图像在摘要阶段随多模态上下文进入树构建，原文里保留 markdown 图片占位符

## 6. Citation and Preview Contract

知识引用使用内部链接协议：

```text
kb://citation?artifact_path=...&document_id=...&document_name=...&locator_label=...&node_id=...&page=...
```

前端解析后：

- 聊天区显示 badge 式引用
- 点击引用时打开右侧 artifacts 预览面板
- 直接跳到对应 PDF 页码或 markdown 标题/行号

共享知识库管理页则直接调用：

- `GET /api/knowledge/documents/:document_id/file`
- `GET /api/knowledge/documents/:document_id/tree`
- `GET /api/knowledge/documents/:document_id/build-events`
- `GET /api/knowledge/documents/:document_id/debug`

线程内页面继续走 thread-scoped 知识库 API。

## 7. Shared Library UX

### Global route

```text
/workspace/knowledge
```

用途：

- 按用户文件夹浏览共享知识库
- 查看构建进度和构建事件
- 查看索引 JSON
- 查看 canonical 原文
- 直接预览源文件并定位页面

### Thread route

```text
/workspace/chats/:thread_id/knowledge
/workspace/agents/:agent_name/chats/:thread_id/knowledge
```

用途：

- 管理当前线程可挂载的知识库
- 附加/取消附加知识库
- 审查当前线程知识文档构建情况

## 8. Access Model

当前共享模型：

- 每个用户的知识库都放在各自用户目录下
- 默认允许共享使用
- 预览权限可单独开关 `preview_enabled`

这意味着：

- 别人可以把共享知识库挂到自己的线程里检索
- 但是否允许直接打开源文件/树/debug 预览，可以由 owner 控制

## 9. Current Frontend Entry Points

- 左侧栏固定入口：`Manage library`
- Agent / Chat 线程页下仍保留线程态知识库入口
- 聊天框回答内的知识库引用可直接跳右侧预览

## 10. Validation Checklist

本轮重点验证：

- 聊天引用重复点击时，PDF 预览页码会继续更新
- 共享知识库页可打开并浏览 owner folder 结构
- 共享页可预览 PRML 并在不同节点之间切换页码
- 构建进度、事件、canonical/debug 审查页可打开

## 11. Known Follow-ups

- 继续优化 PageIndex 大文档建树速度与 token 开销
- 更系统地抽出 indexing worker / job runner
- 为管理页增加更细的构建中任务视图和筛选
- 后续如果需要 dense / hybrid retrieval，再在当前 contract 下增加第二种 engine，而不是改动前端引用协议
