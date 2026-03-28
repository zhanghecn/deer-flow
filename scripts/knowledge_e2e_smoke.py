#!/usr/bin/env python3
"""Manual knowledge-base E2E smoke runner.

Examples:
  python scripts/knowledge_e2e_smoke.py \
    --thread-id 2a503fb8-d428-45e6-944b-ed5296086332 \
    --name "Runtime Markdown Smoke" \
    --file docs/architecture/runtime-architecture.md \
    --dump-debug

  python scripts/knowledge_e2e_smoke.py \
    --thread-id 2a503fb8-d428-45e6-944b-ed5296086332 \
    --name "Docx Smoke" \
    --file ../astrology_books/八字/段建业盲派命理干支解密.docx \
    --dump-debug
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib import error, request


@dataclass
class SmokeConfig:
    base_url: str
    account: str
    password: str
    thread_id: str
    name: str
    description: str
    files: list[Path]
    model_name: str | None
    poll_interval: float
    timeout_seconds: float
    dump_debug: bool
    output_dir: Path


def _json_request(
    method: str,
    url: str,
    *,
    token: str | None = None,
    payload: dict[str, Any] | None = None,
    body: bytes | None = None,
    content_type: str | None = None,
) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = body
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        payload_text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"{method} {url} failed with {exc.code}: {payload_text}"
        ) from exc


def _multipart_form_data(
    *,
    fields: dict[str, str],
    files: list[Path],
) -> tuple[bytes, str]:
    boundary = f"----openagents-knowledge-{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    def add_line(text: str) -> None:
        chunks.append(text.encode("utf-8"))

    for key, value in fields.items():
        add_line(f"--{boundary}\r\n")
        add_line(f'Content-Disposition: form-data; name="{key}"\r\n\r\n')
        add_line(f"{value}\r\n")

    for file_path in files:
        mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        add_line(f"--{boundary}\r\n")
        add_line(
            f'Content-Disposition: form-data; name="files"; filename="{file_path.name}"\r\n'
        )
        add_line(f"Content-Type: {mime_type}\r\n\r\n")
        chunks.append(file_path.read_bytes())
        add_line("\r\n")

    add_line(f"--{boundary}--\r\n")
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _login(config: SmokeConfig) -> str:
    payload = _json_request(
        "POST",
        f"{config.base_url}/api/auth/login",
        payload={"account": config.account, "password": config.password},
    )
    token = str(payload.get("token") or "").strip()
    if not token:
        raise RuntimeError("Login succeeded without a token.")
    return token


def _create_base(config: SmokeConfig, token: str) -> dict[str, Any]:
    fields = {"name": config.name, "description": config.description}
    if config.model_name:
        fields["model_name"] = config.model_name
    body, content_type = _multipart_form_data(fields=fields, files=config.files)
    return _json_request(
        "POST",
        f"{config.base_url}/api/threads/{config.thread_id}/knowledge/bases",
        token=token,
        body=body,
        content_type=content_type,
    )


def _list_library(config: SmokeConfig, token: str) -> list[dict[str, Any]]:
    payload = _json_request(
        "GET",
        f"{config.base_url}/api/knowledge/bases?thread_id={config.thread_id}",
        token=token,
    )
    bases = payload.get("knowledge_bases")
    return list(bases) if isinstance(bases, list) else []


def _find_base(knowledge_bases: list[dict[str, Any]], base_id: str) -> dict[str, Any] | None:
    for base in knowledge_bases:
        if str(base.get("id")) == base_id:
            return base
    return None


def _status_of(document: dict[str, Any]) -> str:
    latest = document.get("latest_build_job")
    if isinstance(latest, dict) and latest.get("status"):
        return str(latest["status"])
    return str(document.get("status") or "")


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _fetch_document_artifacts(
    config: SmokeConfig,
    *,
    token: str,
    base_id: str,
    document: dict[str, Any],
) -> dict[str, Any]:
    document_id = str(document.get("id") or "").strip()
    if not document_id:
        return {}
    events = _json_request(
        "GET",
        f"{config.base_url}/api/knowledge/documents/{document_id}/build-events",
        token=token,
    )
    debug_payload = _json_request(
        "GET",
        f"{config.base_url}/api/knowledge/documents/{document_id}/debug",
        token=token,
    )
    if config.dump_debug:
        document_dir = config.output_dir / base_id / document.get("display_name", document_id)
        _write_json(document_dir / "build-events.json", events)
        _write_json(document_dir / "debug.json", debug_payload)
    return {
        "events": events.get("events") if isinstance(events, dict) else [],
        "debug": debug_payload,
    }


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _parse_args() -> SmokeConfig:
    parser = argparse.ArgumentParser(description="Manual knowledge E2E smoke runner")
    parser.add_argument("--base-url", default="http://localhost:8001")
    parser.add_argument("--account", default="admin")
    parser.add_argument("--password", default="admin123")
    parser.add_argument("--thread-id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--file", action="append", dest="files", required=True)
    parser.add_argument("--model-name", default=None)
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--timeout-seconds", type=float, default=900.0)
    parser.add_argument("--dump-debug", action="store_true")
    parser.add_argument(
        "--output-dir",
        default=f".tmp-kb-fixtures/e2e-smoke/{_timestamp()}",
    )
    args = parser.parse_args()

    files = [Path(value).resolve() for value in args.files]
    missing = [str(path) for path in files if not path.is_file()]
    if missing:
        raise SystemExit(f"Missing files: {', '.join(missing)}")

    return SmokeConfig(
        base_url=args.base_url.rstrip("/"),
        account=args.account,
        password=args.password,
        thread_id=args.thread_id,
        name=args.name,
        description=args.description,
        files=files,
        model_name=args.model_name,
        poll_interval=args.poll_interval,
        timeout_seconds=args.timeout_seconds,
        dump_debug=bool(args.dump_debug),
        output_dir=Path(args.output_dir).resolve(),
    )


def main() -> int:
    config = _parse_args()
    started_at = time.perf_counter()
    token = _login(config)
    created = _create_base(config, token)
    base_id = str(created.get("knowledge_base_id") or "").strip()
    if not base_id:
        raise RuntimeError(f"Unexpected create response: {created}")

    print(
        json.dumps(
            {
                "event": "created",
                "knowledge_base_id": base_id,
                "thread_id": config.thread_id,
                "files": [str(path) for path in config.files],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    deadline = time.perf_counter() + config.timeout_seconds
    final_base: dict[str, Any] | None = None
    while time.perf_counter() < deadline:
        knowledge_bases = _list_library(config, token)
        candidate = _find_base(knowledge_bases, base_id)
        if candidate is None:
            time.sleep(config.poll_interval)
            continue
        final_base = candidate
        documents = list(candidate.get("documents") or [])
        statuses = [_status_of(document) for document in documents]
        print(
            json.dumps(
                {
                    "event": "poll",
                    "knowledge_base_id": base_id,
                    "statuses": statuses,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        if documents and all(status in {"ready", "error"} for status in statuses):
            break
        time.sleep(config.poll_interval)

    if final_base is None:
        raise TimeoutError("Timed out before the knowledge base appeared in the library.")

    document_summaries: list[dict[str, Any]] = []
    for document in list(final_base.get("documents") or []):
        artifacts = _fetch_document_artifacts(
            config,
            token=token,
            base_id=base_id,
            document=document,
        )
        latest_job = document.get("latest_build_job") or {}
        events = list(artifacts.get("events") or [])
        debug_payload = artifacts.get("debug") or {}
        document_summaries.append(
            {
                "document_id": document.get("id"),
                "display_name": document.get("display_name"),
                "status": _status_of(document),
                "locator_type": document.get("locator_type"),
                "file_kind": document.get("file_kind"),
                "page_count": document.get("page_count"),
                "node_count": document.get("node_count"),
                "doc_description": document.get("doc_description"),
                "started_at": latest_job.get("started_at"),
                "finished_at": latest_job.get("finished_at"),
                "progress_percent": latest_job.get("progress_percent"),
                "reuse_existing_index": any(
                    str(event.get("step_name")) == "reuse_existing_index"
                    for event in events
                ),
                "event_count": len(events),
                "canonical_length": len(str(debug_payload.get("canonical_markdown") or "")),
            }
        )

    summary = {
        "event": "completed",
        "knowledge_base_id": base_id,
        "elapsed_seconds": round(time.perf_counter() - started_at, 3),
        "documents": document_summaries,
        "output_dir": str(config.output_dir) if config.dump_debug else None,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
