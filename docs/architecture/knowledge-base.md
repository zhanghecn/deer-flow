# Knowledge Base Architecture

Last updated: 2026-05-15

## 1. Scope

当前知识库实现采用 **Wiki Workspace-first** 路线：每个知识库在 Knowledge Asset Store 中拥有一个持久化工作区，编译结果以文件为真源，Agent 默认检索生成后的 `wiki/**/*.md`，必要时再读取 bounded 原文证据。

PageIndex 仍然保留在 ingest/compile 阶段，用于把 PDF / Word / Markdown 归一化、切树、生成 citation/source-map，再同步成 llm_wiki 风格工作区文件；它不再是 Agent 默认问答协议。

当前已落地能力：

- PDF / Word / Markdown 建库与持久化索引
- 线程内挂载知识库 + 全局共享知识库管理页
- Wiki Workspace 文件树、wiki 页面、source evidence、知识图谱
- Wiki 搜索 + raw source 行号证据的混合召回；精确查询可返回 `source_path`、`line_start`、`line_end` 后再用 bounded source evidence 展开
- PageTree 树状检索 + unified evidence 展开
- 聊天回答内知识库引用与图片，点击后直接预览并跳转对应页
- 全局共享知识库预览、索引 JSON / canonical 原文对照审查
- 构建进度、事件日志、预览权限控制

相关测试规范：

- 仓库级测试索引：`docs/testing/README.md`
- 知识库测试规范：`docs/testing/knowledge-base/TEST_SPEC.md`
- 常见陷阱：`docs/testing/knowledge-base/PITFALLS.md`

## 2. Layering

知识库仍然遵守现有 runtime/backend 分层，不把它做成新的 runtime backend。

### Hard-Cut Rule

知识库链路在完成架构收敛后，不保留 legacy fallback：

- 不保留 Go 直接拉起 Python subprocess 的旧执行路径
- 不保留数据库 / 配置文件双模型源
- 不保留前端本地缓存旧 `model_name` 的隐式兼容
- 不保留缺失 `model_name` 时回退到线程绑定或任意 enabled model 的行为

要求：

- `model_name` 只代表一个 canonical 模型 ID
- API 边界立即校验 `model_name`
- 旧数据通过迁移清理
- 剩余无效值显式报错，而不是继续 fallback
- 聊天页知识库可用性以 `knowledge_thread_bindings` 为唯一真源
- 不保留聊天前端本地“已选文档”与线程挂载并存的双状态
- 不再通过聊天 `extra_context` 传递 `knowledge_document_ids` / `knowledge_base_ids` 作为临时选择协议

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
  - PageIndex compile adapter
  - canonical markdown generation
  - Wiki Workspace sync
  - Agent workspace knowledge tools
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

- PostgreSQL 保存知识库、文档、线程绑定、构建任务、构建事件等元数据
- Knowledge Asset Store 保存源文件、预览文件、canonical、index/debug JSON，以及 `workspace/**`
- Wiki Workspace 是当前 Agent 检索真源；`search_knowledge_workspace` 会优先检索生成的 `wiki/**/*.md`，并对 `raw/sources/.cache/**` 做 bounded grep-like 精确召回以覆盖长文档后段内容。PostgreSQL 中的 PageTree / node text 是 compile/debug/兼容层，不是默认问答入口
- 大型结构化索引仍可作为 JSON / JSONB 或持久化 JSON 文件保存，但原文和工作区文件不进入数据库大对象字段
- PostgreSQL 还保存知识质量与证据元数据：
  - 文档级 `build_quality`
  - 文档级 `quality_metadata`
  - 节点级 `visual_summary`
  - 节点级 `summary_quality`
  - 节点级 `evidence_refs`
- `excerpt` 已从当前运行主链路移除
- `prefix_summary` 仅作为旧索引兼容回退字段保留，不再作为 agent-facing / frontend-facing 产品协议

### Asset Storage Recommendation

当前实现：

- **PostgreSQL**
  - 保存知识库元数据
  - 保存树结构 / source map / debug JSON
- **Knowledge Asset Store**
  - `KNOWLEDGE_OBJECT_STORE` 必须显式配置
  - 本地调试可显式设为 `filesystem`
  - 可切换 `MinIO / S3-compatible object storage`
  - `storage_ref` 对应用层是 opaque ref，当前兼容：
    - 相对路径 ref，例如 `knowledge/users/.../documents/.../source/file.pdf`
    - 对象存储 ref，例如 `s3://knowledge/users/.../documents/.../source/file.pdf`

