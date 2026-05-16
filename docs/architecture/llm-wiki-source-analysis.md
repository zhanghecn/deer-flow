# LLM Wiki 源码实现详解

本文基于本地源码 `/root/project/ai/llm_wiki` 编写，目标是让维护者能够按实现顺序理解 llm-wiki 如何把一批原始文档编译成可检索、可图谱化、可聊天引用的 Wiki Workspace。

注意：这里以源码为准，不以 README 的宣传性描述为准。例如 README 的查询阶段曾写到同时搜索 `wiki/` 和 `raw/sources/`，但当前 `src/lib/search.ts` 已明确只做 `wiki/` 词法搜索，raw 原文主要通过 `wiki/sources/*.md` 摘要与可选向量 chunk 补召回。

## 1. 一句话总览

llm-wiki 不是传统“每次问答都直接 RAG 原文”的系统。它先把用户资料编译成一个本地 Markdown wiki，再让问答、搜索、图谱、审查都围绕这个 wiki 工作。

```text
raw/sources 原始资料
        |
        |  ingest queue 串行调度
        v
LLM 两步编译：分析 source -> 生成 wiki file blocks
        |
        v
wiki/**/*.md 作为知识真源
        |
        +--> token search + vector search + graph expansion -> Chat
        |
        +--> wikilinks + sources frontmatter -> Graph / Insights
        |
        +--> Markdown reader / search UI / source preview
```

核心取舍：

- 原文不在聊天时反复全量读入，而是在导入时编译成结构化页面。
- 生成物不是 JSON，而是带 YAML frontmatter 的 Markdown 文件。
- 图谱不是独立数据库，而是从 `wiki/**/*.md` 中的 `[[wikilink]]` 与 `sources[]` 即时构建并缓存。
- 向量索引是增强召回，不是知识真源。真源仍是文件。

## 2. 项目与数据目录

llm-wiki 是 Tauri + React/TypeScript 桌面应用：

- 前端与应用逻辑：`src/**/*.ts(x)`
- Rust/Tauri 命令：`src-tauri/src/commands/**/*.rs`
- 用户项目目录：由用户选择，本质是一个文件夹

一个典型用户项目大致长这样：

```text
Wiki Project/
  raw/
    sources/
      合同A.pdf
      研究资料/
        paper.docx
      .cache/
        合同A.pdf.txt

  wiki/
    index.md
    overview.md
    log.md
    entities/
      some-entity.md
    concepts/
      some-concept.md
    sources/
      合同A.md
    media/
      合同A/
        img-1.png

  schema.md
  purpose.md

  .llm-wiki/
    ingest-queue.json
    ingest-cache.json
    image-caption-cache.json
    chats/
    vector store / app state files
```

这三层最关键：

```text
raw/sources/
  用户导入的原始资料，尽量保持原样。

wiki/
  LLM 编译后的知识层，是搜索、聊天、图谱的默认真源。

.llm-wiki/
  应用运行状态、队列、缓存、聊天历史、caption cache、向量索引等。
```

中文注释版目录语义：

```text
raw/sources/      # 原始输入层：用户资料放这里，删除/变更会触发级联清理
wiki/             # 编译输出层：Markdown wiki，agent 默认应该检索这里
.llm-wiki/        # 运行状态层：队列、缓存、聊天、向量库，不应当作为用户知识正文
schema.md         # 告诉 LLM “wiki 应该如何组织”
purpose.md        # 告诉 LLM “这个 wiki 为什么存在、关注什么问题”
```

## 3. 启动与项目加载

主要源码：

- `src/App.tsx`
- `src/stores/wiki-store.ts`
- `src/lib/project-store.ts`
- `src/lib/reset-project-state.ts`
- `src/lib/ingest-queue.ts`

启动时，应用先加载全局配置，再打开上次项目。打开项目后，`handleProjectOpened` 会做一次完整的项目态重建。
  
```text
App mount
  |
  +--> setupAutoSave()
  +--> startClipWatcher()
  +--> loadLlmConfig / provider / embedding / multimodal / language
  +--> getLastProject()
          |
          v
      openProject(path)
          |
          v
      handleProjectOpened(project)
          |
          +--> resetProjectState()
          +--> setProject()
          +--> bumpDataVersion()
          +--> restoreQueue(project.id, project.path)
          +--> restoreDedupQueue()
          +--> loadScheduledImportConfig()
          +--> startProjectFileSync()
          +--> notify clip server
          +--> listDirectory(project.path) -> fileTree
          +--> loadReviewItems()
          +--> loadChatHistory()
```

关键隐含点：

- `resetProjectState()` 必须在新项目数据加载前执行，否则旧项目的 graph cache、queue state、selected file 可能污染新项目。
- `restoreQueue()` 用项目 UUID 绑定队列，而不只靠路径。这样项目目录移动后，未完成任务仍有机会恢复。
- `bumpDataVersion()` 是图谱和检索相关缓存失效的轻量信号。图谱模块用它判断是否重建。

中文注释版伪代码：

```ts
async function handleProjectOpened(proj) {
  // 先清空旧项目状态，避免图谱缓存、选中文件、队列状态串项目。
  await resetProjectState()

  // 设置当前项目后，所有 store selector 才能拿到正确 project。
  setProject(proj)

  // dataVersion 是“文件图谱已变化”的广播，不存业务数据。
  bumpDataVersion()

  // 恢复导入队列。必须早于 file watcher，否则 watcher 可能先 enqueue。
  await restoreQueue(proj.id, proj.path)

  // 加载文件树、审查项、聊天历史，恢复用户上次的工作上下文。
  setFileTree(await listDirectory(proj.path))
  loadReviewItems(proj.path)
  loadChatHistory(proj.path)
}
```

