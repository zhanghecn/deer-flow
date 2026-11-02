"""Regression tests for Anthropic thinking-block round-trip through DeepSeek-style gateways.

事故背景(2026-10-31 线上 422):
    deepseek-flash 经 New API 中转走 Anthropic 兼容协议。模型在部分工具调用轮次
    不产出思考文本、只返回 signature。langchain-anthropic 1.3.4 的流式聚合对
    `thinking` 类型的 content_block_start 不建立初始块,`thinking` 键的存在完全
    依赖至少一个 thinking_delta,于是聚合出的 thinking 块变成
    `{"type": "thinking", "signature": "<uuid>"}`(缺 `thinking` 文本字段)。
    这种残缺消息被持久化进 thread state 后,下一轮回传时上游 Rust serde 严格校验
    直接拒绝:`messages[N]: missing field 'thinking'`(422)。

修复契约:
    发送侧 `_format_messages` 必须保证:凡是带 `signature` 的 thinking 块,
    序列化输出必含 `thinking` 键(空串即可,上游已验证接受空串)。这样既保护
    新消息,也兜底已持久化的存量残缺消息。
"""

from langchain_anthropic.chat_models import _format_messages
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage


def _history_with_signature_only_thinking() -> AIMessage:
    # 还原线上事故消息形状:thinking 块缺 `thinking` 键,只有 signature;
    # tool_use 块为流式聚合中间态(input 空、参数在 partial_json)。
    return AIMessage(
        content=[
            {"type": "thinking", "index": 0, "signature": "sig-accident"},
            {
                "type": "tool_use",
                "id": "call_00_accident",
                "name": "get_bms_file_search",
                "input": {},
                "index": 1,
                "partial_json": '{"pattern": "核对"}',
            },
        ],
        tool_calls=[
            {
                "id": "call_00_accident",
                "name": "get_bms_file_search",
                "args": {"pattern": "核对"},
                "type": "tool_call",
            }
        ],
    )


def _roundtrip_blocks() -> list[dict]:
    messages = [
        HumanMessage(content="外委的核对产值应该怎么计算"),
        _history_with_signature_only_thinking(),
        ToolMessage(content="ok", tool_call_id="call_00_accident"),
        HumanMessage(content="继续"),
    ]
    # `model` 关键字参数是 langchain-anthropic 1.7+ 的签名要求,仅用于告警文案。
    _system, formatted = _format_messages(messages, model="deepseek-flash")
    return formatted


def test_signature_only_thinking_block_keeps_thinking_key_on_roundtrip():
    """带 signature 的 thinking 块回传时必须保留 `thinking` 字段(可为空串)。

    上游(DeepSeek 官方 Anthropic 兼容层)用 Rust serde 严格校验 thinking 块,
    缺 `thinking` 字段直接 422 反序列化失败;空串已验证被接受。
    """
    formatted = _roundtrip_blocks()

    assistant_blocks = [b for m in formatted if m["role"] == "assistant" for b in m["content"]]
    thinking_blocks = [b for b in assistant_blocks if b.get("type") == "thinking"]
    assert thinking_blocks, "assistant 历史里应存在 thinking 块"

    for block in thinking_blocks:
        assert "thinking" in block, (
            "thinking 块回传时缺 `thinking` 字段,上游将报 "
            "422 missing field `thinking`"
        )


def test_thinking_block_with_text_roundtrips_unchanged():
    """正常 thinking 块(有文本)回传时文本必须原样保留。"""
    messages = [
        HumanMessage(content="hi"),
        AIMessage(
            content=[
                {"type": "thinking", "index": 0, "thinking": "think twice", "signature": "sig-ok"},
            ],
        ),
    ]
    _system, formatted = _format_messages(messages, model="deepseek-flash")
    block = formatted[1]["content"][0]
    assert block["type"] == "thinking"
    assert block["thinking"] == "think twice"
    assert block["signature"] == "sig-ok"