硬切规则：

- 不允许缺失 `KNOWLEDGE_OBJECT_STORE` 时静默回退到本地 filesystem
- 生产 / 共享环境必须显式使用 `minio`
- 已有本地 `knowledge/...` `storage_ref` 必须通过迁移脚本搬迁后再切换
- 禁止继续依赖“先落本地盘，之后再看是否要上对象存储”的默认路径

对象存储 key 规范：

- 本地 filesystem 包路径仍位于 `.openagents/knowledge/users/...`
- 新写入的对象存储 key 统一去掉顶层 `knowledge/` 前缀，直接写成 `users/...`

这样可以避免 bucket 已经叫 `knowledge` 时再出现 `s3://knowledge/knowledge/users/...` 这种双重前缀。

推荐后续演进：

- 本地开发可继续显式使用 `filesystem`，便于直接调试
- 共享/生产环境使用 **MinIO / S3-compatible object storage**
- 不建议把 Word / PDF / 图片等二进制文件直接塞进 PostgreSQL

原因：

- PostgreSQL 很适合存 `jsonb`，也支持 `bytea` / large object
- 但知识库文件通常体积大、读取模式偏对象存储、预览链路也更适合走对象文件
- 因此前后一致的方案应是：
  - PostgreSQL 管 metadata / JSON
  - Knowledge Asset Store 管 file assets
    - 本地调试时可显式落 filesystem
    - 共享/生产时落 MinIO

### Knowledge Asset Store

这层是**知识库领域存储层**，不是 runtime backend。

职责：

- 解析 `storage_ref`
- 读写知识库源文件 / preview / canonical / index / assets
- 在 filesystem 与 MinIO 之间切换
- 给 Python ingest 提供本地 materialized path
- 给 Gateway 预览 / debug / asset API 提供统一读取接口

非职责：

- 不管理 sandbox 生命周期
- 不改变 `/mnt/user-data/...` agent-visible runtime contract
- 不承担线程 runtime backend 的 data plane / control plane 角色

### Filesystem

共享知识库原始资产位于：

```text
.openagents/knowledge/users/{user_id}/bases/{knowledge_base_id}/documents/{document_id}/
  ├── source/
  │   └── original source
  ├── markdown/
  │   └── converted companion markdown
  ├── preview/
  │   └── preview.pdf
  ├── canonical/
  │   └── canonical.md
  ├── index/
  │   ├── canonical.map.json
  │   └── document_index.json
  └── assets/
      ├── pages/
      └── extracted/
```

当开启对象存储时，上述文档包目录结构不变，只是文件内容从本地路径切换为 `s3://...` `storage_ref`。

推荐的 MinIO 展开形态：

```text
bucket: knowledge
  users/{user_id}/bases/{knowledge_base_id}/documents/{document_id}/...
```

当前环境开关：

```text
KNOWLEDGE_OBJECT_STORE=filesystem|minio   # required
KNOWLEDGE_S3_ENDPOINT=http://localhost:9000
KNOWLEDGE_S3_ACCESS_KEY=...
KNOWLEDGE_S3_SECRET_KEY=...
KNOWLEDGE_S3_BUCKET=knowledge
KNOWLEDGE_S3_SECURE=false
```

迁移工具：

```text
backend/agents/scripts/migrate_knowledge_storage_refs.py
```

用途：

- 扫描 `knowledge_documents` 中仍然指向本地 filesystem 的 `storage_ref`
- 上传对应 `.openagents/knowledge/users/...` 文档包到对象存储
- 回写数据库中的 `source_storage_path` / `markdown_storage_path` / `preview_storage_path` / `canonical_storage_path` / `source_map_storage_path`
- 刷新对象存储中的 `index/document_index.json`

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
        +--> stage document package under source/markdown/preview
        +--> sync staged package to Knowledge Asset Store
        |
        v
Python worker resolves storage_ref -> local materialized files
        |
        +--> convert to canonical markdown
        +--> build source map
        +--> run PageIndex tree summarization
        +--> persist nodes / summaries / node_text
        +--> persist canonical / index / assets back into Knowledge Asset Store
        +--> run llm_wiki-style analysis -> FILE blocks generation
        +--> merge generated wiki pages without dropping existing source contributors
        +--> rewrite deterministic workspace index / overview / log
        |
        v
