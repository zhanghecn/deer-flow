"""Tests for target-length retry middleware."""

from __future__ import annotations

import re
from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agents.middlewares.target_length_retry_middleware import (
    TargetLengthRetryMiddleware,
)


def test_wrap_model_call_retries_when_markdown_draft_grossly_exceeds_requested_length():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content="请写一篇 500 字左右的众筹文案，并保存为 crowdfunding_copy.md。"
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        if len(calls) == 1:
            return ModelResponse(
                result=[
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "write_file",
                                "args": {
                                    "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                    "content": "很长的文案。" * 160,
                                },
                                "id": "tool-1",
                            }
                        ],
                    )
                ]
            )

        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                "content": "精简文案。" * 40,
                            },
                            "id": "tool-2",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 2
    assert "target_length_recovery" in calls[1].system_message.text
    assert "2 段短正文" in calls[1].system_message.text
    assert "口号必须是 8-20 个字或字符的短句" in calls[1].system_message.text
    assert response.result[0].tool_calls[0]["args"]["content"] == "精简文案。" * 40


def test_wrap_model_call_allows_second_retry_when_first_revision_is_still_too_long():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content="请写一篇 500 字左右的众筹文案，并保存为 crowdfunding_copy.md。"
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        if len(calls) == 1:
            content = "很长的文案。" * 160
        elif len(calls) == 2:
            content = "仍然偏长的文案。" * 90
        else:
            content = "精简文案。" * 40

        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                "content": content,
                            },
                            "id": f"tool-{len(calls)}",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 3
    assert calls[1].system_message.text.count("<target_length_recovery>") == 1
    assert calls[2].system_message.text.count("<target_length_recovery>") == 2
    assert response.result[0].tool_calls[0]["args"]["content"] == "精简文案。" * 40


def test_wrap_model_call_stops_after_retry_budget_is_exhausted():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content="请写一篇 500 字左右的众筹文案，并保存为 crowdfunding_copy.md。"
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0
    oversized_content = "很长的文案。" * 160

    def handler(_next_request: ModelRequest):
        nonlocal calls
        calls += 1
        if calls > 4:
            raise AssertionError("Middleware retried more times than expected.")

        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                "content": oversized_content,
                            },
                            "id": f"tool-{calls}",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert calls == 4
    assert response.result[0].tool_calls[0]["args"]["content"] == oversized_content


def test_wrap_model_call_returns_shortest_seen_draft_when_last_retry_regresses():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content="请写一篇 500 字左右的众筹文案，并保存为 crowdfunding_copy.md。"
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []
    contents = [
        "很长的文案。" * 160,
        "仍然偏长的文案。" * 90,
        "再次变长的文案。" * 110,
        "最后又回弹的文案。" * 130,
    ]

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        content = contents[len(calls) - 1]
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                "content": content,
                            },
                            "id": f"tool-{len(calls)}",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 4
    assert response.result[0].tool_calls[0]["args"]["content"] == contents[1]


def test_wrap_model_call_uses_tighter_upper_bound_for_short_marketing_copy():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content="请写一篇 500 字左右的众筹文案，并保存为 crowdfunding_copy.md。"
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []
    contents = [
        "很长的文案。" * 160,
        "甲" * 607,
        "乙" * 560,
    ]

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        content = contents[len(calls) - 1]
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                "content": content,
                            },
                            "id": f"tool-{len(calls)}",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 3
    assert response.result[0].tool_calls[0]["args"]["content"] == contents[2]


def test_wrap_model_call_skips_retry_for_non_textual_output_files():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="请写一个 500 字左右的 HTML 页面。")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0

    def handler(_next_request: ModelRequest):
        nonlocal calls
        calls += 1
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/landing_page.html",
                                "content": "<!DOCTYPE html><html><body>" + ("内容" * 400) + "</body></html>",
                            },
                            "id": "tool-1",
                        }
                    ],
                )
            ]
        )

    middleware.wrap_model_call(request, handler)

    assert calls == 1


def test_wrap_model_call_skips_retry_when_draft_is_close_enough_to_requested_length():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="Write about 300 words and save it as draft.md.")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0
    content = "word " * 315

    def handler(_next_request: ModelRequest):
        nonlocal calls
        calls += 1
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/draft.md",
                                "content": content,
                            },
                            "id": "tool-1",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert calls == 1
    assert response.result[0].tool_calls[0]["args"]["content"] == content


def test_wrap_model_call_sums_repeated_approximate_targets_for_merged_output():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content=(
                    "请同时完成两个任务：\n"
                    "子任务 1：写一篇 300 字左右的正方文章。\n"
                    "子任务 2：写一篇 300 字左右的反方文章。\n"
                    "最后合并为 debate.md。"
                )
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0
    content = "论点" * 390

    def handler(_next_request: ModelRequest):
        nonlocal calls
        calls += 1
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/debate.md",
                                "content": content,
                            },
                            "id": "tool-1",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert calls == 1
    assert response.result[0].tool_calls[0]["args"]["content"] == content


def test_wrap_model_call_targets_matching_deliverable_type_instead_of_first_text_file():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content=(
                    "请先写市场调研报告，再写一篇 500 字左右的众筹文案。\n"
                    "最终交付物：\n"
                    "1. `research_report.md` — 市场调研报告\n"
                    "2. `crowdfunding_copy.md` — 众筹文案\n"
                )
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0

    def handler(_next_request: ModelRequest):
        nonlocal calls
        calls += 1
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/research_report.md",
                                "content": "报告内容。" * 300,
                            },
                            "id": "tool-1",
                        }
                    ],
                )
            ]
        )

    middleware.wrap_model_call(request, handler)

    assert calls == 1