## 4. 全局状态设计

主要源码：`src/stores/wiki-store.ts`

`wiki-store` 用 Zustand 保存应用级状态，常见字段包括：

- `project`：当前项目
- `fileTree`：当前文件树
- `selectedFile` / `fileContent`：右侧预览或编辑对象
- `activeView`：wiki、sources、search、graph、review、settings 等视图
- `llmConfig`：聊天和编译模型配置
- `embeddingConfig`：向量检索配置
- `multimodalConfig`：图片提取与 caption 配置
- `outputLanguage`：输出语言策略
- `dataVersion`：让图谱、缓存、UI 知道知识层已变化

设计特点：

- Store 不直接保存所有 Markdown 文件正文，正文仍从文件系统读取。
- `dataVersion` 不表达具体改了什么，只表达“知识结构可能变了”。
- 多个模块通过 `useWikiStore.getState()` 读取运行时配置，所以项目切换时必须清理状态。

## 5. 导入入口：Sources View

主要源码：

- `src/components/sources/sources-view.tsx`
- `src/lib/source-lifecycle.ts`
- `src/lib/ingest-queue.ts`

用户可以导入单文件或目录。导入目录时会递归复制到 `raw/sources/<folder>/`，并把目录层级变成 LLM 的分类上下文。

```text
用户选择文件 / 文件夹
      |
      v
copyFile / copyDirectory 到 raw/sources/
      |
      v
preprocessFile(file) 后台预处理
      |
      v
isIngestableSourcePath 过滤可摄入扩展名
      |
      v
enqueueBatch(project.id, files)
      |
      v
ingest-queue 串行执行 autoIngest
```

`source-lifecycle.ts` 的关键点：

- `INGESTABLE_SOURCE_EXTENSIONS` 控制哪些文件能进入编译。
- `folderContextForSourcePath()` 会把目录路径变成类似 `papers > energy` 的上下文，帮助 LLM 分类。
- 删除 source 时不是只删原文件，还会：
  - 删除 `.cache` 中的预处理缓存
  - 删除 ingest cache entry
  - 扫描 wiki 页的 `sources[]`
  - 如果某 wiki 页只来自被删 source，则级联删除该页
  - 如果 wiki 页还有其他 source，则只重写 `sources[]`
  - 删除相关 embedding
  - 清理 index、wikilink、related frontmatter

中文注释版删除逻辑：

```ts
async function deleteSourceFiles(projectPath, sourcePaths) {
  // 删除原始 source 和预处理 cache。
  delete raw/sources/file
  delete raw/sources/.cache/file.txt

  // 移除内容 hash cache，否则下次可能误判“已编译”。
  removeFromIngestCache(fileName)

  // 扫描 wiki 页面，看哪些页面的 sources[] 指向被删文件。
  for each wikiPage:
    if sources 全部被删:
      pagesToDelete.push(wikiPage)
    else if sources 部分被删:
      rewrite sources[]，保留其他来源

  // 级联清理 wikilink、index、related、embedding、media。
  cascadeDeleteWikiPagesWithRefs(pagesToDelete)
}
```

## 6. 持久化摄入队列

主要源码：`src/lib/ingest-queue.ts`

队列文件位于：

```text
<project>/.llm-wiki/ingest-queue.json
```

队列任务包含：

- `projectId`
- `sourcePath`
- `folderContext`
- `status`：pending、processing、done、failed、cancelled
- `retryCount`
- `error`

流程：

```text
enqueueBatch
  |
  +--> 去重：同一 project + source 不重复入队
  +--> persist queue
  +--> processNext()

processNext
  |
  +--> 找 pending task
  +--> status = processing
  +--> autoIngest(projectPath, sourcePath)
  +--> success: status = done
  +--> error: retryCount < 3 ? pending : failed
  +--> persist queue
  +--> 继续下一个
```

隐晦但重要的点：

- 队列串行处理，避免多个 source 同时改 `index.md`、`overview.md`、同一个 entity page。
- `pauseQueue()` 在项目切换时会把 processing 重置为 pending，避免任务半挂。
- `restoreQueue()` 会恢复 pending / failed 任务，防止应用重启丢工作。
- 队列 drain 后会触发 `sweepResolvedReviews()`，清理已经解决的 review item。

## 7. 摄入编译主链路

主要源码：

- `src/lib/ingest.ts`
- `src/lib/project-mutex.ts`
- `src/lib/ingest-cache.ts`
- `src/lib/page-merge.ts`
- `src/lib/frontmatter.ts`
- `src/lib/embedding.ts`

`autoIngest()` 是核心入口。外层用 `withProjectLock(projectPath, fn)` 做项目级互斥，避免并发覆盖共享文件。

```text
autoIngest(projectPath, sourcePath)
  |
  v
withProjectLock(projectPath)
  |
  v
autoIngestImpl
  |
  +--> read source / schema.md / purpose.md / wiki/index.md / overview.md
  +--> checkIngestCache(source hash)
  +--> extract images to wiki/media/<source-slug>/
  +--> optional caption images
  +--> if source too long, truncate for LLM
  |
  +--> LLM Step 1: analyze source
  |
  +--> LLM Step 2: generate file blocks
          |
          v
      ---FILE: wiki/...---
      markdown
      ---END FILE---
          |
          v
      parseFileBlocks()
          |
          v
      writeFileBlocks()
          |
          +--> index / overview 整体覆盖
          +--> 普通页 mergePageContent()
          +--> source summary fallback
          +--> image safety-net section
          +--> review item parse
          +--> save ingest cache
          +--> embed written pages
          +--> bumpDataVersion()
```

