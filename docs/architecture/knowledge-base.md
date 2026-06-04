# Knowledge Base Architecture

Last updated: 2026-06-04

## 1. Scope

当前知识库采用 **Source Filesystem-first** 架构。上传或导入文件后，系统只做确定性的资料准备：

- 保存原始文件、预览文件、完整 canonical Markdown 和相关资产
- 将可检索的完整 Markdown 同步到每个知识库的 source workspace
- 在线程运行时把 source workspace 只读挂载到 `/mnt/user-data/knowledge/.../sources/`

运行时 Agent 不再使用知识库专用检索工具、PageTree、切片索引、LLM 编译页或 llm-wiki 概念页。Agent 需要知识库时，直接使用已有通用文件工具 `glob` / `grep` / `read_file` 在挂载目录内定位原文。

## 2. Hard-Cut Rules

知识库当前唯一 agent-facing 协议是挂载后的 source Markdown 文件：

```text
/mnt/user-data/knowledge/{safe-workspace-name}__{workspace-id}/sources/*.md
```

必须删除或拒绝的旧链路：

- 不生成 `workspace/wiki/**`
- 不生成 `workspace/.llm-wiki/**`
- 不生成 `workspace/raw/sources/.cache/**`
- 不生成 document tree / PageTree / chunk node 作为问答入口
- 不暴露 `get_document_tree` 或其它 document-level KB 检索工具
- 不通过 `extra_context` 传 `knowledge_document_ids`、`knowledge_base_ids` 或文档 mention 作为临时检索协议
- 不为 source workspace 准备过程选择或校验 LLM `model_name`

PDF、Word、PPT 转完整 Markdown 是允许的；这是格式转换和 OCR/解析准备，不是知识编译或语义切片。

## 3. Layering

知识库是应用域能力，不是新的 runtime backend。

```text
Frontend
  - knowledge library UI
  - source preview / canonical preview
  - build events and source graph
        |
        v
Go Gateway
  - metadata CRUD
  - upload and package staging
  - thread binding APIs
  - preview / source workspace / graph APIs
        |
        v
PostgreSQL  <---- metadata ---->  Knowledge Asset Store
        ^
        |
Python worker/runtime
  - source normalization
  - canonical Markdown generation
  - workspace/sources sync
  - read-only /mnt/user-data/knowledge route
```

边界要求：

- PostgreSQL 保存元数据、构建任务和构建事件，不保存二进制大文件
- Knowledge Asset Store 保存源文件、预览文件、canonical Markdown、资产和 `workspace/sources/**`
- Python runtime 只把当前线程已绑定且 ready 的知识库挂载为只读文件系统
- prompt、skill、agent-authored command 只能看到 `/mnt/user-data/...` 虚拟路径，不能看到 host 路径或对象存储 key

## 4. Data Model

当前核心表：

- `knowledge_bases`
- `knowledge_documents`
- `knowledge_thread_bindings`
- `knowledge_build_jobs`
- `knowledge_build_events`

`knowledge_documents` 保存文档状态、文件类型、locator、storage refs、canonical ref、构建质量和错误信息。它不再保存 PageTree 节点数、source map、document index JSON 或 LLM compile model。

`knowledge_build_jobs` 记录 source preparation 的队列、进度和错误；它不再携带 compile `model_name`。

## 5. Asset Layout

逻辑包结构：

```text
.openagents/knowledge/users/{user_id}/bases/{knowledge_base_id}/documents/{document_id}/
  ├── source/
  │   └── original source
  ├── markdown/
  │   └── optional converted companion markdown
  ├── preview/
  │   └── optional preview.pdf
  ├── canonical/
  │   └── canonical.md
  └── assets/
      ├── pages/
      └── extracted/

.openagents/knowledge/users/{user_id}/bases/{knowledge_base_id}/workspace/
  └── sources/
      └── {source-relative-slug}-{document_id_prefix}.md
```

对象存储启用时，`storage_ref` 是 opaque ref，可指向 MinIO/S3。实现层可以 materialize 到本地临时文件，但 runtime prompt 不允许暴露这些实现路径。

