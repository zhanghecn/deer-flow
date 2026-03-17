import json

from src.observability.store import _serialize_json_payload


def test_serialize_json_payload_strips_null_bytes_from_nested_values():
    payload = {
        "text": "hello\x00world",
        "nested": ["ok\x00", {"bytes": b"a\x00b"}],
    }

    serialized = _serialize_json_payload(payload)

    assert "\\u0000" not in serialized
    assert "\x00" not in serialized

    parsed = json.loads(serialized)
    assert parsed == {
        "text": "helloworld",
        "nested": ["ok", {"bytes": "ab"}],
    }
