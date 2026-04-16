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
        ├── system/                          # Git-tracked authored baselines
        │   ├── agents/{status}/{agent-name}/
        │   └── skills/{skill-name}/
        ├── custom/                          # Dynamic authored assets
        │   ├── agents/{status}/{agent-name}/
        │   └── skills/{skill-name}/
        └── runtime/                         # Disposable materialized/runtime data
            ├── agents/{status}/{agent-name}/
            ├── threads/{thread_id}/
            ├── users/{user_id}/
            └── knowledge/

    The authored/runtime split below is the canonical contract. Legacy flat
    roots still appear only in dedicated migration helpers and tests; runtime
    code should reason about `system`, `custom`, and `runtime` explicitly.
    """

    def __init__(self, base_dir: str | Path, *, skills_dir: str | Path | None = None) -> None:
        self._base_dir = _resolve_explicit_path(base_dir)
        self._skills_dir = _resolve_explicit_path(skills_dir) if skills_dir is not None else None

    @property
    def base_dir(self) -> Path:
        """Root directory for all application data."""
        return self._base_dir

    # ── Authored source-of-truth layers ──

    @property
    def system_dir(self) -> Path:
        """Git-tracked platform-authored assets."""
        return self.base_dir / "system"

    @property
    def custom_dir(self) -> Path:
        """Writable custom-authored assets created by users or agents."""
        return self.base_dir / "custom"

    @property
    def runtime_dir(self) -> Path:
        """Disposable runtime state and materialized outputs."""
        return self.base_dir / "runtime"

    @property
    def system_agents_dir(self) -> Path:
        return self.system_dir / "agents"

    @property
    def custom_agents_dir(self) -> Path:
        return self.custom_dir / "agents"

    @property
    def runtime_agents_dir(self) -> Path:
        return self.runtime_dir / "agents"

    def system_agent_dir(self, name: str, status: str = "dev") -> Path:
        return self.system_agents_dir / status / name.lower()

    def custom_agent_dir(self, name: str, status: str = "dev") -> Path:
        return self.custom_agents_dir / status / name.lower()

    def runtime_agent_dir(self, name: str, status: str = "dev") -> Path:
        return self.runtime_agents_dir / status / name.lower()

    def system_agent_skills_dir(self, name: str, status: str = "dev") -> Path:
        return self.system_agent_dir(name, status) / "skills"

    def custom_agent_skills_dir(self, name: str, status: str = "dev") -> Path:
        return self.custom_agent_dir(name, status) / "skills"

    def runtime_agent_skills_dir(self, name: str, status: str = "dev") -> Path:
        return self.runtime_agent_dir(name, status) / "skills"

    @property
    def system_skills_dir(self) -> Path:
        return self.system_dir / "skills"

    @property
    def custom_skills_dir(self) -> Path:
        return self.custom_dir / "skills"

    @property
    def system_mcp_profiles_dir(self) -> Path:
        """Git-tracked reusable MCP profile library."""
        return self.system_dir / "mcp-profiles"

    @property
    def custom_mcp_profiles_dir(self) -> Path:
        """Writable reusable MCP profile library."""
        return self.custom_dir / "mcp-profiles"

    def system_skill_dir(self, skill_name: str | Path) -> Path:
        return self.system_skills_dir / Path(skill_name)

    def custom_skill_dir(self, skill_name: str | Path) -> Path:
        return self.custom_skills_dir / Path(skill_name)

    def system_mcp_profile_file(self, profile_name: str | Path) -> Path:
        """Canonical file path for a system MCP profile JSON document."""
        relative = Path(profile_name)
        suffix = relative.suffix
        if suffix.lower() != ".json":
            relative = relative.with_suffix(".json")
        return self.system_mcp_profiles_dir / relative

    def custom_mcp_profile_file(self, profile_name: str | Path) -> Path:
        """Canonical file path for a custom MCP profile JSON document."""
        relative = Path(profile_name)
        suffix = relative.suffix
        if suffix.lower() != ".json":
            relative = relative.with_suffix(".json")
        return self.custom_mcp_profiles_dir / relative

    @property
    def runtime_threads_dir(self) -> Path:
        return self.runtime_dir / "threads"

    @property
    def runtime_users_dir(self) -> Path:
        return self.runtime_dir / "users"

    @property
    def runtime_knowledge_dir(self) -> Path:
        return self.runtime_dir / "knowledge"

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
    def legacy_skills_dir(self) -> Path:
        """Best-effort root for the retired `.openagents/skills` library tree.

        The canonical authored layout now lives under `{base_dir}/system` and
        `{base_dir}/custom`, but some migration and compatibility flows still
        need to inspect the historical `skills/store/...` tree. `skills.path`
        may point either at `.openagents` or at `.openagents/skills`, so keep
        the legacy-root resolution centralized here.
        """

        direct_root = self.skills_dir
        nested_root = self.skills_dir / "skills"

        if (direct_root / "store").exists():
            return direct_root
        if nested_root.exists():
            return nested_root
        if direct_root.name == "skills":
            return direct_root
        return nested_root

    @property
    def store_dev_skills_dir(self) -> Path:
        return self.legacy_skills_dir / "store" / "dev"

    @property
    def store_prod_skills_dir(self) -> Path:
        return self.legacy_skills_dir / "store" / "prod"

    @property
    def commands_dir(self) -> Path:
        """Root directory for shared slash-command definitions."""
        return self.base_dir / "commands"

    @property
    def common_commands_dir(self) -> Path:
        return self.commands_dir / "common"

    def common_command_file(self, name: str) -> Path:
        return self.common_commands_dir / f"{name}.md"

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

    @property
    def runtime_tmp_dir(self) -> Path:
        """Shared runtime temp scratch visible to every agent/backend.

        Unlike `workspace`, `uploads`, and `outputs`, this directory is not
        thread-bound. It is the intentional cross-agent scratch area behind the
        virtual `/mnt/user-data/tmp` contract.
        """

        return self.runtime_dir / "tmp"

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
            self.runtime_tmp_dir,
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

        shared_tmp_prefix = f"{prefix}/tmp"
        if stripped == shared_tmp_prefix or stripped.startswith(f"{shared_tmp_prefix}/"):
            relative = stripped[len(shared_tmp_prefix) :].lstrip("/")
            base = self.runtime_tmp_dir.resolve()
        else:
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
