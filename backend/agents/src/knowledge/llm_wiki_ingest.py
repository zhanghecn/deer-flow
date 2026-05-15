from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from src.knowledge.models import IndexedDocument, QueuedKnowledgeBuildJob
from src.models import create_chat_model

OPENER_LINE_RE = re.compile(r"^---\s*FILE\s*:\s*(.+?)\s*---\s*$", re.IGNORECASE)
CLOSER_LINE_RE = re.compile(r"^---\s*END\s+FILE\s*---\s*$", re.IGNORECASE)
FENCE_LINE_RE = re.compile(r"^\s{0,3}(```+|~~~+)")
FRONTMATTER_RE = re.compile(r"^(---\n)(?P<body>[\s\S]*?)(\n---)", re.MULTILINE)
OUTER_CODE_FENCE_RE = re.compile(r"^```(?:markdown|md|yaml)?\s*\n(?P<body>[\s\S]*?)\n```\s*$", re.IGNORECASE)
ARRAY_FIELD_RE_TEMPLATE = r"^{field}:\s*\[(?P<inline>[^\]]*)\]\s*$|^{field}:\s*\n(?P<block>(?:\s+-\s+.+\n?)*)"
SCALAR_FIELD_RE_TEMPLATE = r"^{field}:\s*(?P<value>[^\n]*)$"
WIKI_ALLOWED_DIRS = (
    "wiki/sources/",
    "wiki/entities/",
    "wiki/concepts/",
    "wiki/comparisons/",
    "wiki/synthesis/",
    "wiki/queries/",
)
WIKI_GLOBAL_PATHS = {"wiki/index.md", "wiki/overview.md", "wiki/log.md"}
WIKI_PAGE_LINK_RE = re.compile(
    r"\[\[(?P<target>wiki/(?:sources|entities|concepts|comparisons|synthesis|queries)/[^\]|\n]+?)(?:\.md)?(?:\|(?P<alias>[^\]\n]+))?\]\]"
)
WIKI_RELATED_PATH_RE = re.compile(
    r"wiki/(?:sources|entities|concepts|comparisons|synthesis|queries)/[^\"'\],\n]+?\.md"
)
FRONTMATTER_WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]")
UNION_FIELDS = ("sources", "tags", "related")
LOCKED_FIELDS = ("type", "title", "created")
MAX_LLM_SOURCE_CHARS = 90_000
MAX_NODE_CONTEXT_CHARS = 40_000


@dataclass(frozen=True)
class GeneratedWikiFile:
    path: str
    content: str


@dataclass(frozen=True)
class LlmWikiIngestResult:
    files: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    analysis_chars: int = 0


def build_analysis_prompt(
    *,
    purpose: str,
    index: str,
    source_content: str,
) -> str:
    return "\n".join(
        part
        for part in [
            "You are an expert research analyst. Read the source document and produce a structured analysis.",
            "Do not output chain-of-thought, hidden reasoning, or a thinking transcript. Reason internally and write only the concise final analysis.",
            "",
            _language_rule(source_content),
            "",
            "Your analysis should cover:",
            "",
            "## Key Entities",
            "List people, organizations, products, datasets, tools mentioned. For each include its role and whether it likely already exists in the wiki.",
            "",
            "## Key Concepts",
            "List theories, methods, techniques, doctrines, facts, cases, and reusable concepts. For each include why it matters in this source.",
            "",
            "## Main Arguments & Findings",
            "Summarize core claims, evidence, caveats, and distinctive details.",
            "",
            "## Connections to Existing Wiki",
            "Identify existing pages this source strengthens, challenges, or extends.",
            "",
            "## Recommendations",
            "Recommend wiki pages to create or update. Prefer durable entity/concept/synthesis pages over one-off snippets.",
            "",
            "Be thorough but concise. Focus on facts that improve retrieval across many documents.",
            "",
            f"## Wiki Purpose\n{purpose}" if purpose else "",
            f"## Current Wiki Index\n{index}" if index else "",
            f"## Source Content\n{source_content}",
        ]
        if part
    )


