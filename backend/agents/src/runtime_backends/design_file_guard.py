from __future__ import annotations

import json
from typing import Any

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import (
    BackendProtocol,
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileInfo,
    FileUploadResponse,
    GrepMatch,
    SandboxBackendProtocol,
    WriteResult,
)

_OPENPENCIL_DOCUMENT_PREFIX = "/mnt/user-data/outputs/designs/"
_OPENPENCIL_DOCUMENT_SUFFIX = ".op"
_JUSTIFY_CONTENT_MAP = {
    "space-between": "space_between",
    "space-around": "space_around",
    "flex-start": "start",
    "flex-end": "end",
}
_ALIGN_ITEMS_MAP = {
    "flex-start": "start",
    "flex-end": "end",
}


def _is_openpencil_document_path(file_path: str) -> bool:
    normalized = str(file_path or "").strip()
    return normalized.startswith(_OPENPENCIL_DOCUMENT_PREFIX) and normalized.endswith(
        _OPENPENCIL_DOCUMENT_SUFFIX
    )


def _coerce_numeric_value(value: Any) -> Any:
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("$"):
            return stripped
        try:
            if "." in stripped:
                return float(stripped)
            return int(stripped)
        except ValueError:
            return value
    return value


def _normalize_gradient_stops(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        return []

    normalized: list[dict[str, Any]] = []
    stop_count = len(raw)
    for index, stop in enumerate(raw):
        if not isinstance(stop, dict):
            continue
        offset = stop.get("offset", stop.get("position"))
        if isinstance(offset, (int, float)) and offset > 1:
            offset = offset / 100
        if not isinstance(offset, (int, float)):
            offset = index / max(stop_count - 1, 1)
        normalized.append(
            {
                "offset": max(0, min(1, float(offset))),
                "color": str(stop.get("color", "#000000")),
            }
        )
    return normalized


def _normalize_single_fill(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, str):
        stripped = raw.strip()
        if not stripped:
            return None
        return {"type": "solid", "color": stripped}
    if not isinstance(raw, dict):
        return None

    fill_type = raw.get("type")
    if fill_type in (None, "color", "solid") and "color" in raw:
        normalized = {
            "type": "solid",
            "color": str(raw.get("color", "#000000")),
        }
        if "opacity" in raw:
            normalized["opacity"] = _coerce_numeric_value(raw["opacity"])
        if "blendMode" in raw:
            normalized["blendMode"] = raw["blendMode"]
        return normalized

    if fill_type == "gradient":
        gradient_type = str(raw.get("gradientType", "linear"))
        stops = _normalize_gradient_stops(raw.get("colors"))
        if gradient_type == "radial":
            center = raw.get("center") if isinstance(raw.get("center"), dict) else {}
            return {
                "type": "radial_gradient",
                "cx": _coerce_numeric_value(center.get("x", 0.5)),
                "cy": _coerce_numeric_value(center.get("y", 0.5)),
                "radius": 0.5,
                "stops": stops,
            }
        return {
            "type": "linear_gradient",
            "angle": _coerce_numeric_value(raw.get("rotation", 0)),
            "stops": stops,
        }

    if fill_type in {"linear_gradient", "radial_gradient"}:
        normalized = dict(raw)
        normalized["stops"] = _normalize_gradient_stops(
            raw.get("stops", raw.get("colors"))
        )
        return normalized

    if fill_type == "image":
        return dict(raw)

    if "color" in raw:
        return {
            "type": "solid",
            "color": str(raw.get("color", "#000000")),
        }
    return None


def _normalize_fills(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [fill for item in raw if (fill := _normalize_single_fill(item)) is not None]
    fill = _normalize_single_fill(raw)
    return [] if fill is None else [fill]


def _normalize_stroke(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    normalized = dict(raw)
    if "fill" in normalized or "color" in normalized:
        stroke_fill = normalized.get("fill", normalized.get("color"))
        normalized["fill"] = _normalize_fills(stroke_fill)
        normalized.pop("color", None)
    if "thickness" not in normalized and "width" in normalized:
        normalized["thickness"] = normalized.pop("width")
    if "thickness" in normalized:
        normalized["thickness"] = _coerce_numeric_value(normalized["thickness"])
    return normalized


def _normalize_padding(raw: Any) -> Any:
    if isinstance(raw, dict):
        # Runtime models often emit CSS-like padding objects. Convert them into
        # the OpenPencil tuple forms so the editor and renderer keep a single
        # canonical schema on disk.
        vertical = _coerce_numeric_value(raw.get("vertical", raw.get("y", 0)))
        horizontal = _coerce_numeric_value(raw.get("horizontal", raw.get("x", 0)))
        top = _coerce_numeric_value(raw.get("top", vertical))
        right = _coerce_numeric_value(raw.get("right", horizontal))
        bottom = _coerce_numeric_value(raw.get("bottom", vertical))
        left = _coerce_numeric_value(raw.get("left", horizontal))
        if top == right == bottom == left:
            return top
        if top == bottom and right == left:
            return [top, right]
        return [top, right, bottom, left]
    if isinstance(raw, list):
        return [_coerce_numeric_value(item) for item in raw]
    return _coerce_numeric_value(raw)


def _normalize_effects(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        effect = dict(item)
        effect_type = effect.get("type")
        if effect_type == "shadow":
            effect.setdefault("offsetX", 0)
            effect.setdefault("offsetY", 0)
            effect.setdefault("spread", 0)
        elif effect_type in {"blur", "background_blur"} and "radius" not in effect and "blur" in effect:
            effect["radius"] = effect.pop("blur")
        normalized.append(effect)
    return normalized


def _normalize_pen_node(node: Any) -> Any:
    if not isinstance(node, dict):
        return node

    normalized = dict(node)
    if "fill" in normalized:
        normalized["fill"] = _normalize_fills(normalized.get("fill"))
    if "stroke" in normalized:
        normalized_stroke = _normalize_stroke(normalized.get("stroke"))
        if normalized_stroke is None:
            normalized.pop("stroke", None)
        else:
            normalized["stroke"] = normalized_stroke
    if "effects" in normalized:
        normalized["effects"] = _normalize_effects(normalized.get("effects"))
    if "padding" in normalized:
        normalized["padding"] = _normalize_padding(normalized.get("padding"))
    if "width" in normalized:
        normalized["width"] = _coerce_numeric_value(normalized["width"])
    if "height" in normalized:
        normalized["height"] = _coerce_numeric_value(normalized["height"])
    if "justifyContent" in normalized and isinstance(normalized["justifyContent"], str):
        normalized["justifyContent"] = _JUSTIFY_CONTENT_MAP.get(
            normalized["justifyContent"],
            normalized["justifyContent"],
        )
    if "alignItems" in normalized and isinstance(normalized["alignItems"], str):
        normalized["alignItems"] = _ALIGN_ITEMS_MAP.get(
            normalized["alignItems"],
            normalized["alignItems"],
        )
    if normalized.get("type") == "text" and "content" not in normalized and isinstance(normalized.get("text"), str):
        normalized["content"] = normalized.pop("text")
    if isinstance(normalized.get("children"), list):
        normalized["children"] = [
            _normalize_pen_node(child) for child in normalized["children"]
        ]
    return normalized


def _normalize_openpencil_document_object(document: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(document)
    if isinstance(normalized.get("children"), list):
        normalized["children"] = [
            _normalize_pen_node(child) for child in normalized["children"]
        ]
    if isinstance(normalized.get("pages"), list):
        normalized_pages: list[dict[str, Any]] = []
        for page in normalized["pages"]:
            if not isinstance(page, dict):
                normalized_pages.append(page)
                continue
            normalized_page = dict(page)
            if isinstance(normalized_page.get("children"), list):
                normalized_page["children"] = [
                    _normalize_pen_node(child) for child in normalized_page["children"]
                ]
            normalized_pages.append(normalized_page)
        normalized["pages"] = normalized_pages
    return normalized


def _normalize_openpencil_document(content: str) -> str:
    """Return the canonical on-disk OpenPencil JSON representation.

    The design board and the runtime agent both edit the same `.op` file. Keep
    that file as validated pretty JSON so:
    - invalid model output is rejected before it corrupts the shared document
    - follow-up `read_file` / `edit_file` turns can operate on readable line
      boundaries instead of a single giant minified line
    """

    try:
        document = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "OpenPencil design documents must be valid JSON. "
            f"JSON parser error: {exc.msg}"
        ) from exc

    if not isinstance(document, dict):
        raise ValueError("OpenPencil design documents must be a JSON object.")

    document = _normalize_openpencil_document_object(document)

    version = document.get("version")
    if not isinstance(version, str) or not version.strip():
        raise ValueError(
            "OpenPencil design documents must include a non-empty string `version`."
        )

    children = document.get("children")
    pages = document.get("pages")
    if not isinstance(children, list) and not isinstance(pages, list):
        raise ValueError(
            "OpenPencil design documents must include a `children` or `pages` array."
        )

    return json.dumps(
        document,
        ensure_ascii=False,
        indent=2,
    ) + "\n"


class DesignFileGuardBackend(BackendProtocol):
    """Backend wrapper that protects shared design artifacts from invalid writes."""

    def __init__(self, wrapped_backend: BackendProtocol) -> None:
        self.__wrapped_backend__ = wrapped_backend

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped_backend__, name)

    def ls_info(self, path: str) -> list[FileInfo]:
        return self.__wrapped_backend__.ls_info(path)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        return self.__wrapped_backend__.read(file_path, offset=offset, limit=limit)

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        return self.__wrapped_backend__.grep_raw(pattern, path=path, glob=glob)

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        return self.__wrapped_backend__.glob_info(pattern, path=path)

    def write(self, file_path: str, content: str) -> WriteResult:
        normalized_content = content
        if _is_openpencil_document_path(file_path):
            try:
                normalized_content = _normalize_openpencil_document(content)
            except ValueError as exc:
                return WriteResult(error=f"Error: {exc}")
        return self.__wrapped_backend__.write(file_path, normalized_content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        if not _is_openpencil_document_path(file_path):
            return self.__wrapped_backend__.edit(
                file_path,
                old_string,
                new_string,
                replace_all=replace_all,
            )

        existing = self.__wrapped_backend__.download_files([file_path])[0]
        if existing.error == "file_not_found":
            return EditResult(error=f"Error: File '{file_path}' not found")
        if existing.error is not None or existing.content is None:
            return EditResult(error=f"Failed to edit file '{file_path}'")

        content = existing.content.decode("utf-8", errors="replace")
        occurrences = content.count(old_string)
        if occurrences == 0:
            return EditResult(error=f"Error: String not found in file: '{old_string}'")
        if occurrences > 1 and not replace_all:
            return EditResult(
                error=(
                    f"Error: String '{old_string}' appears multiple times. "
                    "Use replace_all=true to replace all occurrences."
                )
            )

        candidate = (
            content.replace(old_string, new_string)
            if replace_all
            else content.replace(old_string, new_string, 1)
        )
        try:
            normalized_candidate = _normalize_openpencil_document(candidate)
        except ValueError as exc:
            return EditResult(error=f"Error: {exc}")

        # The guard validates the fully edited document, so the wrapped backend
        # must replace the whole file with that canonical candidate. Replacing
        # only `old_string` with the normalized full document would duplicate
        # large suffixes and corrupt `.op` JSON on disk.
        return self.__wrapped_backend__.edit(
            file_path,
            content,
            normalized_candidate,
            replace_all=False,
        )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return self.__wrapped_backend__.upload_files(files)

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return self.__wrapped_backend__.download_files(paths)


class DesignFileGuardSandboxBackend(DesignFileGuardBackend, SandboxBackendProtocol):
    @property
    def id(self) -> str:
        return str(getattr(self.__wrapped_backend__, "id"))

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        return self.__wrapped_backend__.execute(command, timeout=timeout)


def wrap_runtime_backend_with_design_file_guard(backend: BackendProtocol) -> BackendProtocol:
    """Protect canonical design artifacts regardless of the runtime backend kind."""

    if isinstance(backend, (DesignFileGuardBackend, DesignFileGuardSandboxBackend)):
        return backend
    if isinstance(backend, CompositeBackend):
        # Preserve routed backend shape so existing callers can still address
        # `default` and per-prefix routes exactly as before. Only the writable
        # default runtime backend needs the design-file guard.
        return CompositeBackend(
            default=wrap_runtime_backend_with_design_file_guard(backend.default),
            routes=backend.routes,
        )
    if isinstance(backend, SandboxBackendProtocol):
        return DesignFileGuardSandboxBackend(backend)
    return DesignFileGuardBackend(backend)


__all__ = [
    "DesignFileGuardBackend",
    "DesignFileGuardSandboxBackend",
    "wrap_runtime_backend_with_design_file_guard",
]
