# llm-wiki 源码流转与编译产物说明

> Current OpenAgents note: this document analyzes llm-wiki internals and an
> earlier Wiki Workspace-first integration. As of 2026-05-30, the canonical
> OpenAgents agent retrieval contract is filesystem-first:
> `/mnt/user-data/knowledge/...` + `glob` / `grep` / `read_file`. Use
> [knowledge-base.md](/root/project/ai/deer-flow/docs/architecture/knowledge-base.md)
> for the current product/runtime contract.

本文按本地源码 `/root/project/ai/llm_wiki` 重写，目标不是介绍概念，而是回答一个具体问题：
**用户把文件放进知识库以后，代码经过哪些路径，最终落下哪些文件，这些文件大概长什么样。**

对 OpenAgents 当前知识库重构来说，最重要的结论是：llm-wiki 的核心不是“查询时多塞原文”，而是**上传后先把很多原始资料编译成一个可读、可链接、可检索的 Wiki Workspace**。后续搜索、图谱、聊天都围绕 `wiki/**/*.md` 工作，原文和缓存只作为证据、预览和补召回使用。

## 1. 整体链路

llm-wiki 是 Tauri 桌面应用，所以它的“上传”在源码里其实是：用户从本机选文件，应用复制到当前项目目录的 `raw/sources/`。OpenAgents 是服务端平台，不能照搬桌面文件选择，但可以对齐后半段：**源文件入库、后台编译、生成 workspace 文件、搜索和图谱读取 workspace**。

```text
用户选择文件 / 文件夹
        |
        v
src/components/sources/sources-view.tsx
  handleImport / handleImportFolder
        |
        v
src/lib/source-lifecycle.ts
  importSourceFiles / importSourceFolder
  - copy 到 raw/sources/
  - preprocessFile 预提取文本缓存
  - enqueueSourceIngest 入队
        |
        v
src/lib/ingest-queue.ts
  enqueueBatch -> .llm-wiki/ingest-queue.json
  processNext 串行调度
        |
        v
src/lib/ingest.ts
  autoIngest
  - 读 source/schema/purpose/index/overview
  - 检查 .llm-wiki/ingest-cache.json
  - 提取图片并可选 caption
  - LLM Step 1 分析
  - LLM Step 2 生成 FILE/REVIEW blocks
  - parseFileBlocks + writeFileBlocks 落盘
  - 保存 cache / embedding / review
        |
        v
Wiki Workspace
  wiki/sources/*.md
  wiki/entities/*.md
  wiki/concepts/*.md
  wiki/index.md
  wiki/log.md
  wiki/overview.md
  wiki/media/**
  .llm-wiki/** runtime cache
        |
        +--> src/lib/search.ts               搜索 wiki 页面，可选向量召回
        +--> src/lib/wiki-graph.ts           从 wikilink/frontmatter 构图
        +--> components/chat/chat-panel.tsx  组装问答上下文
```

目录语义：

```text
raw/sources/          # 用户原始资料层。llm-wiki 尽量保持原文件原样。
raw/sources/.cache/   # PDF/Office 等重文件的预提取文本缓存。
wiki/                 # 编译后的知识真源。搜索、图谱、聊天默认读这里。
wiki/media/           # 从 PDF/DOCX/PPTX 提取出的图片资产。
.llm-wiki/            # 队列、hash cache、caption cache、聊天、向量库等运行状态。
schema.md             # 告诉 LLM 页面类型、命名、frontmatter 和链接规则。
purpose.md            # 告诉 LLM 当前知识库目标、问题、范围和工作假设。
```

## 2. 项目初始化

源码锚点：

- `/root/project/ai/llm_wiki/src-tauri/src/commands/project.rs`
- `create_project(...)`
- `open_project(...)`

新建项目时，Rust 侧创建固定目录和基础文件：

```text
My Wiki Project/
  raw/
    sources/
    assets/
  wiki/
    entities/
    concepts/
    sources/
    queries/
    comparisons/
    synthesis/
    index.md
    log.md
    overview.md
  schema.md
  purpose.md
  .obsidian/
```

模拟初始 `wiki/index.md`：

```markdown
# Wiki Index

## Entities

## Concepts

## Sources

## Queries

## Comparisons

## Synthesis
```

模拟初始 `purpose.md`：

```markdown
# Project Purpose

## Goal

<!-- What are you trying to understand or build? -->

## Key Questions

1.
2.
3.
```

OpenAgents 对齐建议：

```text
OpenAgents 不需要创建 Tauri 项目目录，但每个 knowledge_base 应该有同构 workspace：

.openagents/knowledge/users/{owner_id}/bases/{base_id}/workspace/
  raw/sources/ 或 sources/
  wiki/sources/
  wiki/entities/
  wiki/concepts/
  wiki/index.md
  wiki/log.md
  wiki/overview.md
  schema.md
  purpose.md
  .llm-wiki/ 或 metadata/
```

生产环境可以把这些文件存在 MinIO，但逻辑上仍应把它当成一个文件 workspace，而不是把每个 Markdown 页面拆成数据库正文。

## 3. 上传入口：SourcesView

源码锚点：

- `/root/project/ai/llm_wiki/src/components/sources/sources-view.tsx`
- `handleImport()`
- `handleImportFolder()`
- `handleIngest()`

UI 行为：

1. 用户点击 Import。
2. Tauri `open(...)` 打开系统文件选择器。
3. 单文件/多文件走 `importSourceFiles(project, paths, llmConfig)`。
4. 文件夹走 `importSourceFolder(project, selectedFolder, llmConfig)`。
5. 手动重新编译某个 source 时走 `enqueueSourceIngest(project, [node.path], llmConfig)`，不再走旧的交互式 chat ingest。

伪代码：

```ts
async function handleImport() {
  const selected = await open({ multiple: true })
  const paths = Array.isArray(selected) ? selected : [selected]
  await importSourceFiles(project, paths, llmConfig)
  await loadSources()
}

async function handleImportFolder() {
  const selectedFolder = await open({ directory: true })
  await importSourceFolder(project, selectedFolder, llmConfig)
  await loadSources()
}
```

模拟用户选择：

```text
/Users/me/Desktop/合同库/租赁合同A.pdf
/Users/me/Desktop/合同库/补充协议A.docx
/Users/me/Desktop/合同库/判例摘录.md
```

进入下一层前，UI 还没有“理解”文件内容。它只负责选择文件、调用生命周期函数、刷新 `raw/sources/` 树。

## 4. 文件复制与预处理

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/source-lifecycle.ts`
- `INGESTABLE_SOURCE_EXTENSIONS`
- `importSourceFiles(...)`
- `importSourceFolder(...)`
- `enqueueSourceIngest(...)`
- `folderContextForSourcePath(...)`

### 4.1 文件会复制到哪里

`importSourceFiles(...)` 对每个文件做：

```text
原路径: /Users/me/Desktop/合同库/租赁合同A.pdf
目标路径: <project>/raw/sources/租赁合同A.pdf
```

如果文件名冲突，`getUniqueDestPath(...)` 会生成不冲突路径：

```text
raw/sources/租赁合同A.pdf
raw/sources/租赁合同A 1.pdf
raw/sources/租赁合同A 2.pdf
```

文件夹导入会保留目录上下文：

```text
用户选择: /Users/me/Desktop/合同库
复制到: <project>/raw/sources/合同库/

