# Knowledge Base Architecture

Last updated: 2026-05-30

## 1. Scope

当前知识库实现采用 **Compiled Filesystem-first** 路线：每个知识库在 Knowledge Asset Store 中拥有一个持久化资料包工作区，编译结果以文件为真源，Agent 默认通过 `/mnt/user-data/knowledge/...` 只读挂载使用现有 `glob` / `grep` / `read_file` 工具检索。

PageIndex 仍然保留在 ingest/compile 阶段，用于把 PDF / Word / PPT / Markdown 归一化、生成 canonical Markdown、source-map、图片/表格资产和调试索引。llm_wiki 风格 workspace 文件可以继续作为编译产物和管理页视图存在，但不再是 Agent 默认检索协议。

当前已落地能力：

- PDF / Word / PPT / Markdown 建库与持久化索引
- 线程内挂载知识库 + 全局共享知识库管理页
- 编译资料包文件树、canonical/source Markdown、图片资产、知识图谱管理视图
- Agent 通过现有 `glob` / `grep` / `read_file` 对挂载资料包做精确定位、分页阅读和行号引用
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
  - read-only /mnt/user-data/knowledge route over attached workspaces
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
- Knowledge Asset Store 的 `workspace/**` 文件通过 runtime 只读路由挂载到 `/mnt/user-data/knowledge/{workspace-name}__{workspace-id}/...`。Agent 默认使用普通文件工具检索这些文件；PostgreSQL 中的 PageTree / node text 是 compile/debug 元数据，不是默认问答入口
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

- PageIndex 负责把源文件归一化、生成 canonical Markdown、source-map、节点摘要和 raw source cache
- PDF / Word / PPT 等非文本资料必须先落成可 `grep/read_file` 的 Markdown；图片、表格、页面图等资产以 Markdown 引用和 package asset 文件保留
- llm_wiki-style 文件生成可以作为后台增强和管理页图谱来源继续存在，但不再作为 agent 的默认检索入口
- 大文档不会把完整原文一次性交给模型；agent 必须用 `grep` 命中行号，再用 `read_file(offset, limit)` 分页读取上下文

## 5. Retrieval Contract

当前 Agent 侧默认知识主协议不再暴露知识库专用检索工具。知识库资料包会作为只读文件挂载：

```text
/mnt/user-data/knowledge/{safe-workspace-name}__{workspace-id}/
  purpose.md
  schema.md
  wiki/**
  raw/sources/.cache/**
  assets/**
```

线程挂载知识库清单不再通过 listing tool 暴露，而是由 `KnowledgeContextMiddleware`
直接注入 XML prompt，上下文中会包含：

- attached workspace `workspace_id`
- `name`
- `mount_path`
- `owner_id`
- `description`
- `source_type`
- `document_count`
- `ready_document_count`

典型审计路径：

```text
KnowledgeContextMiddleware injects mount_path values
    -> agent uses normal filesystem tools inside the selected mount_path
        -> narrow candidate files and read bounded source context
```

设计原则：

- 保持 **全局工具注册稳定**，知识库复用 Deep Agents 文件工具，不新增并行的知识检索工具协议
- Agent 默认在 `/mnt/user-data/knowledge/...` 资料包内使用 `glob` / `grep` / `read_file`；不得访问 host 路径、对象存储 key 或实现目录
- `grep` 返回精确行号，`read_file` 负责分页展开，这比黑盒语义搜索更容易审计和纠错
- 图谱实现参考 llm_wiki：`[[wikilink]]` 成边、隐藏 `type=query`、权重由 direct link / source overlap / common neighbors / type affinity 组成
- 图谱和 wiki 页面是管理 UI / 调试视图，不是 agent 默认问答工具
- 不允许 Agent 为了回答 attached knowledge 问题使用 `execute` 去爬实现路径；正常检索只用文件工具
- 旧的 document-level PageTree 工具已经从 agent-facing tool registry 删除，不再作为 opt-in 兼容入口保留
- PageTree 派生数据只允许作为 ingest/debug 元数据存在；面向 agent 的检索必须走只读资料包挂载

### Agent Runtime Guidance

- `KnowledgeContextMiddleware` 只注入线程挂载 workspace 的元数据和 `mount_path`，不再注入长工具流程说明
- prompt 只表达：attached knowledge 是只读文件、位置在 `mount_path`、当前 turn 需要知识库时只使用这些路径
- middleware 不再对 `grep` / `read_file` / `ls` / `execute` 等通用工具做 tool-call 拦截
- middleware 也不再在答案已开始可见输出后做隐藏重试，因为这会在流式 UI 中追加第二段割裂答案
- 是否真正读取挂载资料包，主要通过 trace 审计与前端真实流测试验证，而不是靠 middleware 在工具层强行兜底

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
- 模型在知识库问答里会先走 `/mnt/user-data/knowledge/...` 下的 `glob` / `grep` / `read_file`
- 模型不会为默认问答去爬 KAS 实现路径、host 路径或 `/large_tool_results/...`

## 11. Known Follow-ups

- 继续优化 PageIndex 大文档建树速度与 token 开销
- 更系统地抽出 indexing worker / job runner
- 为管理页增加更细的构建中任务视图和筛选
- 后续如果需要 dense / hybrid retrieval，应作为资料包内的可选索引文件或显式工具重新设计，而不是回退到旧 PageTree 默认链路