Gateway / frontend poll build progress and events
```

当前编译产物包含：

- 文档级描述 `doc_description`
- 树节点 `title`
- 树节点摘要 `summary`
- 树节点视觉摘要 `visual_summary`
- 摘要质量标记 `summary_quality`
- 节点原始文本 `node_text`
- 节点证据引用 `evidence_refs`
- canonical markdown
- source map
- debug snapshot
- Wiki Workspace：
  - `workspace/purpose.md`
  - `workspace/schema.md`
  - `workspace/.llm-wiki/ingest-cache.json`
  - `workspace/.llm-wiki/ingest-queue.json`
  - `workspace/.llm-wiki/image-caption-cache.json`
  - `workspace/wiki/index.md`
  - `workspace/wiki/log.md`
  - `workspace/wiki/overview.md`
  - `workspace/wiki/sources/*.md`
  - `workspace/wiki/entities/*.md`
  - `workspace/wiki/concepts/*.md`
  - `workspace/wiki/comparisons/*.md`
  - `workspace/wiki/synthesis/*.md`
  - `workspace/raw/sources/.cache/*.txt`

编译边界：

- PageIndex 负责把源文件归一化、切树、生成 citation/source-map、节点摘要和 bounded 原文缓存
- llm_wiki-style compiler 在 workspace 写入阶段运行两段式生成：
  - analysis：读取有界 source content、当前 index、purpose、schema，产出结构化分析
  - generation：按 `---FILE: ...---` / `---END FILE---` 生成 wiki page blocks
- OpenAgents 只接受生成到 `wiki/entities/`、`wiki/concepts/`、`wiki/comparisons/`、`wiki/synthesis/` 的 Markdown 页面
- `wiki/index.md`、`wiki/overview.md`、`wiki/log.md` 由平台确定性重写，避免模型生成全局索引时覆盖其他 source
- 同名实体/概念页会合并 frontmatter 的 `sources/tags/related`，并保留既有正文，避免多 source 增量编译时静默丢内容
- source 重新编译时，source-owned 页面直接替换；共享实体/概念页只移除当前 source 的贡献，若没有剩余 source 才删除
- 大文档不会把完整原文无限塞给模型；compiler 使用 head/tail excerpt 加节点摘要构造有界 source content

## 5. Retrieval Contract

当前 Agent 侧默认知识主协议暴露 5 个 workspace 工具：

- `search_knowledge_workspace`
- `get_wiki_page`
- `get_source_evidence`
- `get_knowledge_graph`
- `get_workspace_file_tree`

线程挂载知识库清单不再通过 listing tool 暴露，而是由 `KnowledgeContextMiddleware`
直接注入 XML prompt，上下文中会包含：

- attached workspace `workspace_id`
- `name`
- `owner_id`
- `description`
- `source_type`
- `document_count`
- `ready_document_count`

推荐调用顺序：

```text
KnowledgeContextMiddleware injects <knowledge_attached_workspaces>
    -> choose one ready workspace_id from the XML prompt
        -> search_knowledge_workspace(query=...)
            -> get_wiki_page(workspace_name_or_id=..., page_path=...)
                -> get_source_evidence(workspace_name_or_id=..., query=...) when exact original-source text is needed
```

设计原则：

- 保持 **全局工具注册稳定**，知识库约束主要由 prompt / trace 审计引导完成，不通过动态裁剪模型可见工具列表，也不通过 tool-call 拦截去硬限制通用 agent 能力
- Agent 默认先搜编译后的 `wiki/**/*.md`，不直接扫 `raw/sources/**` 或 mounted implementation paths
- 搜索实现参考 llm_wiki：CJK bigram、filename/title/phrase/token 权重、RRF 风格稳定排序
- 图谱实现参考 llm_wiki：`[[wikilink]]` 成边、隐藏 `type=query`、权重由 direct link / source overlap / common neighbors / type affinity 组成
- `get_wiki_page` 返回完整 wiki page，作为回答前的主要结构化上下文
- `get_source_evidence` 只返回 bounded 原文片段，避免把大文件或 raw cache 直接塞给模型
- `get_workspace_file_tree` 主要用于导航和调试，不是问答首选工具
- 不允许 Agent 为了回答 attached knowledge 问题去 `grep/glob/read_file/ls/find/execute` 爬实现路径；只有用户明确要求 debug storage/indexing 时才允许
- `get_document_tree` / `get_document_evidence` / `get_document_image` / `get_document_tree_node_detail` 仍可作为显式 opt-in 兼容工具，但不在默认 tool catalog 和默认 runtime tool surface 中

### Compatibility Tree Window Semantics

- `get_document_tree` 是显式 opt-in 兼容工具，主要服务旧 agent / 调试 / 迁移审查
- 兼容工具的根调用会做预算控制
- 当根节点按 `max_depth=2` 展开后预计太大时，系统会自动降到更浅的 root overview，而不是把整个根树直接吐给模型
- 响应里会显式返回：
  - `requested_max_depth`
  - `max_depth`
  - `window_mode`
  - `collapsed_root_overview`
- 根 overview 里优先暴露顶层分支的 `node_id`、`child_count`、`has_more_children`、`remaining_child_count`
- Agent 应该选中最相关的 `node_id` 再继续下钻，而不是反复请求整棵根树
- 这个策略的目标是把大文档检索稳定控制在工具预算内，减少 `/large_tool_results/...` spill

### Agent Runtime Guidance

- 知识库主链路保持为 prompt-first guidance：
  - system prompt
  - `KnowledgeContextMiddleware` 的上下文注入
- `KnowledgeContextMiddleware` 会把线程挂载 workspace 直接注入为 XML prompt，避免模型为“先看看有哪些知识库”再额外调用一次工具
- 注入的 KB protocol 明确要求“仅在当前 turn 需要 attached knowledge retrieval 时激活”；thread attachment 本身就是精确范围，显式引用只是可选增强信号而不是必需前提
- middleware 不再对 `grep` / `read_file` / `ls` / `execute` 等通用工具做 tool-call 拦截
- middleware 也不再在答案已开始可见输出后做隐藏重试，因为这会在流式 UI 中追加第二段割裂答案
- 主链路目标是引导模型优先走 `<knowledge_attached_workspaces>` -> `search_knowledge_workspace` -> `get_wiki_page` -> `get_source_evidence`
- 是否真正遵循该链路，主要通过 trace 审计与前端真实流测试验证，而不是靠 middleware 在工具层强行兜底

## 6. Citation and Preview Contract

知识引用使用内部链接协议：

```text
kb://citation?artifact_path=...&document_id=...&document_name=...&locator_label=...&node_id=...&page=...
kb://asset?artifact_path=...&asset_path=...&document_id=...&document_name=...&locator_label=...&node_id=...&page=...
```

前端解析后：

- 聊天区显示 badge 式引用
- `kb://asset` 直接渲染为聊天区或 markdown 预览里的内联图片
- 点击图片或引用时都打开同一个右侧 artifacts 预览目标
- 点击引用时打开右侧 artifacts 预览面板
- PDF 型文档引用预览指向可分页预览文件并跳到对应页码
- heading 型文档引用预览统一指向 `canonical.md`，按 markdown 标题或行号定位，避免 Word 原文件无法稳定跳转

共享知识库管理页则直接调用：

- `GET /api/knowledge/bases/:knowledge_base_id/workspace/tree`
- `GET /api/knowledge/bases/:knowledge_base_id/workspace/file?path=...`
- `GET /api/knowledge/bases/:knowledge_base_id/workspace/graph`
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
- 查看 Wiki Workspace 文件树和知识图谱
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
- 审查当前线程知识库的 source documents、Wiki Workspace、Graph

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
- 共享页可打开 source documents、Wiki Workspace 文件树、知识图谱
- 构建进度、事件、canonical/debug 审查页可打开
- 模型在知识库问答里会先走 `search_knowledge_workspace` / `get_wiki_page`，必要时再走 `get_source_evidence`
- 模型不会为默认问答去爬 `/mnt/user-data/...`、KAS 实现路径或 `/large_tool_results/...`

## 11. Known Follow-ups

- 继续优化 PageIndex 大文档建树速度与 token 开销
- 更系统地抽出 indexing worker / job runner
- 为管理页增加更细的构建中任务视图和筛选
- 后续如果需要 dense / hybrid retrieval，在 Wiki Workspace contract 下增加第二种 engine，而不是回退到旧 PageTree 默认链路