### 7.1 为什么是两步 LLM

llm-wiki 没让 LLM 一边读 source 一边直接写文件，而是先分析，再生成。

第一步输出结构化 analysis：

- source 的核心实体、概念、论点
- 与现有 wiki 的关系
- 与现有知识的矛盾或张力
- 推荐写哪些页面

第二步把 analysis、source、schema、purpose、index、overview 一起交给 LLM，让它输出可写入文件系统的 Markdown blocks。

这样做的好处：

- 让 LLM 先“理解资料”，再“改 wiki”，减少边读边写造成的遗漏。
- analysis 可以把长 source 压缩成结构化中间态。
- 第二步更像确定性文件生成，便于 parse 和校验。

### 7.2 FILE block 协议

llm-wiki 的最终输出不是 JSON，而是文本块协议：

```text
---FILE: wiki/concepts/example.md---
---
title: Example
type: concept
sources:
  - source.pdf
---

# Example

正文，允许包含 [[wikilink]]。

---END FILE---
```

为什么不用 JSON：

- Markdown 文件本身就是最终产物，模型直接输出接近最终文件的内容。
- 一个 response 可以写多个文件。
- 文件内可以自然包含 frontmatter、表格、代码块、图片、wikilink。
- JSON 转义 Markdown 很脆弱，尤其是长文、代码块和多语言内容。

中文注释版解析思路：

```ts
function parseFileBlocks(text) {
  // 逐行扫描，而不是一个大 regex。
  // 原因：Markdown 文件里可能有代码块，代码块内部也可能出现 ---END FILE---。
  for each line:
    if line looks like "---FILE: wiki/xxx.md---":
      start new block

    else if line looks like "---END FILE---" and not inside fenced code:
      close current block

    else:
      append line to current block

  // 如果 block 没闭合，返回 warning，而不是静默截断。
  return { files, warnings }
}
```

隐晦点：

- `parseFileBlocks()` 支持 CRLF、大小写和空格变体。
- 它会跟踪 fenced code block，避免代码块内的 marker 被误判。
- `isSafeIngestPath()` 会限制 LLM 只能写 `wiki/` 内路径，防止 `../` 路径穿越。
- 如果 LLM 没写 source summary，系统会 fallback 创建 `wiki/sources/<sourceBaseName>.md`。

### 7.3 写入与合并

`writeFileBlocks()` 的写入策略不是所有文件都覆盖：

```text
wiki/index.md      -> 可整体覆盖
wiki/overview.md   -> 可整体覆盖
wiki/log.md        -> append 或受控追加
wiki/entities/*.md -> mergePageContent()
wiki/concepts/*.md -> mergePageContent()
wiki/sources/*.md  -> mergePageContent()
```

`page-merge.ts` 是防止重复摄入导致信息丢失的关键。

中文注释版合并策略：

```ts
async function mergePageContent(newContent, existingContent, merger) {
  // 新页面：直接写。
  if (!existingContent) return newContent

  // 完全一样：跳过。
  if (newContent === existingContent) return existingContent

  // sources / tags / related 先由程序做 union，保证来源不会被 LLM 丢掉。
  const arrayMerged = mergeArrayFieldsIntoContent(newContent, existingContent)

  // 如果正文没变化，只写 frontmatter union 后的结果。
  if (oldBody === mergedBody) return arrayMerged

  // 正文冲突时才让 LLM 合并。
  const llmOutput = await merger(existingContent, arrayMerged)

  // 安全检查：没有 frontmatter 或正文缩水过多，都拒绝 LLM 合并结果。
  if (!hasFrontmatter(llmOutput)) return arrayMerged
  if (llmBody.length < max(oldBody, newBody) * 0.7) return arrayMerged

  // type/title/created 锁定旧值，避免页面身份漂移。
  return restoreLockedFieldsAndUnionArrays(llmOutput)
}
```

隐晦点：

- `sources/tags/related` 由程序 union，不完全信 LLM。
- `type/title/created` 是 locked fields，防止页面身份被新 source 改坏。
- LLM 合并正文如果短于旧/新正文较长者的 70%，认为可能是懒总结或截断，拒绝。
- fallback 会尽量备份旧内容，但备份失败不能阻断主流程。

### 7.4 缓存与增量

`ingest-cache.ts` 使用 source 内容 SHA256：

```text
.llm-wiki/ingest-cache.json
  sourceFileName:
    hash
    timestamp
    filesWritten[]
```

缓存命中条件：

1. source 当前内容 hash 和缓存一致。
2. 上次写出的每个 `filesWritten` 仍然存在。

第二点很重要。旧实现如果只看 hash，会出现“缓存说已写，但文件被用户删了”的幽灵结果。现在只要写出文件缺失，就强制重新摄入。

隐晦点：

- 图片提取/caption 有些路径即使命中 cache 也要补做，因为图片资产可能被删或需要级联补齐。
- hard failure 时不能保存 ingest cache，否则下一次会误跳过。
- cache key 目前按 source 文件名组织，这对同名文件需要结合导入时的唯一命名策略。

## 8. 图片与多模态处理

主要源码：

- `src/lib/extract-source-images.ts`
- `src/lib/image-caption-pipeline.ts`
- `src/lib/vision-caption.ts`
- `src-tauri/src/commands/extract_images.rs`
- `src/components/search/search-view.tsx`