def build_generation_prompt(
    *,
    schema: str,
    purpose: str,
    index: str,
    source_file_name: str,
    source_page_path: str,
    overview: str,
    analysis: str,
    source_content: str,
) -> str:
    return "\n".join(
        part
        for part in [
            "You are a wiki maintainer. Based on the analysis, generate llm-wiki FILE blocks.",
            "Do not output chain-of-thought, hidden reasoning, or explanatory preamble. Output only FILE blocks.",
            "",
            _language_rule(source_content),
            "",
            "## Source File",
            f"The original source file is: {source_file_name}",
            f"The canonical source summary path is: {source_page_path}",
            "Every generated page must include this source filename in frontmatter `sources`.",
            "",
            "## What To Generate",
            "Generate the same durable workspace artifacts llm-wiki expects:",
            f"1. A source summary page at exactly {source_page_path}",
            "2. Entity pages in wiki/entities/ for key named objects, people, texts, cases, or other domain entities",
            "3. Concept pages in wiki/concepts/ for reusable doctrines, methods, patterns, terms, and case types",
            "4. Comparison pages in wiki/comparisons/ when the source directly contrasts cases, rules, or interpretations",
            "5. Synthesis pages in wiki/synthesis/ when the source updates cross-document conclusions",
            "6. Query pages in wiki/queries/ only when the source itself is a saved investigation or Q&A output",
            "7. An updated wiki/index.md that preserves existing entries and adds the new pages",
            "8. An updated wiki/overview.md with a high-level 2-5 paragraph summary of the whole workspace",
            "9. A wiki/log.md FILE block containing only the new ingest log entry to append",
            "",
            "Allowed page folders:",
            "- wiki/sources/",
            "- wiki/entities/",
            "- wiki/concepts/",
            "- wiki/comparisons/",
            "- wiki/synthesis/",
            "- wiki/queries/",
            "- wiki/index.md",
            "- wiki/overview.md",
            "- wiki/log.md",
            "",
            "Do not generate raw files, .llm-wiki files, media files, or arbitrary paths.",
            "",
            "## Frontmatter Rules",
            "Every generated wiki page except wiki/log.md must begin with YAML frontmatter.",
            "Required fields: type, title, created, updated, tags, related, sources.",
            "type must be one of: source | entity | concept | comparison | synthesis | index | overview.",
            "sources must include the original source filename.",
            "Use [[wikilink]] syntax only in the body, not in frontmatter.",
            "When a page lists a slug in frontmatter `related`, the body must also explain that relationship with a matching [[slug]] wikilink.",
            "If `related` is not empty, include a short `## Related` section with one bullet per [[slug]].",
            "",
            "Example:",
            "---FILE: wiki/concepts/example-concept.md---",
            "---",
            "type: concept",
            "title: Example Concept",
            "created: 2026-05-15",
            "updated: 2026-05-15",
            "tags: [example]",
            "related: []",
            f"sources: [\"{source_file_name}\"]",
            "---",
            "",
            "# Example Concept",
            "",
            "Body content with [[related-page]] references.",
            "---END FILE---",
            "",
            f"## Wiki Purpose\n{purpose}" if purpose else "",
            f"## Wiki Schema\n{schema}" if schema else "",
            f"## Current Wiki Index\n{index}" if index else "",
            f"## Current Overview\n{overview}" if overview else "",
            f"## Analysis\n{analysis}",
            "",
            "## Original Source Content",
            source_content,
            "",
            "## Output Format",
            "The first character of your response must be `-` from `---FILE:`.",
            "Between blocks, use only blank lines. Do not output any text outside FILE blocks.",
        ]
        if part
    )