raw/sources/合同库/租赁合同A.pdf
raw/sources/合同库/补充协议A.docx
raw/sources/合同库/判例摘录.md
```

### 4.2 哪些扩展名会进入编译队列

`INGESTABLE_SOURCE_EXTENSIONS` 包含：

```text
md, mdx, txt, pdf, docx, pptx, xlsx, xls, csv, json,
html, htm, rtf, xml, yaml, yml
```

图片、音视频可以在 UI 中选择和复制，但不属于这条文本 ingest 主链路。图片主要通过 PDF/DOCX/PPTX 内嵌图片提取进入 `wiki/media/`。

### 4.3 预处理缓存是什么

复制成功后调用：

```ts
preprocessFile(destPath).catch(() => {})
```

前端封装：

- `/root/project/ai/llm_wiki/src/commands/fs.ts`
- `preprocessFile(path)`

Rust 实现：

- `/root/project/ai/llm_wiki/src-tauri/src/commands/fs.rs`
- `preprocess_file(...)`
- `cache_path_for(...)`
- `write_cache(...)`

PDF / Office 文件会提前提取文本，并写入同目录 `.cache`：

```text
raw/sources/租赁合同A.pdf
raw/sources/.cache/租赁合同A.pdf.txt
```

模拟 `.cache/租赁合同A.pdf.txt`：

```markdown
# Page 1

房屋租赁合同

甲方：成都星河置业有限公司
乙方：李某
租赁期限：2024年1月1日至2026年12月31日
租金：每月人民币 12000 元

# Page 2

第七条 违约责任
乙方逾期支付租金超过十五日的，甲方有权解除合同...
```

这个缓存有两个作用：

- 后续 `read_file(...)` 读 PDF 时优先用缓存，避免重复跑 pdfium / Office parser。
- 让搜索/预览等读取重文件时不把 UI 卡死太久。

但注意：这只是“原文提取缓存”，不是最终知识库。最终知识仍在 `wiki/**/*.md`。

### 4.4 folderContext 是什么

`folderContextForSourcePath(...)` 会把 source 所在目录转成分类提示：

```text
raw/sources/合同库/租赁/租赁合同A.pdf
        |
        v
folderContext = "合同库 > 租赁"
```

这个上下文会随队列任务进入 LLM prompt：

```text
**File:** 租赁合同A.pdf
**Folder context:** 合同库 > 租赁
```

它的价值是：当用户上传的是一批资料，目录结构本身就表达了用户分类意图。LLM 编译时可以把目录当成弱标签。

## 5. 队列：ingest-queue.ts

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/ingest-queue.ts`
- `enqueueBatch(...)`
- `saveQueue(...)`
- `restoreQueue(...)`
- `pauseQueue(...)`
- `processNext(...)`

### 5.1 入队数据长什么样

`enqueueSourceIngest(...)` 最终调用 `enqueueBatch(project.id, files)`。队列任务类型：

```ts
interface IngestTask {
  id: string
  projectId: string
  sourcePath: string
  folderContext: string
  status: "pending" | "processing" | "done" | "failed"
  addedAt: number
  error: string | null
  retryCount: number
}
```

落盘文件：

```text
<project>/.llm-wiki/ingest-queue.json
```

模拟 `ingest-queue.json`：

```json
[
  {
    "id": "ingest-1715000000000-k3p9az",
    "projectId": "proj_contracts",
    "sourcePath": "raw/sources/合同库/租赁合同A.pdf",
    "folderContext": "合同库",
    "status": "pending",
    "addedAt": 1715000000000,
    "error": null,
    "retryCount": 0
  }
]
```

### 5.2 为什么必须串行

`processNext(...)` 使用模块级 `processing` 变量保证一次只跑一个任务。原因很实际：ingest 会读 `wiki/index.md`，generation 又会覆盖/更新它。如果两个文件同时编译，它们会基于同一个旧 index 生成两个新 index，互相覆盖。

```text
pending A, pending B
        |
        v
processNext 只取第一个 pending
        |
        v
A: processing -> autoIngest
        |
        v
A 成功后从队列删除，再 processNext B
```

失败会自动重试，最大次数：

```ts
const MAX_RETRIES = 3
```

### 5.3 切项目/重启如何恢复

- `pauseQueue()`：切换项目时把当前 processing 改回 pending，并写回 `.llm-wiki/ingest-queue.json`。
- `restoreQueue(projectId, projectPath)`：打开项目时读回队列，把旧的 processing 也改成 pending，然后继续跑。

这就是 llm-wiki 能做到“导入一堆文件，重启后还能继续编译”的关键。

OpenAgents 对齐建议：

```text
llm-wiki: .llm-wiki/ingest-queue.json + 前端内存 processNext
OpenAgents: knowledge_build_jobs + backend worker

两者都应该表达：
- job id
- base id / project id
- source id / document id
- source path / storage ref
- status: queued/processing/ready/error
- retry count
- error message
- output workspace paths
```

## 6. 核心编译：autoIngest

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/ingest.ts`
- `autoIngest(...)`
- `autoIngestImpl(...)`
- `buildAnalysisPrompt(...)`
- `buildGenerationPrompt(...)`
- `parseFileBlocks(...)`
- `writeFileBlocks(...)`

`autoIngest(...)` 外层先用 `withProjectLock(...)` 加项目锁，防止同一项目并发写 wiki。

### 6.1 Step 0：读取上下文

代码一次性读取：

```ts
const [sourceContent, schema, purpose, index, overview] = await Promise.all([
  tryReadFile(sp),
  tryReadFile(`${pp}/schema.md`),
  tryReadFile(`${pp}/purpose.md`),
  tryReadFile(`${pp}/wiki/index.md`),
  tryReadFile(`${pp}/wiki/overview.md`),
])
```

模拟输入：

```text
sp = /KnowledgeProject/raw/sources/合同库/租赁合同A.pdf
fileName = 租赁合同A.pdf
sourceContent = read_file(sp) 的结果。PDF 会优先读 raw/sources/.cache/租赁合同A.pdf.txt。
schema = schema.md
purpose = purpose.md
index = wiki/index.md
overview = wiki/overview.md
```

### 6.2 Step 0.1：hash cache，未变化就跳过 LLM

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/ingest-cache.ts`
- `checkIngestCache(...)`
- `saveIngestCache(...)`

缓存文件：

```text
<project>/.llm-wiki/ingest-cache.json
```

模拟内容：