图片处理链路：

```text
PDF / DOCX / PPTX source
      |
      v
Rust Tauri command 提取图片
      |
      v
wiki/media/<source-slug>/img-N.png
      |
      v
buildImageMarkdownSection()
      |
      v
追加到 source markdown:
  ## Embedded Images
  ### Page 5
  ![caption](media/source/img-1.png)
      |
      v
LLM 摄入时看到图片引用和 caption
      |
      v
SearchView 可按 caption 命中图片并 lightbox 预览
```

`extract-source-images.ts` 的职责很薄：

- 判断文件扩展名。
- 计算目标目录 `wiki/media/<source-slug>/`。
- 调 Rust 命令写图片。
- 返回图片 metadata。
- 失败时返回空数组，不中断摄入。

`image-caption-pipeline.ts` 的职责更重要：

- 扫描 Markdown 中的 `![](path)`。
- 读取图片 bytes。
- 用 SHA256 做 caption cache key。
- 调视觉模型生成事实性 caption。
- 把 `![](path)` 改成 `![caption](path)`。
- 支持并发、失败容错、进度回调。

中文注释版 caption 设计：

```ts
async function captionMarkdownImages(projectPath, markdown, llmConfig) {
  // 找出 Markdown 图片引用；HTML img 和 reference-style image 不处理。
  const refs = findImageReferences(markdown)

  // 同一个 URL 只处理一次，避免 inline + safety-net 重复调用模型。
  const uniqueRefs = dedupeByUrl(refs)

  for each ref in workerPool:
    // 读图片 bytes，再按 bytes 计算 hash。不能 hash base64 字符串。
    const hash = sha256(imageBytes)

    // 相同图片跨文档复用 caption，减少模型调用。
    if (captionCache[hash]) use cached caption
    else captionImage(base64, mimeType, surroundingText)

  // 最后一次性写 cache。逐图写更安全但成本高，这里选择批量落盘。
  writeCache()
}
```

隐晦点：

- caption cache 以图片 bytes 的 SHA256 为 key，而不是路径。相同 logo 或重复图片跨文档只 caption 一次。
- caption 时会截取图片前后各 150 字符作为上下文。这比 500 字符更便宜，也更聚焦 figure caption 附近信息。
- 单张图片 caption 失败不会让整个 source 摄入失败。
- Search UI 会区分“caption 命中 query 的图片”和“出现在命中页面里的 supporting images”。
- Lightbox 的 Jump to source 会从 `wiki/media/<slug>/...` 反查 `raw/sources/<slug>.*`，尽量打开原始 PDF/DOCX，而不是只打开 wiki summary。

## 9. Frontmatter 与文件名

主要源码：

- `src/lib/frontmatter.ts`
- `src/lib/wiki-filename.ts`
- `src/lib/sources-merge.ts`

frontmatter 是图谱、检索、合并和来源追踪的结构化入口。典型页面：

```md
---
title: 壬寅日主丑月案例
type: source
sources:
  - 案例大全/某案例.md
tags:
  - 八字
related:
  - [[壬水]]
---

# 壬寅日主丑月案例
```

实现细节：

- `frontmatter.ts` 使用 `js-yaml` 严格解析。
- 它有 fallback 逻辑，可处理 LLM 把 frontmatter 包进 code fence 或前几行有杂质的情况。
- 它会修复类似 `related: [[a]], [[b]]` 这种 LLM 常见的无效 YAML。
- `wiki-filename.ts` 对 CJK 文件名友好，避免中文 slug 被清空。

隐晦点：

- 文件名 slug 和 frontmatter title 是两套东西。slug 用于路径和 wikilink resolution，title 用于展示。
- 合并时锁 `title` 是为了避免用户认知和引用文案漂移。
- `sources[]` 不只是引用展示，也是图谱 relevance 的强信号。

## 10. 搜索实现

主要源码：

- `src/lib/search.ts`
- `src/lib/embedding.ts`
- `src/lib/context-budget.ts`
- `src/components/search/search-view.tsx`

当前搜索分两层：

```text
词法搜索 wiki/**/*.md
      |
      +--> filename exact
      +--> title phrase
      +--> content phrase
      +--> title token
      +--> content token
      |
      v
token rank

可选向量搜索 LanceDB chunks
      |
      v
vector rank

token rank + vector rank
      |
      v
RRF fusion
      |
      v
Top 20 SearchResult
```

### 10.1 Tokenizer

`tokenizeQuery()` 对中文做 bigram + 单字 + 原词：

```text
默会知识
  -> 默会, 会知, 知识, 默, 会, 知, 识, 默会知识
```

英文会按空白和标点切词，并过滤停用词。

为什么这样：

- 中文没有空格，单纯 substring 容易漏。
- bigram 对中文短语比单字更有区分度。
- 保留原词可以支持完整短语匹配。

### 10.2 词法评分

`scoreFile()` 的信号：

```text
filename exact              +200
title contains phrase        +50
content phrase occurrence    +20 each, capped at 10
title token match             +5 each
content token match           +1 each
```

这些分值只用于 token rank。最终会被 RRF 转成 rank 融合分，不会直接和向量 cosine 相加。

### 10.3 为什么不直接搜索 raw/sources

`search.ts` 里有一段明确注释：当前不再遍历 `raw/sources/`。

原因：

- 读取 PDF/DOCX/PPTX 会触发重型文本提取。
- 50 个 PDF 项目可能让每次搜索慢 5 到 15 秒。
- 已摄入 source 会生成 `wiki/sources/<slug>.md`，词法搜索能搜 summary。
- 完整原文可以进入 embedding chunks，由向量搜索补召回。

