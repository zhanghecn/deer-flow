from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def runtime_context_value(runtime_context: object, key: str, default: Any = None) -> Any:
    """Read a runtime context value from either a mapping or a typed context object."""

    if runtime_context is None:
        return default

    if isinstance(runtime_context, Mapping):
        return runtime_context.get(key, default)

    getter = getattr(runtime_context, "get", None)
    if callable(getter):
        try:
            return getter(key, default)
        except TypeError:
            pass

    dumped = getattr(runtime_context, "model_dump", None)
    if callable(dumped):
        data = dumped(by_alias=True)
        if isinstance(data, Mapping):
            return data.get(key, default)

    return getattr(runtime_context, key, default)