```json
{
  "entries": {
    "租赁合同A.pdf": {
      "hash": "b2d4b7c0e97f9c4b...",
      "timestamp": 1715000199000,
      "filesWritten": [
        "wiki/sources/租赁合同A.md",
        "wiki/entities/成都星河置业有限公司.md",
        "wiki/entities/李某.md",
        "wiki/concepts/逾期支付租金.md",
        "wiki/index.md",
        "wiki/log.md",
        "wiki/overview.md"
      ]
    }
  }
}
```

如果 hash 一样，并且 `filesWritten` 每个文件还存在，`autoIngest` 直接返回这些文件路径，不再调用主 LLM。图片补注入可能还会跑，因为旧版本可能没有提取图片。

### 6.3 Step 0.5：图片提取到 wiki/media

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/extract-source-images.ts`
- `/root/project/ai/llm_wiki/src-tauri/src/commands/extract_images.rs`
- `extractAndSaveSourceImages(...)`

对于 PDF/DOCX/PPTX，图片会保存到：

```text
wiki/media/租赁合同A/page-1-image-1.png
wiki/media/租赁合同A/page-2-image-1.png
```

模拟返回：

```json
[
  {
    "relPath": "wiki/media/租赁合同A/page-1-image-1.png",
    "page": 1,
    "sha256": "9ac1..."
  }
]
```

如果开启 multimodal caption，会进一步写 caption cache：

```text
.llm-wiki/image-caption-cache.json
```

模拟内容：

```json
{
  "9ac1...": {
    "caption": "合同首页截图，包含房屋租赁合同标题、甲乙方和租赁期限字段。",
    "updatedAt": 1715000200000,
    "model": "gpt-4o-mini"
  }
}
```

随后 source summary 页会被注入图片段落：

```markdown
<!-- llm-wiki:embedded-images -->
## Embedded Images

![合同首页截图，包含房屋租赁合同标题、甲乙方和租赁期限字段。](../media/租赁合同A/page-1-image-1.png)
<!-- llm-wiki:embedded-images -->
```

### 6.4 Step 1：LLM 分析源文件，但不落盘

源码锚点：

- `buildAnalysisPrompt(purpose, index, truncatedContent)`
- `streamChat(...)`

输入给 LLM 的 user message 大致是：

```markdown
Analyze this source document:

**File:** 租赁合同A.pdf
**Folder context:** 合同库

---

# Page 1
房屋租赁合同
甲方：成都星河置业有限公司
乙方：李某
...
```

Step 1 输出存在变量 `analysis`，**不直接写文件**。它是 Step 2 的上下文。

模拟 `analysis`：

```markdown
## Key Entities
- 成都星河置业有限公司：出租方，合同甲方。
- 李某：承租方，合同乙方。

## Key Concepts
- 逾期支付租金：超过十五日触发解除权。
- 押金扣抵：与房屋损坏和欠费有关。

## Main Arguments & Findings
- 合同核心是三年租赁关系，月租 12000 元。
- 第七条对逾期付款设置明确解除条件。

## Recommendations
- 创建 source 页面：wiki/sources/租赁合同A.md
- 创建 entity 页面：wiki/entities/成都星河置业有限公司.md
- 创建 concept 页面：wiki/concepts/逾期支付租金.md
```

为什么两步：README 也强调 two-step ingest。源码里 Step 1 先分析，Step 2 再生成 FILE blocks。这样比“边读边写”更稳定，尤其是多文档会共享实体/概念页时。

### 6.5 Step 2：LLM 生成 FILE/REVIEW blocks

源码锚点：

- `buildGenerationPrompt(schema, purpose, index, fileName, overview, truncatedContent)`
- `parseFileBlocks(...)`

生成 prompt 强制 LLM 输出这种格式：

```markdown
---FILE: wiki/sources/租赁合同A.md---
---
type: source
title: "Source: 租赁合同A.pdf"
created: 2026-05-17
updated: 2026-05-17
tags: [合同, 租赁]
related: [成都星河置业有限公司, 李某, 逾期支付租金]
sources: ["租赁合同A.pdf"]
---

# Source: 租赁合同A.pdf

这份合同确立了 [[成都星河置业有限公司]] 与 [[李某]] 之间的房屋租赁关系...
---END FILE---

---FILE: wiki/concepts/逾期支付租金.md---
---
type: concept
title: "逾期支付租金"
created: 2026-05-17
updated: 2026-05-17
tags: [合同, 违约责任]
related: [租赁合同A, 解除权]
sources: ["租赁合同A.pdf"]
---

# 逾期支付租金

在 [[租赁合同A]] 中，乙方逾期支付租金超过十五日，甲方可以解除合同...
---END FILE---