这是一个非常重要的取舍：交互搜索优先响应速度，原文深召回交给向量索引。

### 10.4 RRF 融合

RRF，即 Reciprocal Rank Fusion：

```text
fused(page) = 1 / (K + token_rank) + 1 / (K + vector_rank)
K = 60
```

中文注释版：

```ts
for (const page of candidates) {
  // token score 可能是 1 到 400，vector score 可能是 0 到 1。
  // 直接相加会让某一边天然占优，所以这里只用“排名”。
  if (page has tokenRank) score += 1 / (60 + tokenRank)
  if (page has vectorRank) score += 1 / (60 + vectorRank)
}
```

好处：

- token 和 vector 的分数尺度不同，也能稳定融合。
- 两边都靠前的页面会明显胜出。
- 只在一边靠前的页面也有机会进入结果。

### 10.5 Search UI 的图片结果

`SearchView` 不只显示页面，还会从 matched page 中抽取 `![alt](url)` 图片：

- caption 命中的图片优先展示。
- supporting images 默认折叠，避免 logo、页眉图稀释结果。
- 图片区域和页面列表是独立滚动区，防止图片网格把文本结果挤出屏幕。
- lightbox 可以跳回原始 source document。

## 11. 向量索引实现

主要源码：

- `src/lib/embedding.ts`
- `src/lib/text-chunker.ts`
- `src-tauri/src/commands/vectorstore.rs`

向量索引是 chunk 级 LanceDB，而不是整页一个向量。

```text
wiki page markdown
      |
      v
chunkMarkdown(targetChars, overlapChars)
      |
      v
for each chunk:
  embed(title + headingPath + chunkText)
      |
      v
vector_upsert_chunks(page_id, chunks)
      |
      v
LanceDB table wiki_chunks_v2
```

`wiki_chunks_v2` 关键字段：

```text
chunk_id       "${page_id}#${chunk_index}"
page_id        页面 slug
chunk_index    chunk 序号
chunk_text     chunk 原文
heading_path   chunk 所在标题路径
vector         embedding 向量
```

搜索流程：

```text
query
  |
  v
fetchEmbedding(query)
  |
  v
vector_search_chunks(query_embedding, topK * 3)
  |
  v
group by page_id
  |
  v
page_score = max(chunk_score) + capped(0.3 * tail_scores)
  |
  v
return page-level results
```

中文注释版 page 聚合：

```ts
for each pageId:
  // 最强 chunk 决定页面是否真正相关。
  const top = chunks[0].score

  // 其他 chunk 只能小幅加分，避免“很多弱 chunk”淹没“一段强命中”。
  const tail = sum(otherChunkScores)
  const blended = top + min(tail * 0.3, 1 - top)
```

Rust 侧隐晦点：

- v1 表 `wiki_vectors` 是 legacy per-page 表。
- v2 表 `wiki_chunks_v2` 是当前 chunk 表。
- upsert 语义是先删该 `page_id` 的旧 chunks，再插入新 chunks。
- `page_id` 做字符白名单校验，防止 LanceDB filter injection。
- TS 侧传给 Rust 前会把 float 转成 `Math.fround()`，保证向量类型一致。

Embedding 失败处理：

- endpoint 未配置或 model 为空：直接跳过。
- 输入过长：识别 413、context length、too long 等错误，自动 halve retry。
- 某个 chunk 失败：跳过该 chunk，不中断整页。
- 所有 chunk 失败：保留旧索引，不写空结果覆盖。

## 12. 聊天问答如何组装上下文

主要源码：`src/components/chat/chat-panel.tsx`

Chat 不是直接把全库塞给模型，而是分阶段组装上下文：

```text
用户问题
  |
  +--> isGreeting() ?
  |       |
  |       +--> 是：跳过检索，只简短问候
  |
  +--> read wiki/index.md + purpose.md
  |
  +--> searchWiki(query) -> top 10
  |
  +--> buildRetrievalGraph(dataVersion)
  |
  +--> getRelatedNodes(seed, limit=3)
  |
  +--> 按优先级塞入 page budget:
          P0 title matches
          P1 content matches
          P2 graph expansions
          P3 overview fallback
  |
  +--> system prompt:
          purpose
          trimmed index
          numbered page list
          numbered page contents
          citation rules
          output language rules
  |
  +--> streamChat()
```

Context budget 来自 `context-budget.ts`：

```text
maxCtx 100%
  |
  +-- indexBudget       5%
  +-- pageBudget       50%
  +-- responseReserve  15%
  +-- history/system   剩余空间，另由 maxHistoryMessages 控制
```

隐晦点：

- 问候语短路非常重要，否则“你好”可能检索出随机页面，导致回答看起来像幻觉。
- 语言提醒不是插入第二条 system message，而是加到最后一个 user message 前面。原因是部分 OpenAI-compatible 后端只允许 system 在 index 0。
- 模型被要求最后输出隐藏注释 `<!-- cited: 1, 3 -->`，UI 可以据此展示来源 chips。
- Graph expansion 只加 relevance >= 2.0 且不在 token hit 中的页面，避免无意义扩展。
- 页面按 `MAX_PAGE_SIZE` 截断，同时整体不能超过 `PAGE_BUDGET`。

## 13. Retrieval Graph：给问答扩展用的图

主要源码：`src/lib/graph-relevance.ts`

Retrieval graph 是轻量图结构，用于搜索结果扩展和边权计算。它扫描 `wiki/**/*.md`，提取：