## 6. Source Preparation Pipeline

```text
User uploads or indexes files
        |
        v
Gateway stages document package
  - source/
  - markdown/
  - preview/
  - assets/
        |
        v
Gateway creates knowledge_build_jobs
        |
        v
Python worker claims queued job
        |
        v
Build full canonical Markdown
  - Markdown sources are preserved
  - PDF / Office use converted markdown or preview-derived text
  - images/assets stay referenced from canonical markdown
        |
        v
Persist canonical/canonical.md and metadata
        |
        v
Sync workspace/sources/{slug}.md
        |
        v
Remove deprecated workspace wiki/cache artifacts if present
```

这里没有 LLM 编译步骤。构建慢通常应从文件转换、OCR、对象存储 IO、worker 并发和大文件读写排查，而不是从模型选择排查。

## 7. Runtime Retrieval Contract

`KnowledgeContextMiddleware` 只注入已挂载 workspace 的简短 XML 元数据：

- `workspace_id`
- `name`
- `mount_path`
- `owner_id`
- `description`
- `source_type`
- `document_count`
- `ready_document_count`

典型 agent 工具路径：

```text
glob(path=mount_path, pattern="sources/**/*.md")
    -> grep(pattern="关键字", path="{candidate file}")
    -> read_file(path="{candidate file}", offset=line-20, limit=80)
```

要求：

- broad question 先 `glob` 发现候选 source 文件
- exact question 用 `grep` 获取行号，再用 `read_file` 分页展开上下文
- 不通过 shell 爬 `.openagents/knowledge`、MinIO key、host path 或实现目录
- 不需要先调用任何知识库 document tree/listing 工具
- 非知识库问题不应因为线程挂载了知识库就强制读取 `/mnt/user-data/knowledge`

## 8. Management UI

知识库管理 UI 可以提供审查能力，但这些能力不是 agent 默认问答协议：

- 上传/删除知识库
- 按 owner 分组浏览
- 绑定/取消绑定线程知识库
- 查看构建进度和构建事件
- 预览 source / canonical / preview
- 查看 source workspace 文件树
- 从 source Markdown 中真实存在的链接或 frontmatter 派生 graph

Graph 是管理视图，用来帮助人理解 source 文件之间的显式关系；它不生成新的问答知识，也不替代 agent 的 `grep/read_file` 证据链。

## 9. Preview And Citation

聊天中的知识引用继续使用内部链接协议：

```text
kb://citation?artifact_path=...&document_id=...&document_name=...&locator_label=...&page=...&line=...
kb://asset?artifact_path=...&asset_path=...&document_id=...&document_name=...&locator_label=...
```

前端行为：

- PDF 引用打开 preview 并跳页
- Markdown / Office canonical 引用打开 canonical 文本并按 heading 或 line 定位
- 图片资产通过 `kb://asset` 预览
- 预览权限由知识库 owner 控制

## 10. Validation Checklist

知识库改动至少验证：

- 上传后 `workspace/sources/*.md` 存在且内容是完整 canonical Markdown
- 旧 `workspace/wiki/**`、`.llm-wiki/**`、`raw/sources/.cache/**` 会被清理
- Gateway 不再暴露 document tree/debug/index API
- 前端不再显示 Wiki Workspace、Index JSON、document tree/debug payload
- Agent trace 使用 `/mnt/user-data/knowledge/.../sources/**` 下的 `glob` / `grep` / `read_file`
- `grep` 命中行号后，`read_file` 用 bounded offset/limit 读取上下文
- 非知识库 turn 不被错误引导进知识库目录

## 11. Follow-Ups

- 提升 PDF / Office / 图片 OCR 到完整 Markdown 的质量
- 增强 source workspace 的大文件预览和搜索 UI
- 如果未来确实需要 dense / hybrid retrieval，应作为新的显式索引文件或新工具协议重新设计；不要恢复旧 PageTree 或 llm-wiki 编译链路