---REVIEW: suggestion | 需要补充地方租赁裁判规则---
合同条款设置了解除条件，但缺少法院对十五日宽限期是否合理的裁判规则。
OPTIONS: Create Page | Skip
PAGES: wiki/concepts/逾期支付租金.md
SEARCH: 成都 房屋租赁 逾期支付租金 解除合同 判例 | 租赁合同 逾期十五日 解除权 裁判规则
---END REVIEW---
```

### 6.6 parseFileBlocks 的安全边界

`parseFileBlocks(...)` 不只是正则拆文本，它还处理很多模型输出问题：

- CRLF 行尾。
- `--- END FILE ---` 这类空格变体。
- `---END FILE---` 出现在代码块里时不能误截断。
- 路径为空要 warning。
- 路径必须通过 `isSafeIngestPath(...)`。

`isSafeIngestPath(...)` 的核心规则：

```text
必须以 wiki/ 开头
不能是绝对路径
不能包含 ..
不能包含 Windows 保留设备名和非法字符
不能有控制字符
```

这很关键。LLM 输出是非可信数据，源文件里也可能含 prompt injection。如果没有这层，恶意源文件可以诱导模型写：

```text
---FILE: ../../../etc/passwd---
```

源码会拒绝这种路径。

### 6.7 writeFileBlocks 如何落盘

源码锚点：

- `writeFileBlocks(...)`
- `sanitizeIngestedFileContent(...)`
- `mergePageContent(...)`
- `backupExistingPage(...)`

写文件规则：

| 输出路径 | 写入策略 |
| --- | --- |
| `wiki/log.md` | 追加，不覆盖旧日志 |
| `wiki/index.md` | 整体覆盖 |
| `wiki/overview.md` | 整体覆盖 |
| `wiki/sources/*.md` | 如已存在，走合并逻辑 |
| `wiki/entities/*.md` | 如已存在，走合并逻辑 |
| `wiki/concepts/*.md` | 如已存在，走合并逻辑 |

为什么实体/概念页要 merge：同一个实体可能由 100 个文档共同贡献。例如 `成都星河置业有限公司.md` 可能第一次来自租赁合同，第二次来自补充协议，第三次来自判例。llm-wiki 不把后来的页面直接覆盖旧页面，而是：

1. frontmatter 的 `sources/tags/related` 做 union。
2. body 不同时调用 LLM merge。
3. merge 失败时保留备份到 `.llm-wiki/page-history/`，再用 fallback。

模拟合并后 `wiki/entities/成都星河置业有限公司.md`：

```markdown
---
type: entity
title: "成都星河置业有限公司"
created: 2026-05-17
updated: 2026-05-17
tags: [合同主体, 出租方]
related: [李某, 逾期支付租金, 押金扣抵]
sources: ["租赁合同A.pdf", "补充协议A.docx"]
---

# 成都星河置业有限公司

成都星河置业有限公司在 [[租赁合同A]] 中作为出租方出现，负责交付租赁房屋并收取租金。

## 与补充协议的关系

在 [[补充协议A]] 中，该公司同意调整交付日期，并重新约定物业费承担方式。
```

## 7. 编译后实际会产生哪些文件

以上传一个 `租赁合同A.pdf` 为例，完整编译后可能出现：

```text
KnowledgeProject/
  raw/
    sources/
      租赁合同A.pdf
      .cache/
        租赁合同A.pdf.txt

  wiki/
    sources/
      租赁合同A.md
    entities/
      成都星河置业有限公司.md
      李某.md
    concepts/
      逾期支付租金.md
      押金扣抵.md
    media/
      租赁合同A/
        page-1-image-1.png
    index.md
    log.md
    overview.md

  .llm-wiki/
    ingest-queue.json
    ingest-cache.json
    image-caption-cache.json
    page-history/
    chats/
    vector store files
```

### 7.1 `raw/sources/租赁合同A.pdf`

性质：用户原始文件。

用途：预览、重新编译、证据追溯。

OpenAgents 映射：source object，例如 MinIO：

```text
s3://knowledge/users/{owner}/bases/{base}/documents/{doc}/source/租赁合同A.pdf
```

### 7.2 `raw/sources/.cache/租赁合同A.pdf.txt`

性质：PDF/Office 的文本提取缓存。

用途：避免每次读取 PDF 都重新解析。

模拟：

```markdown
# Page 1
房屋租赁合同
甲方：成都星河置业有限公司
...

# Page 2
第七条 违约责任
乙方逾期支付租金超过十五日的...
```

OpenAgents 映射：可以作为 `canonical/raw-extracted.md` 或 `source_text.md` 存入文档包，但不要把它当 agent 默认搜索真源。

### 7.3 `wiki/sources/租赁合同A.md`

性质：每个 source 的摘要页，是 source 在 wiki 层的代表。

模拟：

```markdown
---
type: source
title: "Source: 租赁合同A.pdf"
created: 2026-05-17
updated: 2026-05-17
tags: [合同, 租赁]
related: [成都星河置业有限公司, 李某, 逾期支付租金]
sources: ["租赁合同A.pdf"]
---

# Source: 租赁合同A.pdf

这份文件是一份房屋租赁合同，核心内容包括租赁期限、租金支付、押金、交付义务和违约责任。

## 关键条款

- 租赁期限：2024-01-01 至 2026-12-31。
- 月租金：人民币 12000 元。
- 逾期租金超过十五日时，甲方可解除合同。

## 相关页面

- [[成都星河置业有限公司]]
- [[李某]]
- [[逾期支付租金]]
```

### 7.4 `wiki/entities/*.md`

性质：人物、公司、产品、地点等实体页。

特点：多个 source 可以共同贡献同一实体页。

模拟：

```markdown
---
type: entity
title: "李某"
created: 2026-05-17
updated: 2026-05-17
tags: [合同主体, 承租方]
related: [成都星河置业有限公司, 逾期支付租金]
sources: ["租赁合同A.pdf"]
---

# 李某

李某是 [[租赁合同A]] 中的承租方，需要按月支付租金并承担逾期付款责任。
```

### 7.5 `wiki/concepts/*.md`

性质：概念、规则、方法、主题页。

这类页面对“很多文档组成一个知识库”的价值最大，因为多个文档会不断合并到同一个概念页。

模拟：

```markdown
---
type: concept
title: "逾期支付租金"
created: 2026-05-17
updated: 2026-05-17
tags: [违约责任, 租赁合同]
related: [解除权, 押金扣抵]
sources: ["租赁合同A.pdf", "判例摘录.md"]
---

# 逾期支付租金

逾期支付租金是租赁合同中常见违约情形。在 [[租赁合同A]] 中，超过十五日未支付租金会触发出租方解除权。

## 裁判关注点

[[判例摘录]] 显示，法院通常会同时审查催告、宽限期、欠租金额和双方履约情况。
```

### 7.6 `wiki/index.md`

性质：目录页，也是聊天时经常读取的导航入口。

模拟：

```markdown
# Wiki Index

## Entities

- [[成都星河置业有限公司]] — 租赁合同中的出租方。
- [[李某]] — 租赁合同中的承租方。

## Concepts

- [[逾期支付租金]] — 租赁合同违约解除相关概念。
- [[押金扣抵]] — 押金用于抵扣损失或欠费的规则。

## Sources

- [[租赁合同A]] — 房屋租赁合同原始资料摘要。
```

### 7.7 `wiki/log.md`

性质：操作日志。`writeFileBlocks(...)` 对它是追加。

模拟：

```markdown
# Research Log

## [2026-05-17] ingest | 租赁合同A.pdf

- Added source summary for [[租赁合同A]].
- Added entity pages for [[成都星河置业有限公司]] and [[李某]].
- Added concept page [[逾期支付租金]].
```

### 7.8 `wiki/overview.md`

性质：全局概览页。每次 ingest 后会被更新，反映整个知识库当前覆盖什么。

模拟：

```markdown
---
type: overview
title: Project Overview
tags: []
related: [租赁合同A, 逾期支付租金]
---

# Overview

该知识库当前主要覆盖房屋租赁合同资料，重点包括合同主体、租金支付、押金、交付义务与违约责任。

目前已整理出一个核心 source 页面、两个合同主体实体页，以及逾期支付租金和押金扣抵等概念页。
```

### 7.9 `.llm-wiki/page-history/*`

性质：合并失败或 fallback 前的备份。

模拟文件名：

```text
.llm-wiki/page-history/wiki_concepts_逾期支付租金.md-2026-05-17T08-30-11-234Z
```

用途：防止合并写坏页面后完全丢失旧内容。

### 7.10 向量索引数据

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/embedding.ts`
- `embedPage(...)`
- `searchByEmbedding(...)`
- `/root/project/ai/llm_wiki/src-tauri/src/commands/vectorstore.rs`

如果 embedding 开启，`autoIngest` 会对写出的内容页调用 `embedPage(...)`。逻辑是：

```text
Markdown 页面
  -> chunkMarkdown
  -> enrichChunkForEmbedding(title + heading + chunk text)
  -> fetchEmbedding
  -> vectorUpsertChunks(projectPath, pageId, rows)
```

模拟向量行，不是源码中的精确存储格式，但表达字段含义：

```json
{
  "page_id": "逾期支付租金",
  "chunk_index": 0,
  "heading_path": "逾期支付租金 > 裁判关注点",
  "chunk_text": "法院通常会同时审查催告、宽限期、欠租金额和双方履约情况。",
  "embedding": [0.012, -0.031, 0.044]
}
```

注意：向量库是增强召回，不是最终知识正文。正文仍在 `wiki/**/*.md`。

## 8. 图谱如何从编译结果产生

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/wiki-graph.ts`
- `/root/project/ai/llm_wiki/src/lib/graph-relevance.ts`
- `/root/project/ai/llm_wiki/src/components/graph/graph-view.tsx`