- node id：文件名去 `.md`
- title / type / sources：frontmatter
- outLinks：正文 `[[wikilink]]`
- inLinks：反向链接

构建流程：

```text
list wiki/**/*.md
  |
  v
read each markdown
  |
  +--> parse frontmatter title/type/sources
  +--> extract [[wikilink]]
  |
  v
resolve wikilink target
  |
  v
nodes + inLinks + outLinks
  |
  v
cache by dataVersion
```

相关性四信号：

```text
directLink       * 3.0
sourceOverlap    * 4.0
commonNeighbor   * 1.5   Adamic-Adar
typeAffinity     * 1.0
```

中文注释版 relevance：

```ts
function calculateRelevance(a, b, graph) {
  // 直接链接：A 指向 B 或 B 指向 A，说明作者或 LLM 明确建立了关系。
  direct = (a.outLinks.has(b.id) + b.outLinks.has(a.id)) * 3.0

  // 来源重叠：两个页面来自同一份 source，通常比普通 wikilink 更强。
  source = countIntersection(a.sources, b.sources) * 4.0

  // 共同邻居：Adamic-Adar 会降低高频 hub 的影响。
  common = sum(1 / log(degree(neighbor))) * 1.5

  // 类型亲和：entity-concept、concept-synthesis 等关系有额外先验。
  type = TYPE_AFFINITY[a.type][b.type] * 1.0

  return direct + source + common + type
}
```

隐晦点：

- source overlap 权重最高，因为同源资料往往是可靠的局部相关性。
- common neighbor 用 Adamic-Adar，而不是简单共同邻居数量，避免 `index`、`overview` 类 hub 让所有页面都显得相关。
- `dataVersion` 是缓存是否可复用的关键。文件写入后必须 bump。

## 14. Wiki Graph：给前端图谱展示用的图

主要源码：

- `src/lib/wiki-graph.ts`
- `src/lib/graph-insights.ts`
- `src/components/graph/graph-view.tsx`
- `src/lib/graph-visibility.ts`

`wiki-graph.ts` 和 `graph-relevance.ts` 有重叠但用途不同：

```text
graph-relevance.ts
  面向 retrieval，轻量、缓存、给 Chat 扩展相关页面。

wiki-graph.ts
  面向 UI，可视化节点、边、社区、linkCount、community info。
```

构建流程：

```text
wiki/**/*.md
  |
  +--> extract title/type/wikilinks
  +--> 过滤 type=query 的中间产物
  +--> resolve links
  +--> dedupe undirected edges
  +--> buildRetrievalGraph()
  +--> calculateRelevance() as edge weight
  +--> Louvain community detection
  +--> compute cohesion per community
  |
  v
GraphNode[] + GraphEdge[] + CommunityInfo[]
```

社区检测：

- 使用 `graphology` 建无向图。
- 使用 `graphology-communities-louvain` 做 Louvain。
- 每个 community 计算 cohesion：

```text
cohesion = actual intra-community edges / possible intra-community edges
```

`graph-insights.ts` 计算两类洞察：

1. Surprising connections
   - 跨 community 边
   - 跨 type 边
   - peripheral node 到 hub
   - 低权重但存在的连接

2. Knowledge gaps
   - isolated node：linkCount <= 1
   - sparse community：cohesion < 0.15 且节点数 >= 3
   - bridge node：连接到 3 个以上 community

中文注释版：

```ts
function detectKnowledgeGaps(nodes, edges, communities) {
  // 孤立页面：几乎没有链接，说明这页没有融入知识网络。
  isolated = nodes.filter(n => n.linkCount <= 1)

  // 稀疏社区：看似一组知识，但内部互链弱，说明结构还没编好。
  sparse = communities.filter(c => c.cohesion < 0.15 && c.nodeCount >= 3)

  // 桥接节点：连接多个社区，是维护优先级很高的枢纽页面。
  bridge = nodes.filter(n => neighborCommunityCount(n) >= 3)
}
```

## 15. 图谱前端实现

主要源码：`src/components/graph/graph-view.tsx`

前端图谱使用：

- `sigma.js` 渲染
- `graphology` 数据结构
- ForceAtlas2 布局
- React state 管理 filters、color mode、hover、selection、hidden nodes

UI 行为：

```text
GraphView
  |
  +--> buildWikiGraph(project.path)
  |
  +--> GraphLoader
        |
        +--> graphology Graph
        +--> addNode(size=sqrt(linkCount), color=type/community)
        +--> addEdge(weight=relevance)
        +--> ForceAtlas2 layout
        +--> Sigma render
        +--> cache positions by dataKey
```

交互：

- hover 节点：邻居保持高亮，非邻居 dim。
- hover 边：显示 relevance score。
- 右键节点：隐藏节点。
- color mode：按 type 或 community 上色。
- filters：按类型筛选节点和边。
- insights：点击洞察卡片，高亮相关节点/边。
- position cache：数据没变时复用节点位置，减少图谱跳动。

隐晦点：

- 图谱展示不是简单“文件就是节点，链接就是边”，边权来自 retrieval relevance。
- `query` 类型节点被隐藏，因为它们是研究或聊天保存结果的中间产物，不代表稳定知识结构。
- layout 只在 `dataKey` 变化时重跑，否则每次 React render 都重排会导致用户失去空间记忆。
- 节点大小按 `sqrt(linkCount)`，避免 hub 节点过大。

ASCII 交互图：