def generate_llm_wiki_files(
    *,
    job: QueuedKnowledgeBuildJob,
    indexed_document: IndexedDocument,
    purpose: str,
    schema: str,
    index: str,
    overview: str,
    source_page_path: str,
) -> LlmWikiIngestResult:
    model_name = str(job.model_name or "").strip()
    if not model_name:
        return LlmWikiIngestResult(warnings=["missing model_name; skipped llm_wiki generation"])

    source_content = bounded_source_content(indexed_document)
    model = create_chat_model(
        name=model_name,
        thinking_enabled=False,
        temperature=0,
        max_output_tokens=12_000,
    )
    analysis = _message_content_to_text(
        model.invoke(
            [
                SystemMessage(content="You produce concise source analyses for a generated wiki."),
                HumanMessage(content=build_analysis_prompt(purpose=purpose, index=index, source_content=source_content)),
            ]
        )
    )
    generated = _message_content_to_text(
        model.invoke(
            [
                SystemMessage(content="You emit parseable llm-wiki FILE blocks and nothing else."),
                HumanMessage(
                    content=build_generation_prompt(
                        schema=schema,
                        purpose=purpose,
                        index=index,
                        source_file_name=job.file_name,
                        source_page_path=source_page_path,
                        overview=overview,
                        analysis=analysis,
                        source_content=source_content,
                    )
                ),
            ]
        )
    )
    files, warnings = parse_file_blocks(generated)
    if not files:
        retry_text = _message_content_to_text(
            model.invoke(
                [
                    SystemMessage(content="You repair invalid llm-wiki output into parseable FILE blocks."),
                    HumanMessage(
                        content=(
                            "Your previous response did not contain parseable FILE blocks.\n"
                            "Rewrite it now. Output only blocks in this exact form:\n\n"
                            "---FILE: wiki/concepts/example.md---\n"
                            "---\n"
                            "type: concept\n"
                            "title: Example\n"
                            "created: 2026-05-15\n"
                            "updated: 2026-05-15\n"
                            "tags: [example]\n"
                            "related: []\n"
                            f"sources: [\"{job.file_name}\"]\n"
                            "---\n\n"
                            "# Example\n\n"
                            "Body.\n"
                            "---END FILE---\n\n"
                            f"Also include the source summary at exactly {source_page_path} when possible.\n"
                            "Allowed paths: wiki/sources/, wiki/entities/, wiki/concepts/, wiki/comparisons/, "
                            "wiki/synthesis/, wiki/queries/, wiki/index.md, wiki/overview.md, wiki/log.md.\n"
                            "Do not include prose outside blocks.\n\n"
                            "Previous invalid response:\n"
                            f"{generated[:4000]}"
                        )
                    ),
                ]
            )
        )
        retry_files, retry_warnings = parse_file_blocks(retry_text)
        warnings = [*warnings, "retried invalid FILE block output", *retry_warnings]
        files = retry_files
    return LlmWikiIngestResult(files=files, warnings=warnings, analysis_chars=len(analysis))