图谱不是编译时单独写一个 graph JSON，而是运行时扫描 `wiki/**/*.md` 生成。

`buildWikiGraph(projectPath)` 做：

1. `listDirectory(<project>/wiki)` 找所有 Markdown。
2. 读取 frontmatter：`title/type/sources`。
3. 提取正文 `[[wikilink]]`。
4. 生成 node：`id/title/type/path/linkCount/community`。
5. 解析 link 成 edge。
6. 调 `buildRetrievalGraph(...)` 计算 relevance weight。
7. 用 Louvain 算 community。

模拟节点：

```json
{
  "id": "逾期支付租金",
  "label": "逾期支付租金",
  "type": "concept",
  "path": "/KnowledgeProject/wiki/concepts/逾期支付租金.md",
  "linkCount": 4,
  "community": 0
}
```

模拟边：

```json
{
  "source": "租赁合同A",
  "target": "逾期支付租金",
  "weight": 8.2
}
```

权重来自 `graph-relevance.ts` 的 4 类信号：

| 信号 | 权重 | 说明 |
| --- | ---: | --- |
| directLink | 3.0 | 两页之间有 `[[wikilink]]` |
| sourceOverlap | 4.0 | frontmatter `sources[]` 有重叠 |
| commonNeighbor | 1.5 | 共享邻居，类似 Adamic-Adar |
| typeAffinity | 1.0 | entity/concept/source 等类型亲和 |

这解释了为什么 `sources[]` 很重要：它不只是引用来源，也直接增强图谱和检索相关性。

## 9. 搜索和聊天如何使用编译结果

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/search.ts`
- `/root/project/ai/llm_wiki/src/components/search/search-view.tsx`
- `/root/project/ai/llm_wiki/src/components/chat/chat-panel.tsx`
- `/root/project/ai/llm_wiki/src/lib/context-budget.ts`

### 9.1 searchWiki 只默认搜索 wiki，不再全量扫 raw

`search.ts` 里有明确注释：当前 token search 不再扫描 `raw/sources/`。原因是 PDF/DOCX 很多时，直接 `readFile` 原文会非常慢。当前默认流程是：

```text
query
  -> tokenizeQuery
  -> listDirectory(wiki/)
  -> 读取 wiki/**/*.md
  -> title/content/phrase/token 打分
  -> 可选 searchByEmbedding 召回更多 page
  -> RRF 融合 token rank + vector rank
  -> 返回 top 20
```

模拟搜索返回：

```json
[
  {
    "path": "/KnowledgeProject/wiki/concepts/逾期支付租金.md",
    "title": "逾期支付租金",
    "snippet": "...超过十五日未支付租金会触发出租方解除权...",
    "titleMatch": true,
    "score": 0.0325,
    "images": []
  },
  {
    "path": "/KnowledgeProject/wiki/sources/租赁合同A.md",
    "title": "Source: 租赁合同A.pdf",
    "snippet": "...第七条对逾期付款设置明确解除条件...",
    "titleMatch": false,
    "score": 0.0297,
    "images": [
      {
        "url": "../media/租赁合同A/page-1-image-1.png",
        "alt": "合同首页截图，包含标题和甲乙方字段。"
      }
    ]
  }
]
```

### 9.2 Chat 如何组装上下文

`chat-panel.tsx` 在用户提问时做：

1. 读取 `wiki/index.md` 和 `purpose.md`。
2. 调 `searchWiki(pp, text)`，取 top 10。
3. 调 `buildRetrievalGraph(pp, dataVersion)`。
4. 对 top 搜索结果做一层 graph expansion，补相关页面。
5. 用 `computeContextBudget(...)` 控制 index/page 大小。
6. 读取被选中的 wiki 页面全文，编号为 `[1] [2] [3]`。
7. 要求 LLM 只能基于这些页面回答，并在末尾写隐藏注释：`<!-- cited: 1, 3 -->`。

模拟最终 prompt 中的页面上下文：

```markdown
## Page List
[1] 逾期支付租金 (wiki/concepts/逾期支付租金.md)
[2] Source: 租赁合同A.pdf (wiki/sources/租赁合同A.md)
[3] 成都星河置业有限公司 (wiki/entities/成都星河置业有限公司.md)

## Wiki Pages

### [1] 逾期支付租金
Path: wiki/concepts/逾期支付租金.md

---
type: concept
title: "逾期支付租金"
sources: ["租赁合同A.pdf", "判例摘录.md"]
---

# 逾期支付租金
...
```

LLM 回答末尾模拟：

```markdown
从现有资料看，逾期支付租金的核心风险是出租方解除权被触发。租赁合同A明确把十五日作为解除条件，但判例资料提示仍需结合催告、欠租金额和双方履约情况判断。[1][2]