```text
User hover node A
  |
  v
neighbors(A) = {B, C, D}
  |
  +--> A/B/C/D opacity = 1.0
  +--> other nodes opacity = dim
  +--> edges touching A highlighted

User right-click node A
  |
  v
hiddenNodeIds.add(A)
  |
  v
rebuild visible graph without A and edges touching A
```

## 16. Markdown 阅读与 wikilink 导航

主要源码：

- `src/components/editor/wiki-reader.tsx`
- `src/lib/wikilink-transform.ts`
- `src/lib/wiki-page-resolver.ts`
- `src/lib/markdown-image-resolver.ts`

`WikiReader` 是只读渲染器，刻意和编辑器分开：

- 阅读时可以把 `[[foo|label]]` 转成 Markdown anchor。
- 点击 anchor 时用 slug 在 `fileTree` 中解析目标文件，并 `setSelectedFile(path)`。
- 图片通过 `resolveMarkdownImageSrc()` 转成 Tauri 可显示 URL。
- 支持 GFM、数学公式、Mermaid。

隐晦点：

- 不在编辑器里直接 transform wikilink，否则保存时会把原始 `[[...]]` 改成普通 Markdown link，破坏 wiki 源格式。
- 图片 src 既可能是绝对路径，也可能是 `media/source/img.png` 这种 wiki-relative 路径。

## 17. UI 总体布局

主要源码：

- `src/components/layout/app-layout.tsx`
- `src/components/layout/icon-sidebar.tsx`
- `src/components/layout/content-area.tsx`
- `src/components/layout/sidebar-panel.tsx`
- `src/components/layout/preview-panel.tsx`

布局是桌面工具风格：

```text
+--------------------------------------------------------------+
| UpdateBanner                                                 |
+----+----------------+------------------------+---------------+
|icon| left sidebar   | center content         | right preview |
|nav | file/activity  | chat/search/graph/...  | file/research |
+----+----------------+------------------------+---------------+
```

实现细节：

- 左侧宽度默认 220，可拖动，硬限制 150 到 400。
- 右侧预览默认 400，可拖动，硬限制 250 到容器 50%。
- Settings 是全宽管理视图，会隐藏左侧文件树和右侧预览。
- Icon sidebar 使用 lucide 图标：Wiki、Sources、Search、Graph、Lint、Review、Settings。
- Activity panel 显示摄入队列状态。

这对 OpenAgents 知识库页面有直接借鉴意义：知识库管理不应只是表格，还需要 sources、wiki page、graph、preview、activity 这些工作区视图。

## 18. Lint、Review 与人类介入

源码分散在：

- `src/components/lint/*`
- `src/components/review/*`
- `src/stores/review-store.ts`
- `src/lib/ingest.ts`

摄入时 LLM 可以输出 review block，系统解析后写入 review store。Review item 用来承载：

- 模型发现的矛盾
- 需要人判断的合并
- 建议进一步搜索的问题
- 对 wiki 结构的建议

这个设计体现了 llm-wiki 的核心价值观：LLM 维护 wiki，但人类保留最终判断权。

## 19. 隐晦实现点清单

这些点是迁移或重构时最容易漏掉的。

1. `wiki/` 是默认问答真源，不是 raw source。

   raw source 读起来昂贵，而且格式多。当前源码明确避免在普通搜索里扫 raw。

2. FILE block 不是简单 regex。

   必须支持代码块、CRLF、大小写变体、未闭合 warning 和安全路径校验。

3. LLM 写文件路径必须限制在 `wiki/` 下。

   否则模型输出 `../../xxx` 就会变成安全问题。

4. cache 命中也不能盲信。

   必须检查上次写出的文件仍存在，否则会出现 ghost entry。

5. 页面合并要程序兜底。

   `sources/tags/related` union、`type/title/created` 锁定、正文缩水检查都不能只交给 LLM。

6. source 删除必须级联。

   只删 raw 文件会留下孤儿 wiki 页、孤儿 embedding、坏 wikilink、坏 related、坏 index。

7. graph cache 要和 dataVersion 绑定。

   写 wiki 后不 bump，图谱和 Chat expansion 会用旧结构。

8. 向量索引是 chunk 级。

   如果退回整页向量，长文档细粒度召回会变差。

9. RRF 用 rank，不用原始 score。

   token score 和 vector score 尺度不同，直接相加不稳定。

10. Chat 的语言提醒放在最后 user message 里。

    这是为了兼容只允许 system 在第一条的 OpenAI-compatible 后端。

11. 图谱 UI 需要 position cache。

    没有缓存，任何小状态更新都可能让整张图重排，用户很难排查和理解。

12. Search UI 的图片召回依赖 caption。

    如果摄入时只保留 `![](path)` 空 alt，搜索图像时几乎没有语义。

13. README 可能落后于源码。

    例如 raw/sources 搜索策略已经改变，迁移时必须读源码。

## 20. 与传统 RAG 的关键差别

```text
传统 RAG
  source documents
      |
      v
  chunk + embed
      |
      v
  query time retrieve chunks
      |
      v
  LLM answer

llm-wiki
  source documents
      |
      v
  compile once into wiki pages
      |
      +--> human-readable markdown
      +--> wikilinks
      +--> sources frontmatter
      +--> graph structure
      +--> optional embeddings
      |
      v
  query time retrieve wiki pages + graph expansions
      |
      v
  LLM answer with page citations
```

llm-wiki 的优点：

- 多文档知识会被预先整理成实体、概念、source summary，而不是每次临时拼 chunk。
- 用户可以直接审查和编辑中间知识层。
- 图谱、审查、搜索、聊天共享同一套 Markdown 真源。
- 对“一个知识库里很多文档”的场景更容易形成跨文档关系。

