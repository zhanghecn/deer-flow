from __future__ import annotations

import re
from pathlib import Path
from typing import NamedTuple

from src.knowledge.models import KnowledgeDocumentRecord

_LOOKUP_NORMALIZE_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff]+")
_BRACKET_REFERENCE_RE = re.compile(
    r"(?:^|[\s([{（【])@(?:knowledge|kb|doc|document)\[([^\]\n]+)\]",
    re.IGNORECASE,
)
_QUOTED_REFERENCE_RE = re.compile(
    r"""(?:^|[\s([{（【])@["“'`]([^"”'`\n]+)["”'`]""",
)
_INLINE_REFERENCE_RE = re.compile(
    r"(?:^|[\s([{（【])@([^\s,，。:：;；!！?？()（）[\]{}<>《》]+)"
)


class ResolvedKnowledgeReferences(NamedTuple):
    matched: tuple[KnowledgeDocumentRecord, ...]
    unresolved: tuple[str, ...]


def extract_knowledge_document_mentions(text: str | None) -> tuple[str, ...]:
    if not text:
        return ()

    resolved: list[str] = []
    seen: set[str] = set()
    matched_ranges: list[tuple[int, int]] = []
    structured_matches: list[tuple[int, str]] = []

    def push(value: str) -> None:
        normalized = value.strip()
        if not normalized:
            return
        key = normalized.casefold()
        if key in seen:
            return
        seen.add(key)
        resolved.append(normalized)

    for pattern in (_BRACKET_REFERENCE_RE, _QUOTED_REFERENCE_RE):
        for match in pattern.finditer(text):
            value = (match.group(1) or "").strip()
            if not value:
                continue
            matched_ranges.append(match.span())
            structured_matches.append((match.start(), value))

    for match in _INLINE_REFERENCE_RE.finditer(text):
        value = (match.group(1) or "").strip()
        if not value:
            continue
        span = match.span()
        if any(span[0] < end and span[1] > start for start, end in matched_ranges):
            continue
        if value.casefold() in {"knowledge", "kb", "doc", "document"}:
            continue
        structured_matches.append((match.start(), value))

    structured_matches.sort(key=lambda item: item[0])
    for _start, value in structured_matches:
        push(value)

    return tuple(resolved)


def resolve_knowledge_document_mentions(
    *,
    documents: list[KnowledgeDocumentRecord],
    mentions: tuple[str, ...] | list[str],
) -> ResolvedKnowledgeReferences:
    ready_documents = [document for document in documents if document.status == "ready"]
    if not ready_documents or not mentions:
        return ResolvedKnowledgeReferences(matched=(), unresolved=tuple(mentions))

    matched: list[KnowledgeDocumentRecord] = []
    unresolved: list[str] = []
    seen_document_ids: set[str] = set()

    for mention in mentions:
        document = _resolve_single_mention(ready_documents, mention)
        if document is None:
            unresolved.append(mention)
            continue
        if document.id in seen_document_ids:
            continue
        matched.append(document)
        seen_document_ids.add(document.id)

    return ResolvedKnowledgeReferences(
        matched=tuple(matched),
        unresolved=tuple(unresolved),
    )


def _resolve_single_mention(
    documents: list[KnowledgeDocumentRecord],
    mention: str,
) -> KnowledgeDocumentRecord | None:
    casefolded = mention.strip().casefold()
    if not casefolded:
        return None

    exact_matches = [
        document
        for document in documents
        if casefolded in _document_aliases_casefold(document)
    ]
    if len(exact_matches) == 1:
        return exact_matches[0]
    if len(exact_matches) > 1:
        return None

    normalized = _lookup_key(mention)
    if not normalized:
        return None

    normalized_matches = [
        document
        for document in documents
        if normalized in _document_aliases_lookup(document)
    ]
    if len(normalized_matches) == 1:
        return normalized_matches[0]
    if len(normalized_matches) > 1:
        return None

    contains_matches = [
        document
        for document in documents
        if any(
            casefolded in alias or normalized in _lookup_key(alias)
            for alias in _document_aliases_casefold(document)
        )
    ]
    if len(contains_matches) == 1:
        return contains_matches[0]
    return None


def _lookup_key(value: str) -> str:
    return _LOOKUP_NORMALIZE_RE.sub("", value.casefold())


def _document_aliases_casefold(document: KnowledgeDocumentRecord) -> tuple[str, ...]:
    names = {document.display_name.strip()}
    stem = Path(document.display_name).stem.strip()
    if stem:
        names.add(stem)
    return tuple(name.casefold() for name in names if name)


def _document_aliases_lookup(document: KnowledgeDocumentRecord) -> tuple[str, ...]:
    return tuple(
        key
        for key in (_lookup_key(alias) for alias in _document_aliases_casefold(document))
        if key
    )
