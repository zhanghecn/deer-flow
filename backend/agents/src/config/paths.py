import os
import re
from pathlib import Path

# Virtual path prefix seen by agents inside the sandbox
VIRTUAL_PATH_PREFIX = "/mnt/user-data"
AGENTS_ROOT = Path(__file__).resolve().parents[2]

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


def _normalize_base_dir(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return AGENTS_ROOT / path


class Paths:
    """
    Centralized path configuration for OpenAgents application data.

    Directory layout (host side):
        {base_dir}/
        ├── agents/                          # Agent definitions (shared across all users)
        │   ├── prod/{agent-name}/
        │   │   ├── config.yaml
        │   │   ├── AGENTS.md                # System prompt / personality
        │   │   └── skills/{skill-name}/SKILL.md
        │   └── dev/{agent-name}/
        │       ├── config.yaml
        │       ├── AGENTS.md
        │       └── skills/{skill-name}/SKILL.md
        ├── skills/                          # Global public skills
        │   ├── public/{skill-name}/SKILL.md
        │   └── custom/{skill-name}/SKILL.md
        ├── users/{user_id}/                 # Per-user data
        │   ├── memory.json
        │   └── USER.md
        └── threads/{thread_id}/             # Per-thread runtime data
            └── user-data/
                ├── workspace/
                ├── uploads/
                └── outputs/

    BaseDir resolution (in priority order):
        1. Constructor argument `base_dir`
        2. OPENAGENTS_HOME environment variable
        3. Local dev fallback: {backend/agents}/.openagents
    Notes:
        - Relative paths are resolved against the backend/agents root.
        - This avoids runtime `cwd` resolution, which can trigger blocking guards.
    """

    def __init__(self, base_dir: str | Path | None = None) -> None:
        self._base_dir = _normalize_base_dir(base_dir) if base_dir is not None else None

    @property
    def base_dir(self) -> Path:
        """Root directory for all application data."""
        if self._base_dir is not None:
            return self._base_dir

        if env_home := os.getenv("OPENAGENTS_HOME"):
            return _normalize_base_dir(env_home)

        return AGENTS_ROOT / ".openagents"

    # ── Legacy compat (global memory / user profile for single-user mode) ──

    @property
    def memory_file(self) -> Path:
        """Path to the persisted memory file: `{base_dir}/memory.json`."""
        return self.base_dir / "memory.json"

    @property
    def user_md_file(self) -> Path:
        """Path to the global user profile file: `{base_dir}/USER.md`."""
        return self.base_dir / "USER.md"

    # ── Agent definition layer (shared across all users) ──

    @property
    def agents_dir(self) -> Path:
        """Root directory for all agents: `{base_dir}/agents/`."""
        return self.base_dir / "agents"

    def agent_dir(self, name: str, status: str = "dev") -> Path:
        """Directory for an agent: `{base_dir}/agents/{status}/{name}/`."""
        return self.agents_dir / status / name.lower()

    def agent_memory_file(self, name: str, status: str = "dev") -> Path:
        """Per-agent memory file (legacy compat)."""
        return self.agent_dir(name, status) / "memory.json"

    # ── User layer (per-user data) ──

    def user_dir(self, user_id: str) -> Path:
        """Directory for a user: `{base_dir}/users/{user_id}/`."""
        if not _SAFE_ID_RE.match(user_id):
            raise ValueError(f"Invalid user_id {user_id!r}")
        return self.base_dir / "users" / user_id

    def user_memory_file(self, user_id: str) -> Path:
        """Per-user memory file: `{base_dir}/users/{user_id}/memory.json`."""
        return self.user_dir(user_id) / "memory.json"

    # ── Global skills ──

    @property
    def skills_dir(self) -> Path:
        """Root directory for global skills (public + custom)."""
        # Locate project-root skills/ by walking upward from OPENAGENTS_HOME.
        for parent in self.base_dir.parents:
            candidate = parent / "skills"
            if candidate.exists():
                return candidate
        return self.base_dir.parent / "skills"

    # ── Thread runtime layer (per-thread isolated) ──

    def thread_dir(self, thread_id: str) -> Path:
        """Host path for a thread's data: `{base_dir}/threads/{thread_id}/`."""
        if not _SAFE_ID_RE.match(thread_id):
            raise ValueError(f"Invalid thread_id {thread_id!r}: only alphanumeric characters, hyphens, and underscores are allowed.")
        return self.base_dir / "threads" / thread_id

    def sandbox_work_dir(self, thread_id: str) -> Path:
        return self.thread_dir(thread_id) / "user-data" / "workspace"

    def sandbox_uploads_dir(self, thread_id: str) -> Path:
        return self.thread_dir(thread_id) / "user-data" / "uploads"

    def sandbox_outputs_dir(self, thread_id: str) -> Path:
        return self.thread_dir(thread_id) / "user-data" / "outputs"

    def sandbox_user_data_dir(self, thread_id: str) -> Path:
        return self.thread_dir(thread_id) / "user-data"

    def ensure_thread_dirs(self, thread_id: str) -> None:
        """Create all standard sandbox directories for a thread."""
        self.sandbox_work_dir(thread_id).mkdir(parents=True, exist_ok=True)
        self.sandbox_uploads_dir(thread_id).mkdir(parents=True, exist_ok=True)
        self.sandbox_outputs_dir(thread_id).mkdir(parents=True, exist_ok=True)

    def resolve_virtual_path(self, thread_id: str, virtual_path: str) -> Path:
        """Resolve a sandbox virtual path to the actual host filesystem path."""
        stripped = virtual_path.lstrip("/")
        prefix = VIRTUAL_PATH_PREFIX.lstrip("/")

        if stripped != prefix and not stripped.startswith(prefix + "/"):
            raise ValueError(f"Path must start with /{prefix}")

        relative = stripped[len(prefix) :].lstrip("/")
        base = self.sandbox_user_data_dir(thread_id).resolve()
        actual = (base / relative).resolve()

        try:
            actual.relative_to(base)
        except ValueError:
            raise ValueError("Access denied: path traversal detected")

        return actual


# ── Singleton ────────────────────────────────────────────────────────────

_paths: Paths | None = None


def get_paths() -> Paths:
    """Return the global Paths singleton (lazy-initialized)."""
    global _paths
    if _paths is None:
        _paths = Paths()
    return _paths