代价：

- 编译慢，尤其是 LLM 分析和多模态 caption。
- 编译质量依赖模型和 schema/purpose。
- 需要处理增量、合并、删除、缓存、队列恢复等复杂生命周期。
- 如果编译阶段失败或过度总结，后续检索再强也会受影响。

## 21. 对 OpenAgents 重构的实现启示

如果 OpenAgents 要彻底迁移到 llm-wiki 风格，建议保留这些核心机制，而不是只复制 UI：

1. 文件真源

   每个知识库应该有统一 workspace：

   ```text
   /知识库名称/Wiki Workspace/
     raw/sources/
     wiki/
     .llm-wiki/
     schema.md
     purpose.md
   ```

2. 后台 worker 编译

   编译必须异步队列化，支持恢复、取消、重试、进度事件。不要让浏览器请求持有整个 LLM 编译过程。

3. 单 source 编译 + 增量合并

   一次处理一个 source，写出 file blocks，然后 merge 到既有 wiki。这样比“整库重新编译”可控。

4. Agent 默认检索 `wiki/**/*.md`

   raw source 可作为 evidence preview 或向量深召回，不应成为默认问答全量扫描对象。

5. 图谱从 wiki 派生

   graph 不要独立手工维护。应由 `wikilink + sources + type` 重新构建。

6. Source preview 必须保留

   回答引用、图片、页面都要能跳回原始 source 或 canonical evidence，否则用户无法审查。

7. UI 要工作区化

   知识库管理页需要至少包含：Sources、Wiki pages、Search、Graph、Build activity、Preview。单一表格无法承载 llm-wiki 的调试需求。

8. 对象存储可以承载 workspace 文件

   llm-wiki 原版是本地文件夹。OpenAgents 可以把同样结构落到 Knowledge Asset Store / MinIO，但对编译 worker 和 agent 工具暴露时，仍应 materialize 成文件树视图。

## 22. 最小可迁移内核

如果要分阶段实现，最小闭环不是图谱，而是下面这条：

```text
上传 source
  |
  v
后台队列 autoIngest
  |
  v
LLM 输出 FILE blocks
  |
  v
安全解析 + 写入 wiki/
  |
  v
agent searchWiki(wiki/)
  |
  v
回答引用 wiki page + source preview
```

然后再逐步加：

```text
page merge
  -> ingest cache
  -> image extraction/caption
  -> vector chunk index
  -> retrieval graph
  -> graph UI
  -> insights/review
```

这样可以避免一上来同时做编译、图谱、向量、前端全部复杂化。

## 23. 源码阅读索引

建议按这个顺序读源码：

```text
1. src/App.tsx
   理解项目打开、状态恢复、队列恢复。

2. src/stores/wiki-store.ts
   理解全局状态和 dataVersion。

3. src/components/sources/sources-view.tsx
   理解用户如何导入文件/目录。

4. src/lib/source-lifecycle.ts
   理解导入、删除、source 到 wiki 的生命周期。

5. src/lib/ingest-queue.ts
   理解持久队列、恢复、取消、重试。

6. src/lib/ingest.ts
   理解两步 LLM 编译、FILE block、写入、review、embedding hook。

7. src/lib/page-merge.ts
   理解多 source 写同一页面时如何避免数据丢失。

8. src/lib/ingest-cache.ts
   理解 source hash cache 和 stale cache 检查。

9. src/lib/extract-source-images.ts
   理解 PDF/Office 图片提取如何落到 wiki/media。

10. src/lib/image-caption-pipeline.ts
    理解 caption cache、alt text rewrite、图片搜索基础。

11. src/lib/search.ts
    理解 token search、RRF、为什么不扫 raw。

12. src/lib/embedding.ts
    理解 chunk embedding、LanceDB 调用、page-level 聚合。

13. src-tauri/src/commands/vectorstore.rs
    理解 LanceDB v2 表、upsert/delete/search 和 page_id 安全校验。

14. src/lib/graph-relevance.ts
    理解 retrieval graph 和四信号 relevance。

15. src/lib/wiki-graph.ts
    理解 UI graph、Louvain community、cohesion。

16. src/lib/graph-insights.ts
    理解 surprising connections 和 knowledge gaps。

17. src/components/graph/graph-view.tsx
    理解 Sigma/ForceAtlas2 前端图谱交互。

18. src/components/chat/chat-panel.tsx
    理解问答上下文如何从 search + graph + budget 组装。

19. src/components/search/search-view.tsx
    理解搜索页面和图片 lightbox。

20. src/components/editor/wiki-reader.tsx
    理解 wikilink、图片、Mermaid、数学公式的只读渲染。
```

## 24. 结论

llm-wiki 的核心不是“多了一个知识图谱界面”，而是一条完整的编译链路：

```text
原始资料 -> LLM 编译 -> Markdown wiki 真源 -> 检索/图谱/聊天/审查共用
```

它的实现强在几个工程细节：

- 编译输出直接成为可读可改的 Markdown 文件。
- 增量队列、hash cache、page merge 让多文档知识库可维护。
- `sources[] + wikilink + type` 让检索和图谱共享结构信号。
- chunk 级向量搜索补足语义召回，但不抢走文件真源地位。
- 前端不是简单 CRUD，而是一个可审查、可预览、可图谱探索的知识工作区。

迁移时最不能丢的是这些“生命周期约束”：安全写入、增量合并、删除级联、缓存失效、图谱重建、source preview。只复制编译 prompt 或图谱 UI，都无法复现 llm-wiki 的稳定性。