<!-- cited: 1, 2 -->
```

聊天引用面板会优先使用保存下来的 references，避免重新打开历史聊天时引用漂移。

### 9.3 llm-wiki 检索源码中文注释版

下面不是重新设计，而是把 llm-wiki 源码里的关键检索路径按中文注释拆开。

`/root/project/ai/llm_wiki/src/lib/search.ts`：

```ts
export async function searchWiki(
  projectPath: string,
  query: string,
): Promise<SearchResult[]> {
  // 空 query 不检索，避免无意义地读完整个 wiki。
  if (!query.trim()) return []
  const pp = normalizePath(projectPath)

  // 中文 query 会被拆成字符、bigram 和原词。
  // 例如“壬寅日主”会产生“壬寅/寅日/日主/壬/寅/日/主/壬寅日主”。
  const tokens = tokenizeQuery(query)
  const effectiveTokens = tokens.length > 0 ? tokens : [query.trim().toLowerCase()]
  const results: SearchResult[] = []

  try {
    // 只列 wiki/ 下的 Markdown。这里已经明确不再扫 raw/sources/，
    // 因为 PDF/DOCX 很多时，查询时临时抽全文会拖慢每一次搜索。
    const wikiTree = await listDirectory(`${pp}/wiki`)
    const wikiFiles = flattenMdFiles(wikiTree)

    // 批量读取 wiki 页面并做 title/content/phrase/token 打分。
    await searchFiles(wikiFiles, effectiveTokens, query, results)
  } catch {
    // 没有 wiki 目录时返回空结果。
  }

  // token 检索先形成独立排名，后面 vector 检索也形成独立排名。
  // 两边分数不可直接相加，所以最终按 RRF 融合 rank。
  const tokenSorted = [...results].sort((a, b) => b.score - a.score)
  const tokenRank = new Map<string, number>()
  tokenSorted.forEach((r, i) => {
    tokenRank.set(normalizePath(r.path), i + 1)
  })

  // 如果启用了 embedding，额外查向量结果。
  // 向量命中的 page 如果不在 token results 里，会被 materialize 成候选项。
  let vectorRank = new Map<string, number>()
  if (embCfg.enabled && embCfg.model) {
    const vectorResults = await searchByEmbedding(pp, query, embCfg, 10)
    vectorResults.forEach((vr, i) => vectorRank.set(vr.id, i + 1))
  }

  // RRF 只看排名，不直接相加 token/vector 原始分。
  // 这能避免“词频分很大”或“向量相似度范围很小”导致单边压倒另一边。
  for (const r of results) {
    const tRank = tokenRank.get(normalizePath(r.path))
    const vRank = vectorRank.get(getFileStem(r.path))
    let rrf = 0
    if (tRank !== undefined) rrf += 1 / (RRF_K + tRank)
    if (vRank !== undefined) rrf += 1 / (RRF_K + vRank)
    r.score = rrf
  }

  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return results.slice(0, MAX_RESULTS)
}
```

`/root/project/ai/llm_wiki/src/components/chat/chat-panel.tsx`：

```ts
async function handleSend(text: string) {
  // greeting 不跑检索，避免“你好”这类问题把随机 wiki 页面塞进上下文。
  const greetingOnly = isGreeting(text)
  if (project && greetingOnly) {
    systemMessages.push({ role: "system", content: "reply briefly..." })
    return
  }

  const pp = normalizePath(project.path)

  // index/purpose 是 wiki workspace 的全局背景。
  // index 太长会按 query tokens 裁剪，避免 100 个文档时索引撑爆上下文。
  const [rawIndex, purpose] = await Promise.all([
    readFile(`${pp}/wiki/index.md`).catch(() => ""),
    readFile(`${pp}/purpose.md`).catch(() => ""),
  ])

  // 第一层：搜索 wiki 页面，拿 top 10。
  const searchResults = await searchWiki(pp, text)
  const topSearchResults = searchResults.slice(0, 10)

  // 第二层：构建 retrieval graph，根据 wikilink、sources[] 等关系做一跳扩展。
  const graph = await buildRetrievalGraph(pp, dataVersion)
  const graphExpansions = []
  for (const result of topSearchResults) {
    const nodeId = getFileName(result.path).replace(/\.md$/, "")
    const related = getRelatedNodes(nodeId, graph, 3)
    // 只接收相关性足够高的邻居，避免图谱扩展把上下文污染。
    for (const { node, relevance } of related) {
      if (relevance >= 2.0) graphExpansions.push(node)
    }
  }

  // 第三层：按预算读取页面全文。
  // title match 优先，其次 content match，再其次 graph expansion。
  const relevantPages = []
  await tryAddTitleMatchedPages()
  await tryAddContentMatchedPages()
  await tryAddGraphExpansionPages()

  // 第四层：把页面编号后塞进 system prompt。
  // 模型只能基于这些页面回答，并用 [1] [2] 引用。
  systemMessages.push({
    role: "system",
    content: [
      "Answer questions based on the wiki content provided below.",
      "Answer based ONLY on the numbered wiki pages provided below.",
      purpose ? `## Wiki Purpose\n${purpose}` : "",
      index ? `## Wiki Index\n${index}` : "",
      `## Page List\n${pageList}`,
      `## Wiki Pages\n\n${pagesContext}`,
    ].filter(Boolean).join("\n"),
  })
}
```

结论：

- llm-wiki 查询时的默认真源是 `wiki/**/*.md`，不是原始 PDF/DOCX。
- 原始文件在编译阶段被消化；查询阶段只在必要时通过缓存/证据通道补原文。
- 图谱扩展不是单独替代检索，而是在搜索结果之后扩大相关页面集合。
- 上下文预算是 chat 侧最后一道闸门，防止多文档库把 prompt 塞爆。

## 10. OpenAgents Agent 文件检索链路

OpenAgents 当前的 agent-facing 知识库契约已经改成 filesystem-first：知识库编译结果仍然对齐 llm-wiki 的 `workspace/wiki/**/*.md`、`raw/sources/.cache/**`、`wiki/media/**` 等文件结构，但 agent 不再调用专门的语义知识库工具。运行时只把当前线程已绑定知识库挂载到稳定路径，并让模型使用通用文件工具检索。

```text
用户提问
  |
  v
Agent model call
  |
  v
KnowledgeContextMiddleware
  - 根据 runtime.context 解析 user_id/thread_id
  - 查询当前 thread 已绑定且 ready 的知识库
  - 注入每个知识库的 mount_path
  |
  v
Runtime backend factory
  - 在 /mnt/user-data/knowledge/ 下挂载只读知识库文件路由
  - 底层仍从 Knowledge Asset Store 读取 MinIO/filesystem 对象
  |
  v
模型使用通用文件工具
  ls / glob      -> 看挂载目录和候选文件
  grep           -> 在 wiki/source cache 中定位精确命中行
  read_file      -> 按 offset/limit 分页读取带行号正文
  |
  v
模型基于可见行号和路径生成带来源的回答
```

### 10.1 Runtime prompt 注入：只告诉挂载位置

源码锚点：

- `/root/project/ai/deer-flow/backend/agents/src/agents/middlewares/knowledge_context_middleware.py`
- `KnowledgeContextMiddleware`
- `build_knowledge_context_prompt(...)`

核心源码中文注释版：

```python
def _thread_workspaces(runtime_context: object) -> list[KnowledgeWorkspaceRecord]:
    try:
        # 身份只能来自 runtime.context，不能从用户自然语言中猜 owner/thread。
        user_id, thread_id = resolve_knowledge_runtime_identity(runtime_context)
    except ValueError:
        return []

    # 当前 thread 的 binding 是 agent 可见知识库的唯一来源。
    return KnowledgeService().get_thread_workspace_records(
        user_id=user_id,
        thread_id=thread_id,
    )


def build_knowledge_context_prompt(...):
    # prompt 不暴露 MinIO key、宿主机路径或内部 storage_ref。
    # 它只列出 agent 可见的 mount_path，让模型用通用文件工具读取。
    for workspace in workspaces:
        lines.append(f"<mount_path>{knowledge_workspace_mount_path(workspace)}</mount_path>")
```

模拟注入给模型的 XML：

```xml
<knowledge_context>
  <summary>This thread has 1 attached knowledge workspace.</summary>
  <knowledge_attached_workspaces>
    <workspace>
      <workspace_id>8cb640bd-5906-4fc8-813d-712343572e27</workspace_id>
      <name>bazi-knowledge</name>
      <mount_path>/mnt/user-data/knowledge/bazi-knowledge__8cb640bd-5906-4fc8-813d-712343572e27</mount_path>
      <document_count>100</document_count>
      <ready_document_count>100</ready_document_count>
    </workspace>
  </knowledge_attached_workspaces>
</knowledge_context>
```

这里的重点是：模型不需要知道对象存储、数据库记录或内部实现。它只需要把 `mount_path` 当成只读目录，并使用已有文件工具完成检索。

### 10.2 Runtime backend：把知识库呈现为只读文件树

源码锚点：

- `/root/project/ai/deer-flow/backend/agents/src/runtime_backends/factory.py`
- `/root/project/ai/deer-flow/backend/agents/src/runtime_backends/knowledge_filesystem.py`
- `/root/project/ai/deer-flow/backend/agents/src/knowledge/runtime_mount.py`

核心源码中文注释版：

```python
KNOWLEDGE_ROUTE_PREFIX = "/mnt/user-data/knowledge/"


def _attach_thread_knowledge_route(backend, *, thread_id: str, user_id: str | None):
    # 没有 user_id 时不挂载，避免匿名或系统任务误读知识库。
    if not user_id:
        return backend

    # 知识库 route 是只读 BackendProtocol。它和默认 workspace backend 组合，
    # 所以同一套 ls/glob/grep/read_file 工具可以同时读用户文件和知识库文件。
    knowledge_backend = ThreadKnowledgeFilesystemBackend(
        user_id=user_id,
        thread_id=thread_id,
    )
    return CompositeBackend(
        default=backend,
        routes={KNOWLEDGE_ROUTE_PREFIX: knowledge_backend},
    )
```

`ThreadKnowledgeFilesystemBackend` 的行为：

```text
ls /mnt/user-data/knowledge/
  -> 返回当前 thread 绑定的 ready workspace 目录

glob pattern="**/*.md" path="/mnt/user-data/knowledge/<workspace>/wiki"
  -> 返回编译后的 wiki 页面路径