def bounded_source_content(indexed_document: IndexedDocument) -> str:
    canonical = indexed_document.canonical_markdown.strip()
    if len(canonical) <= MAX_LLM_SOURCE_CHARS:
        return canonical

    node_context: list[str] = []
    used = 0
    for node in indexed_document.nodes:
        summary = node.summary or node.visual_summary or node.prefix_summary or ""
        excerpt = (node.node_text or "").strip()[:900]
        block = f"## {node.title}\n{summary}\n\n{excerpt}".strip()
        if not block:
            continue
        if used + len(block) > MAX_NODE_CONTEXT_CHARS:
            break
        node_context.append(block)
        used += len(block)

    head_budget = max(20_000, (MAX_LLM_SOURCE_CHARS - used) // 2)
    tail_budget = max(12_000, MAX_LLM_SOURCE_CHARS - used - head_budget)
    return "\n\n".join(
        part
        for part in [
            canonical[:head_budget].rstrip(),
            "\n\n[Middle of long source omitted; structured node summaries follow.]\n",
            "\n\n".join(node_context),
            "\n\n[End excerpt]\n",
            canonical[-tail_budget:].lstrip(),
        ]
        if part
    )


def parse_file_blocks(text: str) -> tuple[dict[str, str], list[str]]:
    files: dict[str, str] = {}
    warnings: list[str] = []
    for raw_path, raw_content, block_warnings in _iter_file_blocks(text or ""):
        warnings.extend(block_warnings)
        content = sanitize_ingested_file_content(raw_content.strip())
        try:
            path = normalize_generated_wiki_path(raw_path)
        except ValueError as exc:
            warnings.append(f"skipped {raw_path}: {exc}")
            continue
        if path != "wiki/log.md" and not FRONTMATTER_RE.match(content):
            warnings.append(f"skipped {path}: missing YAML frontmatter")
            continue
        files[path] = content.rstrip() + "\n"
    if not files:
        warnings.append("no valid FILE blocks parsed")
    return files, warnings


def _iter_file_blocks(text: str) -> list[tuple[str, str, list[str]]]:
    normalized = text.replace("\r\n", "\n")
    lines = normalized.split("\n")
    blocks: list[tuple[str, str, list[str]]] = []
    index = 0
    while index < len(lines):
        opener = OPENER_LINE_RE.match(lines[index].strip())
        if opener is None:
            index += 1
            continue
        raw_path = opener.group(1).strip()
        index += 1
        content_lines: list[str] = []
        warnings: list[str] = []
        fence_char: str | None = None
        fence_len = 0
        closed = False
        while index < len(lines):
            line = lines[index]
            fence = FENCE_LINE_RE.match(line)
            if fence is not None:
                run = fence.group(1)
                char = run[0]
                if fence_char is None:
                    fence_char = char
                    fence_len = len(run)
                elif char == fence_char and len(run) >= fence_len:
                    fence_char = None
                    fence_len = 0
                content_lines.append(line)
                index += 1
                continue
            if fence_char is None and CLOSER_LINE_RE.match(line.strip()):
                closed = True
                index += 1
                break
            content_lines.append(line)
            index += 1
        if not closed:
            warnings.append(f"FILE block {raw_path or '(unnamed)'} was not closed before end of stream")
            continue
        # llm_wiki treats FILE markers as line-level protocol tokens, not a
        # regex over arbitrary text. This keeps literal END markers inside
        # fenced code blocks from truncating generated pages.
        blocks.append((raw_path, "\n".join(content_lines), warnings))
    return blocks


def _strip_outer_code_fence(content: str) -> str:
    match = OUTER_CODE_FENCE_RE.match(content)
    if not match:
        return content
    return match.group("body").strip()


def sanitize_ingested_file_content(content: str) -> str:
    """Normalize recurring llm-wiki FILE block corruptions before validation.

    This mirrors llm_wiki's write-boundary sanitizer: provider output often
    wraps the whole page in a markdown/yaml fence, prefixes `frontmatter:`, or
    emits invalid wikilink lists in YAML frontmatter. Fixing those shapes here
    keeps the compiled workspace canonical instead of carrying parser fallbacks.
    """

    cleaned = _strip_outer_code_fence(content)
    cleaned = re.sub(r"^[ \t]*frontmatter\s*:\s*\n(?=[ \t]*---\s*\n)", "", cleaned)
    cleaned = _repair_wikilink_lists_in_frontmatter(cleaned)
    cleaned = _normalize_related_frontmatter(cleaned)
    cleaned = _ensure_related_body_wikilinks(cleaned)
    return _normalize_body_wiki_path_links(cleaned)


def _repair_wikilink_lists_in_frontmatter(content: str) -> str:
    match = re.match(r"^---\s*\n(?P<body>[\s\S]*?)\n---\s*(?P<tail>\n|$)", content)
    if not match:
        return content

    def repair_line(line: str) -> str:
        line_match = re.match(
            r"^(\s*[A-Za-z_][\w-]*\s*:\s*)(\[\[[^\]]+\]\](?:\s*,\s*\[\[[^\]]+\]\])+)\s*$",
            line,
        )
        if not line_match:
            return line
        items = [item.strip() for item in line_match.group(2).split(",") if item.strip()]
        quoted = ", ".join(json.dumps(item, ensure_ascii=False) for item in items)
        return f"{line_match.group(1)}[{quoted}]"

    repaired = "\n".join(repair_line(line) for line in match.group("body").splitlines())
    return f"---\n{repaired}\n---{content[match.end('body') + 4:]}"


def _normalize_related_frontmatter(content: str) -> str:
    match = re.match(r"^---\s*\n(?P<body>[\s\S]*?)\n---\s*(?P<tail>\n|$)", content)
    if not match:
        return content

    lines = match.group("body").splitlines()
    normalized_lines: list[str] = []
    index = 0

    def refs_from_value(value: str) -> list[str]:
        refs = [_path_to_wiki_slug(path) for path in WIKI_RELATED_PATH_RE.findall(value)]
        refs.extend(_path_to_wiki_slug(item) for item in FRONTMATTER_WIKILINK_RE.findall(value))
        if refs:
            return _dedupe_texts(refs)
        inline = value.strip()
        if inline.startswith("[") and inline.endswith("]"):
            items = [item.strip().strip("\"'") for item in inline.strip("[]").split(",")]
            return _dedupe_texts([_path_to_wiki_slug(item) for item in items if item])
        return []

    while index < len(lines):
        line = lines[index]
        line_match = re.match(r"^(\s*related\s*:\s*)(?P<value>.+?)\s*$", line)
        if line_match:
            refs = refs_from_value(line_match.group("value"))
            if refs:
                quoted = ", ".join(json.dumps(ref, ensure_ascii=False) for ref in refs)
                normalized_lines.append(f"{line_match.group(1).rstrip()} [{quoted}]")
            else:
                normalized_lines.append(line)
            index += 1
            continue

        block_match = re.match(r"^(\s*related\s*:\s*)$", line)
        if block_match:
            block_refs: list[str] = []
            next_index = index + 1
            while next_index < len(lines):
                item_match = re.match(r"^\s*-\s*(?P<value>.+?)\s*$", lines[next_index])
                if item_match is None:
                    break
                item_refs = refs_from_value(item_match.group("value"))
                if item_refs:
                    block_refs.extend(item_refs)
                else:
                    cleaned = item_match.group("value").strip().strip("\"'")
                    if cleaned:
                        block_refs.append(_path_to_wiki_slug(cleaned))
                next_index += 1
            refs = _dedupe_texts(block_refs)
            if refs:
                quoted = ", ".join(json.dumps(ref, ensure_ascii=False) for ref in refs)
                normalized_lines.append(f"{block_match.group(1).rstrip()} [{quoted}]")
                index = next_index
                continue

        normalized_lines.append(line)
        index += 1

    repaired = "\n".join(normalized_lines)
    return f"---\n{repaired}\n---{content[match.end('body') + 4:]}"


def _normalize_body_wiki_path_links(content: str) -> str:
    def replace(match: re.Match[str]) -> str:
        slug = _path_to_wiki_slug(match.group("target"))
        alias = (match.group("alias") or "").strip()
        return f"[[{slug}|{alias}]]" if alias else f"[[{slug}]]"

    return WIKI_PAGE_LINK_RE.sub(replace, content)


def _ensure_related_body_wikilinks(content: str) -> str:
    """Materialize frontmatter relationships into body wikilinks.

    llm_wiki's graph is driven by `[[wikilink]]` references. Some providers
    obey `related` frontmatter but omit the matching body link, leaving the
    rendered graph connected only through `index.md`. Enforcing the body link
    at the write boundary makes the workspace graph-readable even when model
    output is partially compliant.
    """

    related = _frontmatter_array(content, "related")
    if not related:
        return content
    body = _frontmatter_body(content)
    existing_links = {
        _path_to_wiki_slug(match.group(1))
        for match in FRONTMATTER_WIKILINK_RE.finditer(body)
    }
    missing = [
        _path_to_wiki_slug(item)
        for item in related
        if _path_to_wiki_slug(item) and _path_to_wiki_slug(item) not in existing_links
    ]
    if not missing:
        return content
    bullets = "\n".join(f"- [[{item}]]" for item in _dedupe_texts(missing))
    return content.rstrip() + "\n\n## Related\n\n" + bullets + "\n"


def _path_to_wiki_slug(value: str) -> str:
    cleaned = str(value or "").strip().strip("\"'").replace("\\", "/")
    cleaned = cleaned.removesuffix(".md")
    return PurePosixPath(cleaned).name


def _dedupe_texts(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        result.append(cleaned)
        seen.add(cleaned)
    return result


def normalize_generated_wiki_path(raw_path: str) -> str:
    normalized = PurePosixPath(str(raw_path or "").replace("\\", "/")).as_posix().lstrip("/")
    if normalized in {"", "."}:
        raise ValueError("path is required")
    if normalized == ".." or normalized.startswith("../") or "/../" in normalized:
        raise ValueError("path must stay within the wiki workspace")
    if not normalized.endswith(".md"):
        raise ValueError("path must end with .md")
    if normalized not in WIKI_GLOBAL_PATHS and not normalized.startswith(WIKI_ALLOWED_DIRS):
        raise ValueError("path must be under an allowed wiki folder")
    return normalized


def merge_page_content(
    *,
    new_content: str,
    existing_content: str | None,
    source_file_name: str,
    today: str,
) -> str:
    if not existing_content:
        return ensure_source_in_frontmatter(new_content, source_file_name)
    if new_content == existing_content:
        return existing_content

    merged = ensure_source_in_frontmatter(new_content, source_file_name)
    old_body = _frontmatter_body(existing_content)
    new_body = _frontmatter_body(merged)
    if old_body.strip() and old_body.strip() != new_body.strip():
        merged = _replace_body(
            merged,
            (
                new_body.rstrip()
                + "\n\n## Previously Integrated Notes\n\n"
                + old_body.strip()
                + "\n"
            ),
        )

    for field_name in UNION_FIELDS:
        values = _frontmatter_array(existing_content, field_name)
        values.extend(_frontmatter_array(merged, field_name))
        if field_name == "sources" and source_file_name not in values:
            values.append(source_file_name)
        merged = _set_frontmatter_array(merged, field_name, _dedupe(values))

    for field_name in LOCKED_FIELDS:
        value = _frontmatter_scalar(existing_content, field_name)
        if value:
            merged = _set_frontmatter_scalar(merged, field_name, value)
    merged = _set_frontmatter_scalar(merged, "updated", today)
    return merged.rstrip() + "\n"


def ensure_source_in_frontmatter(content: str, source_file_name: str) -> str:
    sources = _frontmatter_array(content, "sources")
    if source_file_name not in sources:
        sources.append(source_file_name)
    return _set_frontmatter_array(content, "sources", _dedupe(sources)).rstrip() + "\n"


def remove_source_from_frontmatter(content: str, source_file_name: str) -> tuple[str, bool]:
    sources = [source for source in _frontmatter_array(content, "sources") if source != source_file_name]
    if not sources:
        return content, True
    return _set_frontmatter_array(content, "sources", sources), False


def _language_rule(source_content: str) -> str:
    cjk_count = sum(1 for char in source_content[:8000] if "\u4e00" <= char <= "\u9fff")
    if cjk_count >= 80:
        return "Mandatory output language: Chinese. Preserve original Chinese technical terms."
    return "Mandatory output language: English, unless the source itself is predominantly another language."


def _message_content_to_text(message: Any) -> str:
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if text:
                    parts.append(str(text))
            elif item is not None:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content or "")


def _frontmatter_match(content: str) -> re.Match[str] | None:
    return FRONTMATTER_RE.match(content or "")


def _frontmatter_body(content: str) -> str:
    match = _frontmatter_match(content)
    if not match:
        return content
    return content[match.end() :].lstrip("\n")


def _replace_body(content: str, body: str) -> str:
    match = _frontmatter_match(content)
    if not match:
        return body
    return content[: match.end()] + "\n\n" + body.rstrip() + "\n"


def _frontmatter_text(content: str) -> str:
    match = _frontmatter_match(content)
    return match.group("body") if match else ""


def _frontmatter_array(content: str, field_name: str) -> list[str]:
    pattern = re.compile(ARRAY_FIELD_RE_TEMPLATE.format(field=re.escape(field_name)), re.MULTILINE)
    match = pattern.search(_frontmatter_text(content))
    if not match:
        return []
    values: list[str] = []
    inline = match.groupdict().get("inline")
    if inline is not None:
        values.extend(_clean_array_item(item) for item in inline.split(","))
    block = match.groupdict().get("block")
    if block is not None:
        for line in block.splitlines():
            values.append(_clean_array_item(line.strip().removeprefix("-")))
    return [value for value in values if value]


def _frontmatter_scalar(content: str, field_name: str) -> str | None:
    pattern = re.compile(SCALAR_FIELD_RE_TEMPLATE.format(field=re.escape(field_name)), re.MULTILINE)
    match = pattern.search(_frontmatter_text(content))
    if not match:
        return None
    return _clean_array_item(match.group("value"))


def _set_frontmatter_array(content: str, field_name: str, values: list[str]) -> str:
    match = _frontmatter_match(content)
    if not match:
        return content
    fm_body = match.group("body")
    escaped = re.escape(field_name)
    replacement = f"{field_name}: [{', '.join(_quote_array_item(value) for value in values)}]"
    block_pattern = re.compile(ARRAY_FIELD_RE_TEMPLATE.format(field=escaped), re.MULTILINE)
    if block_pattern.search(fm_body):
        fm_body = block_pattern.sub(replacement, fm_body, count=1)
    else:
        fm_body = fm_body.rstrip() + "\n" + replacement
    return f"---\n{fm_body}\n---{content[match.end():]}"


def _set_frontmatter_scalar(content: str, field_name: str, value: str) -> str:
    match = _frontmatter_match(content)
    if not match:
        return content
    fm_body = match.group("body")
    escaped = re.escape(field_name)
    replacement = f"{field_name}: {value}"
    scalar_pattern = re.compile(SCALAR_FIELD_RE_TEMPLATE.format(field=escaped), re.MULTILINE)
    if scalar_pattern.search(fm_body):
        fm_body = scalar_pattern.sub(replacement, fm_body, count=1)
    else:
        fm_body = fm_body.rstrip() + "\n" + replacement
    return f"---\n{fm_body}\n---{content[match.end():]}"


def _clean_array_item(value: str) -> str:
    return str(value or "").strip().strip("\"'").strip()


def _quote_array_item(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = _clean_array_item(value)
        if not cleaned or cleaned in seen:
            continue
        result.append(cleaned)
        seen.add(cleaned)
    return result
