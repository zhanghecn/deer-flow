from __future__ import annotations

import re

from src.knowledge.models import KnowledgeWorkspaceRecord

KNOWLEDGE_RUNTIME_MOUNT = "/mnt/user-data/knowledge"

_UNSAFE_MOUNT_CHARS_RE = re.compile(r"[^\w\u3400-\u9fff.-]+", re.UNICODE)


def knowledge_workspace_mount_name(workspace: KnowledgeWorkspaceRecord) -> str:
    """Return the stable agent-visible directory name for one attached workspace.

    The human-readable name keeps `ls` output understandable, while the full
    workspace id suffix prevents same-name libraries from colliding inside a
    thread. This is runtime path presentation only; storage refs remain opaque.
    """

    display_name = str(workspace.name or workspace.id or "knowledge").strip()
    safe_name = _UNSAFE_MOUNT_CHARS_RE.sub("-", display_name).strip(".-_")
    if not safe_name:
        safe_name = "knowledge"
    return f"{safe_name}__{workspace.id}"


def knowledge_workspace_mount_path(workspace: KnowledgeWorkspaceRecord) -> str:
    return f"{KNOWLEDGE_RUNTIME_MOUNT}/{knowledge_workspace_mount_name(workspace)}"
