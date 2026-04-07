from __future__ import annotations

from src.agents.middlewares.retry_utils import should_retry


class FakeHttpError(Exception):
    def __init__(self, status_code: int, message: str = "http error") -> None:
        super().__init__(message)
        self.status_code = status_code


def test_should_retry_for_transient_http_status_codes():
    assert should_retry(FakeHttpError(429)) is True
    assert should_retry(FakeHttpError(503)) is True
    assert should_retry(FakeHttpError(400)) is False


def test_should_retry_for_connection_and_timeout_failures():
    assert should_retry(ConnectionError("Connection error")) is True
    assert should_retry(TimeoutError("Request timed out")) is True
    assert should_retry(RuntimeError("Validation failed")) is False


def test_should_retry_for_empty_model_stream_failures():
    assert should_retry(ValueError("No generations found in stream.")) is True