grep pattern="壬寅" path="/mnt/user-data/knowledge/<workspace>"
  -> 返回 path + line + text

read_file path="/mnt/user-data/knowledge/<workspace>/wiki/sources/foo.md" offset=120 limit=80
  -> 返回带行号正文和分页 footer
```

### 10.3 Workspace Store：底层仍然是 Knowledge Asset Store

源码锚点：

- `/root/project/ai/deer-flow/backend/agents/src/knowledge/wiki_workspace.py`
- `KnowledgeWorkspaceStore`
- `normalize_workspace_path(...)`

中文注释版：

```python
class KnowledgeWorkspaceStore:
    def workspace_prefix(self, workspace: KnowledgeWorkspaceRecord) -> str:
        # 共享知识库被别人挂载时，资产仍归原 owner 所有。
        return f"knowledge/users/{workspace.owner_id}/bases/{workspace.id}/workspace"

    def storage_ref(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> str:
        # agent 只传 workspace 内相对路径；normalize_workspace_path 防止 ../ 逃逸。
        safe_path = normalize_workspace_path(relative_path)
        return self._asset_store.storage_ref_from_relative_path(
            f"{self.workspace_prefix(workspace)}/{safe_path}"
        )

    def read_text(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> str:
        # asset_store 决定底层是 MinIO 还是显式配置的本地 filesystem。
        return self._asset_store.read_text(self.storage_ref(workspace, relative_path))
```

agent 可见路径和存储路径的关系：

```text
agent path:
  /mnt/user-data/knowledge/bazi-knowledge__8cb.../wiki/concepts/壬水丑月.md

workspace relative path:
  wiki/concepts/壬水丑月.md

Knowledge Asset Store relative path:
  knowledge/users/<owner_id>/bases/<base_id>/workspace/wiki/concepts/壬水丑月.md

MinIO object:
  s3://openagents-knowledge/knowledge/users/<owner_id>/bases/<base_id>/workspace/wiki/concepts/壬水丑月.md
```

### 10.4 完整 agent 调用示例：壬寅日主丑月案例

用户问：

```text
壬寅日主丑月出生的案例有哪些？请找相似案例并说明共性。
```

推荐文件工具序列：

```text
1. ls
   path="/mnt/user-data/knowledge/"

2. grep
   path="/mnt/user-data/knowledge/bazi-knowledge__8cb640bd-5906-4fc8-813d-712343572e27"
   pattern="壬寅"

3. grep
   path="/mnt/user-data/knowledge/bazi-knowledge__8cb640bd-5906-4fc8-813d-712343572e27"
   pattern="丑月"

4. read_file
   path="/mnt/user-data/knowledge/bazi-knowledge__8cb640bd-5906-4fc8-813d-712343572e27/wiki/sources/案例大全-盲派真实案例-壬寅柱-cases-017d4d7e.md"
   offset=<grep 命中行附近>
   limit=80
```

错误边界：

```text
1. 把知识库名称当成文档名称传入旧文档树链路
   # 错：当前 agent-facing 契约已经没有单文档 PageTree 检索。

2. 读取 /root/project/ai/ai-numerology/backend/agents/examples/案例大全/...
   # 错：这是宿主机源码路径，产品环境和沙箱不依赖它。

3. 遍历内部缓存目录或对象存储 key
   # 错：这些是实现细节，不属于 agent 可见路径契约。
```

### 10.5 OpenAgents 与 llm-wiki 当前差异

已经对齐的部分：

- 都把 `wiki/**/*.md` 作为默认检索真源。
- 都保留 `raw/sources/.cache/**` 作为原文证据和预览补充。
- 都用 `sources[]`、wikilink 和 wiki 页面结构支撑图谱展示。
- 都让用户可以打开页面或来源预览，而不是只看到不可解释的向量 chunk。

仍需继续补齐的部分：

- llm-wiki chat 有 token search、可选 vector search、graph expansion 和 context budget；OpenAgents agent 当前主要依赖模型主动组合 `grep/read_file`，需要补可复用的检索策略模板或更强的文件工具审计。
- llm-wiki UI 原生展示 Source/Wiki/Search/Graph；OpenAgents 管理页还需要继续把“编译后 wiki 页面”“原文证据预览”“图谱节点和引用跳转”做成主要视图。
- 当前验证脚本可以检查阶段 Markdown 是否有路径、行号、候选边界和非压缩摘录；如果要机械证明每条摘录确实来自文件工具结果，还需要为通用 `grep/read_file` 增加 runtime file-operation audit。

## 11. 删除 source 时如何清理衍生知识

源码锚点：

- `/root/project/ai/llm_wiki/src/lib/source-lifecycle.ts`
- `deleteSourceFile(...)`
- `deleteSourceFiles(...)`
- `deleteSourceFolder(...)`
- `/root/project/ai/llm_wiki/src/lib/wiki-page-delete.ts`

删除一个源文件不是只删 `raw/sources/foo.pdf`。它会：

1. 删除原 source。
2. 删除 `raw/sources/.cache/foo.pdf.txt`。
3. 删除 `.llm-wiki/ingest-cache.json` 中对应 entry。
4. 扫描 `wiki/**/*.md` 的 frontmatter `sources[]`。
5. 如果某页面只来自这个 source，则级联删除该页面。
6. 如果页面还有其他 source，则只重写 `sources[]`，保留页面。
7. 删除相关 embedding。
8. 清理 `index.md`、wikilink、`related`。
9. 追加删除日志。

模拟：

```text
删除 raw/sources/租赁合同A.pdf

wiki/concepts/逾期支付租金.md sources:
  ["租赁合同A.pdf", "判例摘录.md"]

删除后变成：
  ["判例摘录.md"]
页面保留。

wiki/sources/租赁合同A.md sources:
  ["租赁合同A.pdf"]

删除后 sources 为空，页面删除。
```

这对 OpenAgents 很重要：如果一个知识库有 100 个文档，某个概念页可能来自 20 个文档。删除其中一个文档时，不能粗暴删除概念页；必须按 `sources[]` 做贡献清理。

## 12. 为什么适合多文档知识库

用户痛点是：一个知识库里有很多文档，传统单体文件检索很强，但多文档关系会变弱。llm-wiki 的关键取舍是：

```text
传统 RAG：
  每次 query -> 在 100 个文档 chunk 中找片段 -> 模型临时综合

llm-wiki：
  上传/更新时 -> 先把 100 个文档编译成稳定 wiki 页面
  每次 query -> 检索 wiki 页面 + 图谱扩展 -> 模型基于已整理知识回答
```

优点：

- 多文档共同实体/概念会被合并到同一页，关系更稳定。
- `sources[]` 保存来源贡献，删除和审计可追溯。
- `[[wikilink]]` 让图谱和 graph expansion 有结构信号。
- 聊天时不需要每次塞大量原文，token 更可控。
- 用户能直接打开 wiki 页面审查，而不是只能看不可解释的向量 chunk。

代价：

- 编译慢，尤其是大 PDF、多图片、LLM merge 多时。
- 编译质量取决于模型是否按 FILE block 和 frontmatter 规范输出。
- 需要后台队列、重试、缓存、增量合并、删除清理。
- 需要“source summary + entity/concept 页”的产品心智，不能只给用户一个文件列表。

## 13. 对 OpenAgents 知识库重构的映射

不要复制 llm-wiki 的桌面代码，但应对齐它的数据契约。

### 13.1 上传阶段

llm-wiki：

```text
Tauri open dialog
  -> copyFile/copyDirectory
  -> raw/sources/
```

OpenAgents：

```text
Frontend upload
  -> Gateway 创建 knowledge_documents
  -> Knowledge Asset Store 写 source/original
  -> backend worker materialize 本地临时路径
```

建议 workspace 逻辑路径：

```text
workspace/
  raw/sources/{document_original_name}
  raw/sources/.cache/{document_original_name}.txt
```

### 13.2 编译队列

llm-wiki：

```text
.llm-wiki/ingest-queue.json
```

OpenAgents：

```text
knowledge_build_jobs
knowledge_build_events
```

字段建议：

```json
{
  "job_id": "job_123",
  "base_id": "base_abc",
  "document_id": "doc_001",
  "source_storage_ref": "s3://knowledge/users/u1/bases/b1/documents/d1/source/a.pdf",
  "status": "processing",
  "phase": "llm_generation",
  "retry_count": 1,
  "workspace_prefix": "users/u1/bases/b1/workspace/"
}
```

### 13.3 编译产物

llm-wiki：

```text
wiki/**/*.md
wiki/media/**
.llm-wiki/ingest-cache.json
.llm-wiki/image-caption-cache.json
```

OpenAgents：

```text
workspace/wiki/**/*.md
workspace/wiki/media/**
workspace/metadata/ingest-cache.json
workspace/metadata/image-caption-cache.json
```

存储可以是 MinIO，但 API 和 agent 工具应该把它呈现为 workspace 文件树。

### 13.4 检索阶段

llm-wiki：

```text
searchWiki -> wiki token search + optional vector search + RRF
buildRetrievalGraph -> wikilink + sources overlap + type affinity
chat-panel -> top pages + graph expansion + budget
```

OpenAgents 当前 agent-facing 契约：

```text
KnowledgeContextMiddleware
  -> 注入 /mnt/user-data/knowledge/<workspace-name>__<workspace-id> mount_path

ls / glob
  -> 发现当前线程已绑定知识库中的 workspace/wiki、raw/sources/.cache、wiki/media 等文件

grep
  -> 在编译后的 wiki 页面或原文 cache 中定位精确命中行

read_file
  -> 按 offset/limit 分页读取带行号正文，供模型引用和复核
```

### 13.5 前端页面

llm-wiki UI 不是只显示“文档列表”，而是显示：

- Sources：原始文件树。
- Wiki：编译后的页面树。
- Search：wiki 页面检索结果。
- Graph：实体/概念/source 的图谱。
- Preview：点击 source 或引用能看到原文/页面。
- Activity：导入队列和编译进度。

OpenAgents 知识库管理页应该至少保留这几块：

```text
左侧：知识库 / 分组 / source 文档
中间：Wiki Workspace 页面树 + 搜索
右侧：页面预览 / 原文证据预览
图谱页：按 wiki 页面构图，而不是按原始文件构图
构建页：job phase、事件日志、失败重试、产物路径
```

## 14. 最小可验证样例

上传两个文件：

```text
raw/sources/合同库/租赁合同A.pdf
raw/sources/合同库/判例摘录.md
```

期望 source 层：

```text
raw/sources/合同库/租赁合同A.pdf
raw/sources/合同库/判例摘录.md
raw/sources/合同库/.cache/租赁合同A.pdf.txt
```

期望 wiki 层：

```text
wiki/sources/租赁合同A.md
wiki/sources/判例摘录.md
wiki/entities/成都星河置业有限公司.md
wiki/entities/李某.md
wiki/concepts/逾期支付租金.md
wiki/concepts/解除权.md
wiki/index.md
wiki/log.md
wiki/overview.md
```

期望 `逾期支付租金.md` 有两个来源：

```yaml
sources: ["租赁合同A.pdf", "判例摘录.md"]
```

期望图谱至少有：

```text
租赁合同A -- 逾期支付租金
判例摘录 -- 逾期支付租金
逾期支付租金 -- 解除权
成都星河置业有限公司 -- 租赁合同A
李某 -- 租赁合同A
```

期望问答：

```text
问：逾期支付租金超过十五日是否一定能解除合同？

检索：
  searchWiki 命中 wiki/concepts/逾期支付租金.md
  graph expansion 补 wiki/concepts/解除权.md 和 wiki/sources/租赁合同A.md
  需要原文时再打开 source evidence

答：
  应说明合同中有十五日解除条件，但是否当然解除还要结合催告、实际欠租、履约情况和判例资料。
  引用 [1] [2]。
```

如果做到这些，才说明“多文档知识库”不是把 100 个文件分别切 chunk，而是已经被编译成一个可维护的知识工作区。
