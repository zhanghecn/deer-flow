from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Generator


def _resolve_base_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/v1"):
        return trimmed
    return f"{trimmed}/v1"


class OpenAgentsClient:
    """Minimal native OpenAgents client for the canonical /v1/turns contract."""

    def __init__(self, *, base_url: str, api_key: str) -> None:
        self.base_url = _resolve_base_url(base_url)
        self.api_key = api_key

    def _request(self, path: str, payload: dict | None = None):
        data = None
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method="POST" if payload is not None else "GET",
        )
        try:
            return urllib.request.urlopen(req)
        except urllib.error.HTTPError as exc:  # pragma: no cover - passthrough
            body = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(body or exc.reason) from exc

    def create_turn(self, payload: dict) -> dict:
        with self._request("/turns", {**payload, "stream": False}) as response:
            return json.loads(response.read().decode("utf-8"))

    def get_turn(self, turn_id: str) -> dict:
        encoded = urllib.parse.quote(turn_id, safe="")
        with self._request(f"/turns/{encoded}") as response:
            return json.loads(response.read().decode("utf-8"))

    def stream_turn(self, payload: dict) -> Generator[dict, None, None]:
        with self._request("/turns", {**payload, "stream": True}) as response:
            event_name = "message"
            data_lines: list[str] = []
            for raw_line in response:
                line = raw_line.decode("utf-8").rstrip("\n")
                if not line:
                    if data_lines and event_name != "done":
                        yield json.loads("\n".join(data_lines))
                    event_name = "message"
                    data_lines = []
                    continue
                if line.startswith("event:"):
                    event_name = line.split(":", 1)[1].strip()
                    continue
                if line.startswith("data:"):
                    data_lines.append(line.split(":", 1)[1].strip())