def test_wrap_model_call_compacts_marketing_copy_markdown_before_retrying():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content="请写一篇 500 字左右的众筹文案，并保存为 crowdfunding_copy.md。"
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0
    oversized_markdown = """# 智能咖啡机众筹文案

---

## 产品口号（Slogan）

> **"一句话，咖啡来。"**
>
> *Speak Once, Brew Perfect.*

---

## 正文

**早安，该喝咖啡了。但你的手，还不想动。**

我们懂。市面上的智能咖啡机，所谓的"智能"不过是让你多下一个APP。Keurig K-Supreme能连WiFi，但换个人喝还得重新设置；Hamilton Beach号称支持Alexa，却逼你每天早上先跑到厨房按那个可笑的"Ready to Brew"按钮——这算哪门子智能？Breville确实专业，但你还得手动研磨、压粉、等萃取，上班族根本没时间伺候它。

**是时候让咖啡机真的变聪明了。**

**这就是 VoiceBrew —— 全球首款真正听懂你的智能咖啡机。**

不需要按任何按钮，不用提前一天设置。当你睁开眼的瞬间，只需说一句："来杯热拿铁，浓一点。"30秒后，一杯温度精准、油脂绵密、奶泡细腻的现磨拿铁，就会出现在你面前。

我们的**AI语音引擎**能理解自然语言，记住每个家庭成员的口味。你说"老样子"，它知道你是双份浓缩；太太说"淡一点"，它自动调整水温与粉量。支持中英双语，接入 Alexa、Google Home、小爱同学，无论你用哪种方式开口，它都听得懂。

**竞品还在玩"伪语音控制"的把戏，我们直接让按钮退休。**

VoiceBrew 内置商用级锥刀研磨器、20Bar黄金压力萃取、PID精准温控，专业度不输万元商用机。更重要的是——

**你全程不用碰它一下。**

早该如此，不是吗？

---

**限时早鸟价 ¥1,999 起**

支持我们，让明天的咖啡，一句话就好。

**[立即支持]**

---"""

    def handler(_next_request: ModelRequest):
        nonlocal calls
        calls += 1
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                "content": oversized_markdown,
                            },
                            "id": "tool-1",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    compacted = response.result[0].tool_calls[0]["args"]["content"]
    compacted_length = len(re.sub(r"\s+", "", compacted))

    assert calls == 1
    assert compacted_length <= 600
    assert "## 产品口号" not in compacted
    assert "Speak Once, Brew Perfect." not in compacted
    assert '"一句话，咖啡来。"' in compacted


def test_wrap_model_call_compacts_marketing_copy_section_headings_and_bullets():
    middleware = TargetLengthRetryMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content="请写一篇 500 字左右的众筹文案，并保存为 crowdfunding_copy.md。"
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0
    oversized_markdown = """# 智能咖啡机众筹文案

## 产品口号
**\"Voice Your Coffee —— 一句话，咖啡来\"**

---

## 正文

清晨，当你睡眼惺忪地走进厨房，是否厌倦了繁琐的按钮操作？当我们调研市面上销量前三的咖啡机——咖博士H3、德龙ECAM450.86.T、飞利浦EP5242——我们发现它们都有一个共同的遗憾：**没有语音控制**。

是的，这些售价3000-5000元的\"智能\"咖啡机，依然需要你手动点击屏幕或打开APP。清晨想要一杯热美式？先找到手机、解锁、打开APP、等待连接、选择菜单……咖啡还没喝上，人已经清醒了。

### 我们的差异化优势

**VoiceControl™ 智能语音控制系统**

我们打造了市面上首款真正支持语音控制的智能咖啡机。无需APP，无需触碰，只需一句话：

- \"来杯美式\" —— 30秒后，热腾腾的咖啡等你
- \"我要拿铁，少糖\" —— 奶泡厚度、糖量自动调节
- \"预约明天早上7点做咖啡\" —— 到点自动唤醒你的味蕾

### 为什么竞品做不到？

咖博士H3有大屏，但没有语音；德龙有小程序，但需要手动操作；飞利浦有速热，但仍需按键。**真正的智能，应该解放双手。**

### 产品亮点

- **极速响应**：语音指令识别<0.5秒，出杯仅需30秒
- **个性化记忆**：6位家庭成员声纹识别，每人专属口味
- **全功能覆盖**：35种饮品、冷热双萃、自动奶泡，一句话搞定
- **静音研磨**：45分贝超低噪音，不打扰家人

### 早鸟价承诺

竞品售价3500元起，**我们众筹早鸟价仅需￥1,999**——让真正智能的咖啡体验，不再遥不可及。

**Voice Your Coffee，从此咖啡听你号令。**"""

    def handler(_next_request: ModelRequest):
        nonlocal calls
        calls += 1
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "write_file",
                            "args": {
                                "file_path": "/mnt/user-data/outputs/crowdfunding_copy.md",
                                "content": oversized_markdown,
                            },
                            "id": "tool-1",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    compacted = response.result[0].tool_calls[0]["args"]["content"]
    compacted_length = len(re.sub(r"\s+", "", compacted))

    assert calls == 1
    assert compacted_length <= 600
    assert "### 我们的差异化优势" not in compacted
    assert "- \"来杯美式\"" not in compacted
    assert "VoiceControl™ 智能语音控制系统" in compacted
