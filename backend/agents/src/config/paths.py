import os
import re
from pathlib import Path

from src.config.app_config import load_path_config

# Virtual path prefix seen by agents inside the sandbox
VIRTUAL_PATH_PREFIX = "/mnt/user-data"

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
_RUNTIME_DIR_MODE = 0o777


def _resolve_explicit_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


class Paths:
    """
    Centralized path builder for OpenAgents application data.

    Directory layout (host side):
        {base_dir}/
        ├── agents/                          # Agent definitions (shared across all users)
        │   ├── prod/{agent-name}/
        │   │   ├── config.yaml
        │   │   ├── AGENTS.md                # Agent-owned system prompt / personality
        │   │   └── skills/{skill-name}/SKILL.md   # Copied skill snapshots for this agent
        │   └── dev/{agent-name}/
        │       ├── config.yaml
        │       ├── AGENTS.md
        │       └── skills/{skill-name}/SKILL.md
        ├── skills/                          # Global OpenAgents skills
        │   ├── shared/{skill-name}/SKILL.md
        │   └── store/
        │       ├── dev/{skill-name}/SKILL.md
        │       └── prod/{skill-name}/SKILL.md
        ├── users/{user_id}/                 # Per-user data
        │   ├── USER.md
        │   └── agents/{status}/{agent-name}/memory.json
        └── threads/{thread_id}/             # Per-thread runtime data
            └── user-data/
                ├── workspace/
                ├── uploads/
                └── outputs/
    """

    def __init__(self, base_dir: str | Path, *, skills_dir: str | Path | None = None) -> None:
        self._base_dir = _resolve_explicit_path(base_dir)
        self._skills_dir = _resolve_explicit_path(skills_dir) if skills_dir is not None else None

    @property
    def base_dir(self) -> Path:
        """Root directory for all application data."""
        return self._base_dir

    # ── User profile ──

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

    def agent_config_file(self, name: str, status: str = "dev") -> Path:
        """Path to an agent config manifest."""
        return self.agent_dir(name, status) / "config.yaml"

    def agent_agents_md_file(self, name: str, status: str = "dev") -> Path:
        """Path to the agent-owned AGENTS.md file."""
        return self.agent_dir(name, status) / "AGENTS.md"

    def agent_skills_dir(self, name: str, status: str = "dev") -> Path:
        """Directory containing skills materialized for an agent."""
        return self.agent_dir(name, status) / "skills"

    # ── User layer (per-user data) ──

    def user_dir(self, user_id: str) -> Path:
        """Directory for a user: `{base_dir}/users/{user_id}/`."""
        if not _SAFE_ID_RE.match(user_id):
            raise ValueError(f"Invalid user_id {user_id!r}")
        return self.base_dir / "users" / user_id

    def user_agent_memory_file(self, user_id: str, agent_name: str, status: str = "dev") -> Path:
        """Per-user per-agent memory file."""
        return self.user_dir(user_id) / "agents" / status / agent_name.lower() / "memory.json"

    # ── Global skills ──

    @property
    def skills_dir(self) -> Path:
        """Root directory for global skills."""
        if self._skills_dir is None:
            raise RuntimeError("Skills directory is not configured. Set skills.path in config.yaml or pass skills_dir explicitly.")
        return self._skills_dir

    @property
    def shared_skills_dir(self) -> Path:
        return self.skills_dir / "shared"

    @property
    def store_dev_skills_dir(self) -> Path:
        return self.skills_dir / "store" / "dev"

    @property
    def store_prod_skills_dir(self) -> Path:
        return self.skills_dir / "store" / "prod"

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

    def sandbox_agents_dir(self, thread_id: str) -> Path:
        return self.thread_dir(thread_id) / "user-data" / "agents"

    def sandbox_authoring_dir(self, thread_id: str) -> Path:
        return self.thread_dir(thread_id) / "user-data" / "authoring"

    def sandbox_authoring_agents_dir(self, thread_id: str) -> Path:
        return self.sandbox_authoring_dir(thread_id) / "agents"

    def sandbox_authoring_skills_dir(self, thread_id: str) -> Path:
        return self.sandbox_authoring_dir(thread_id) / "skills"

    def sandbox_user_data_dir(self, thread_id: str) -> Path:
        return self.thread_dir(thread_id) / "user-data"

    # ── Remote relay layer (shared across runtime + remote clients) ──

    @property
    def remote_dir(self) -> Path:
        return self.base_dir / "remote"

    @property
    def remote_sessions_dir(self) -> Path:
        return self.remote_dir / "sessions"

    def remote_session_dir(self, session_id: str) -> Path:
        if not _SAFE_ID_RE.match(session_id):
            raise ValueError(f"Invalid session_id {session_id!r}")
        return self.remote_sessions_dir / session_id

    def ensure_thread_dirs(self, thread_id: str) -> None:
        """Create all standard sandbox directories for a thread."""
        runtime_dirs = (
            self.sandbox_user_data_dir(thread_id),
            self.sandbox_work_dir(thread_id),
            self.sandbox_uploads_dir(thread_id),
            self.sandbox_outputs_dir(thread_id),
            self.sandbox_agents_dir(thread_id),
            self.sandbox_authoring_dir(thread_id),
            self.sandbox_authoring_agents_dir(thread_id),
            self.sandbox_authoring_skills_dir(thread_id),
        )
        for runtime_dir in runtime_dirs:
            _ensure_runtime_dir(runtime_dir)

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
    """Return the global Paths singleton (lazy-initialized from app config)."""
    global _paths
    if _paths is None:
        config, config_dir = load_path_config()
        _paths = Paths(
            base_dir=config.storage.resolve_base_dir(config_dir),
            skills_dir=config.skills.get_skills_path(config_dir),
        )
    return _paths


def reset_paths() -> None:
    global _paths
    _paths = None


def _ensure_runtime_dir(path: Path) -> None:
    """Keep runtime mounts writable for containerized sandbox users.

    The AIO sandbox image serves file APIs as a non-root user, while local
    debugging creates the host thread directories as the current host user. We
    normalize the runtime tree to a permissive mode so `/mnt/user-data/...`
    stays writable in both environments.
    """

    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, _RUNTIME_DIR_MODE)
