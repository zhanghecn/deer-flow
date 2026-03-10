import os
from collections.abc import Iterable, Sequence
from pathlib import Path


def resolve_relative_to_config_dir(value: str | Path, *, config_dir: Path) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (config_dir / path).resolve()


def _resolve_supplied_path(raw_path: str, *, source_name: str) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"{source_name} not found at {path}")
    return path


def _search_roots(max_parent_depth: int = 3) -> Iterable[Path]:
    current = Path.cwd().resolve()
    yield current

    depth = 0
    for parent in current.parents:
        if depth >= max_parent_depth:
            break
        yield parent
        depth += 1


def resolve_config_file(
    *,
    config_path: str | None,
    env_var_name: str,
    default_filenames: Sequence[str],
    max_parent_depth: int = 3,
) -> Path | None:
    if config_path:
        return _resolve_supplied_path(
            config_path,
            source_name="Config file specified by param `config_path`",
        )

    env_path = os.getenv(env_var_name)
    if env_path:
        return _resolve_supplied_path(
            env_path,
            source_name=f"Config file specified by environment variable `{env_var_name}`",
        )

    for directory in _search_roots(max_parent_depth=max_parent_depth):
        for filename in default_filenames:
            candidate = directory / filename
            if candidate.exists():
                return candidate

    return None
