from types import SimpleNamespace

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain.tools.tool_node import ToolCallRequest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.runtime import Runtime

from src.agents.middlewares.knowledge_context_middleware import (
    KnowledgeContextMiddleware,
    blocked_knowledge_bypass_tool_message,
    blocked_knowledge_visual_tool_message,
    build_knowledge_context_prompt,
)
from src.knowledge.models import KnowledgeDocumentRecord
from src.knowledge.runtime import resolve_knowledge_runtime_identity


class _FakeBinding:
    def __init__(self, user_id: str) -> None:
        self.user_id = user_id


class _FakeDBStore:
    def __init__(self, binding: _FakeBinding | None) -> None:
        self._binding = binding

    def get_thread_binding(self, thread_id: str):
        assert thread_id == "thread-1"
        return self._binding


def _document(
    name: str,
    *,
    document_id: str,
    knowledge_base_name: str = "Finance",
) -> KnowledgeDocumentRecord:
    return KnowledgeDocumentRecord(
        id=document_id,
        knowledge_base_id="kb-1",
        knowledge_base_name=knowledge_base_name,
        knowledge_base_description=None,
        display_name=name,
        file_kind="pdf",
        locator_type="page",
        status="ready",
        doc_description=f"description for {name}",
        error=None,
        page_count=20,
        node_count=8,
        source_storage_path="knowledge/source.pdf",
        markdown_storage_path=None,
        preview_storage_path="knowledge/preview.pdf",
    )


def _tool(name: str):
    return SimpleNamespace(name=name)


def test_resolve_knowledge_runtime_identity_uses_explicit_user_id(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(None),
    )

    assert resolve_knowledge_runtime_identity(
        {"thread_id": "thread-1", "user_id": "user-1"}
    ) == ("user-1", "thread-1")


def test_resolve_knowledge_runtime_identity_falls_back_to_thread_binding(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )

    assert resolve_knowledge_runtime_identity({"thread_id": "thread-1"}) == (
        "user-from-binding",
        "thread-1",
    )


def test_build_knowledge_context_prompt_uses_thread_binding_fallback(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document("annual-report.pdf", document_id=f"{user_id}:{thread_id}")
        ],
    )

    prompt = build_knowledge_context_prompt({"thread_id": "thread-1"})

    assert "<knowledge_documents>" in prompt
    assert '"document_id":"user-from-binding:thread-1"' in prompt
    assert '"document_name":"annual-report.pdf"' in prompt


def test_build_knowledge_context_prompt_includes_runtime_selected_documents(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )

    seen: dict[str, object] = {}

    def _fake_get_thread_document_records(
        self,
        *,
        user_id,
        thread_id,
        selected_document_ids=None,
        ready_only=False,
    ):
        seen["selected_document_ids"] = selected_document_ids
        return [_document("selected-notes.md", document_id="doc-selected")]

    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        _fake_get_thread_document_records,
    )

    prompt = build_knowledge_context_prompt(
        {
            "thread_id": "thread-1",
            "knowledge_document_ids": ["doc-selected"],
        }
    )

    assert seen["selected_document_ids"] == ("doc-selected",)
    assert '"document_name":"selected-notes.md"' in prompt


def test_build_knowledge_context_prompt_prioritizes_user_and_agent_document_targets(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document("annual-report.pdf", document_id="doc-1"),
            _document("board-deck-q4.md", document_id="doc-2"),
        ],
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.load_agents_md",
        lambda *args, **kwargs: "@knowledge[board-deck-q4.md]",
    )

    prompt = build_knowledge_context_prompt(
        {
            "thread_id": "thread-1",
            "knowledge_document_mentions": ["annual-report.pdf"],
            "agent_name": "researcher",
            "agent_status": "dev",
        }
    )

    assert "<knowledge_document_selection>" in prompt
    assert "<knowledge_tool_protocol>" in prompt
    assert "User-explicit document targets for this turn" in prompt
    assert "annual-report.pdf [Finance]" in prompt
    assert "Treat these explicit targets as a hard retrieval preference" in prompt
    assert "Do not reuse an earlier turn's citation" in prompt
    assert "max_depth=2" in prompt
    assert "root_cursor" in prompt
    assert "AGENTS.md default document targets when relevant" in prompt
    assert "board-deck-q4.md [Finance]" in prompt
    assert "get_document_evidence" in prompt
    assert "answer_requires_evidence=true" in prompt
    assert "inline-ready image markdown" in prompt
    assert "display_markdown" in prompt
    assert "inline the relevant `image_markdown` by default" in prompt
    assert "use `get_document_evidence` before any `get_document_image(...)` or `view_image(...)` call" in prompt
    assert "instead of opening the spill file" in prompt
    assert "Avoid bypassing the knowledge index with raw file or shell search" in prompt


def test_knowledge_context_middleware_keeps_model_tool_list_stable_for_attached_document_turns(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document(
                "E210郑民生-民间盲派八字.md",
                document_id="doc-1",
                knowledge_base_name="E210郑民生-民间盲派八字",
            )
        ],
    )

    user_input = "这份《E210郑民生-民间盲派八字》里，文中如何区分牢狱之灾和伤灾残疾？"
    request = ModelRequest(
        model=object(),
        messages=[HumanMessage(content=user_input)],
        tools=[
            _tool("grep"),
            _tool("read_file"),
            _tool("get_document_tree"),
            _tool("get_document_tree_node_detail"),
            _tool("present_files"),
        ],
        state={"messages": [HumanMessage(content=user_input)]},
        runtime=Runtime(
            context={"thread_id": "thread-1", "original_user_input": user_input},
            store=None,
            stream_writer=None,
        ),
    )

    seen: dict[str, list[str]] = {}

    def handler(filtered_request: ModelRequest[object]) -> ModelResponse[object]:
        seen["tool_names"] = [tool.name for tool in filtered_request.tools]
        return ModelResponse(result=[AIMessage(content="ok")])

    middleware = KnowledgeContextMiddleware()
    middleware.wrap_model_call(request, handler)

    assert seen["tool_names"] == [
        "grep",
        "read_file",
        "get_document_tree",
        "get_document_tree_node_detail",
        "present_files",
    ]


def test_knowledge_context_middleware_keeps_raw_tools_for_index_debug_turns(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document(
                "E210郑民生-民间盲派八字.md",
                document_id="doc-1",
                knowledge_base_name="E210郑民生-民间盲派八字",
            )
        ],
    )

    user_input = "帮我调试这份 E210郑民生-民间盲派八字 的索引解析，看看 raw parsing 和 source map 是否有问题。"
    request = ModelRequest(
        model=object(),
        messages=[HumanMessage(content=user_input)],
        tools=[_tool("grep"), _tool("read_file"), _tool("get_document_tree")],
        state={"messages": [HumanMessage(content=user_input)]},
        runtime=Runtime(
            context={"thread_id": "thread-1", "original_user_input": user_input},
            store=None,
            stream_writer=None,
        ),
    )

    seen: dict[str, list[str]] = {}

    def handler(filtered_request: ModelRequest[object]) -> ModelResponse[object]:
        seen["tool_names"] = [tool.name for tool in filtered_request.tools]
        return ModelResponse(result=[AIMessage(content="ok")])

    middleware = KnowledgeContextMiddleware()
    middleware.wrap_model_call(request, handler)

    assert seen["tool_names"] == ["grep", "read_file", "get_document_tree"]


def test_knowledge_context_middleware_does_not_retry_direct_answer_without_current_turn_evidence(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML")
        ],
    )

    user_input = "根据 PRML.pdf 的 Figure 1.1 回答问题。"
    request = ModelRequest(
        model=object(),
        messages=[HumanMessage(content=user_input)],
        tools=[_tool("get_document_tree"), _tool("get_document_evidence")],
        state={"messages": [HumanMessage(content=user_input)]},
        runtime=Runtime(
            context={"thread_id": "thread-1", "original_user_input": user_input},
            store=None,
            stream_writer=None,
        ),
    )

    seen_system_messages: list[str] = []
    call_count = 0

    def handler(filtered_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal call_count
        call_count += 1
        seen_system_messages.append(str(filtered_request.system_message or ""))
        return ModelResponse(result=[AIMessage(content="直接回答，不调用知识库工具。")])

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 1
    assert len(seen_system_messages) == 1
    assert "<knowledge_response_recovery>" not in seen_system_messages[0]
    assert response.result[-1].content == "直接回答，不调用知识库工具。"


def test_knowledge_context_middleware_retries_tree_only_answer_without_current_turn_evidence(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML")
        ],
    )

    user_input = "根据 PRML.pdf 的 Figure 1.1 回答问题。"
    request = ModelRequest(
        model=object(),
        messages=[HumanMessage(content=user_input)],
        tools=[_tool("get_document_tree"), _tool("get_document_evidence")],
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "tool-tree",
                            "name": "get_document_tree",
                            "args": {
                                "document_name_or_id": "PRML.pdf",
                                "max_depth": 2,
                            },
                        }
                    ],
                ),
                ToolMessage(
                    tool_call_id="tool-tree",
                    name="get_document_tree",
                    content='{"answer_requires_evidence":true,"tree":[{"node_id":"0001","title":"Figure 1.1"}]}',
                ),
            ]
        },
        runtime=Runtime(
            context={"thread_id": "thread-1", "original_user_input": user_input},
            store=None,
            stream_writer=None,
        ),
    )

    seen_system_messages: list[str] = []
    call_count = 0

    def handler(filtered_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal call_count
        call_count += 1
        seen_system_messages.append(str(filtered_request.system_message or ""))
        if call_count == 1:
            return ModelResponse(
                result=[
                    AIMessage(
                        content="目录大概分为几部分，后面会讲概率模型、分类与降维。",
                    )
                ]
            )
        return ModelResponse(
            result=[
                AIMessage(
                    content="先去拿 evidence，不再直接用树回答。",
                )
            ]
        )

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 2
    assert len(seen_system_messages) == 2
    assert "<knowledge_response_recovery>" not in seen_system_messages[0]
    assert "<knowledge_response_recovery>" in seen_system_messages[1]
    assert response.result[-1].content == "先去拿 evidence，不再直接用树回答。"


def test_knowledge_context_middleware_retries_evidence_answer_without_visible_citation(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML")
        ],
    )

    user_input = "根据 PRML.pdf 的 Figure 1.1 回答问题。"
    request = ModelRequest(
        model=object(),
        messages=[HumanMessage(content=user_input)],
        tools=[_tool("get_document_tree"), _tool("get_document_evidence")],
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "tool-1",
                            "name": "get_document_evidence",
                            "args": {
                                "document_name_or_id": "PRML.pdf",
                                "node_ids": "0001",
                            },
                        }
                    ],
                ),
                ToolMessage(
                    tool_call_id="tool-1",
                    name="get_document_evidence",
                    content='{"items":[{"node_id":"0001","citation_markdown":"[citation:PRML.pdf p.1](kb://citation?document_name=PRML.pdf&page=1)"}]}',
                ),
            ]
        },
        runtime=Runtime(
            context={"thread_id": "thread-1", "original_user_input": user_input},
            store=None,
            stream_writer=None,
        ),
    )

    seen_system_messages: list[str] = []
    call_count = 0

    def handler(filtered_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal call_count
        call_count += 1
        seen_system_messages.append(str(filtered_request.system_message or ""))
        if call_count == 1:
            return ModelResponse(result=[AIMessage(content="Figure 1.1 展示了概率密度。")])
        return ModelResponse(
            result=[
                AIMessage(
                    content="Figure 1.1 展示了概率密度。[citation:PRML.pdf p.1](kb://citation?document_name=PRML.pdf&page=1)"
                )
            ]
        )

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 2
    assert "<knowledge_response_recovery>" in seen_system_messages[1]
    assert "(kb://citation" in str(response.result[-1].content)


def test_knowledge_context_middleware_retries_grounded_evidence_answer_without_visible_citation(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML")
        ],
    )

    user_input = "根据 PRML.pdf 里的 Figure 1.1，只根据图片本身回答内容。"
    evidence_payload = (
        '{"returned_pages":"22-22","items":[{"node_id":"0005","evidence_blocks":[{"page_number":22,'
        '"image_markdown":"![PRML.pdf p.22](kb://asset?x=1)",'
        '"citation_markdown":"[citation:PRML.pdf p.22](kb://citation?x=1)"}]}]}'
    )
    request = ModelRequest(
        model=object(),
        messages=[HumanMessage(content=user_input)],
        tools=[_tool("get_document_tree"), _tool("get_document_evidence"), _tool("view_image")],
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(content=evidence_payload, tool_call_id="call-evidence", name="get_document_evidence"),
            ]
        },
        runtime=Runtime(
            context={"thread_id": "thread-1", "original_user_input": user_input},
            store=None,
            stream_writer=None,
        ),
    )

    call_count = 0
    seen_system_messages: list[str] = []

    def handler(filtered_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal call_count
        call_count += 1
        seen_system_messages.append(str(filtered_request.system_message or ""))
        if call_count == 1:
            return ModelResponse(
                result=[
                    AIMessage(
                        content="答案如下：\n\n![Figure 1.1](/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png)"
                    )
                ]
            )
        return ModelResponse(
            result=[
                AIMessage(
                    content=(
                        "答案如下：\n\n"
                        "![PRML.pdf p.22](kb://asset?x=1)\n\n"
                        "[citation:PRML.pdf p.22](kb://citation?x=1)"
                    )
                )
            ]
        )

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 2
    assert "<knowledge_response_recovery>" in seen_system_messages[1]
    assert "(kb://citation" in response.result[-1].content


def test_knowledge_context_middleware_retries_visual_answer_without_inline_asset(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document("annual-report.pdf", document_id="doc-1", knowledge_base_name="Annual")
        ],
    )

    user_input = "这份年报封面页展示的是什么场景？"
    evidence_payload = (
        '{"items":[{"node_id":"0001","evidence_blocks":[{"kind":"page_image",'
        '"display_markdown":"![annual-report.pdf p.1](kb://asset?x=1)\\n\\n[citation:annual-report.pdf p.1](kb://citation?x=1)",'
        '"image_markdown":"![annual-report.pdf p.1](kb://asset?x=1)",'
        '"citation_markdown":"[citation:annual-report.pdf p.1](kb://citation?x=1)"}]}]}'
    )
    request = ModelRequest(
        model=object(),
        messages=[HumanMessage(content=user_input)],
        tools=[_tool("get_document_tree"), _tool("get_document_evidence"), _tool("view_image")],
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(content=evidence_payload, tool_call_id="call-evidence", name="get_document_evidence"),
            ]
        },
        runtime=Runtime(
            context={"thread_id": "thread-1", "original_user_input": user_input},
            store=None,
            stream_writer=None,
        ),
    )

    seen_system_messages: list[str] = []
    call_count = 0

    def handler(filtered_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal call_count
        call_count += 1
        seen_system_messages.append(str(filtered_request.system_message or ""))
        if call_count == 1:
            return ModelResponse(
                result=[
                    AIMessage(
                        content="封面展示的是联邦储备委员会大楼。[citation:annual-report.pdf p.1](kb://citation?x=1)"
                    )
                ]
            )
        return ModelResponse(
            result=[
                AIMessage(
                    content="![annual-report.pdf p.1](kb://asset?x=1)\n\n[citation:annual-report.pdf p.1](kb://citation?x=1)"
                )
            ]
        )

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 2
    assert "<knowledge_response_recovery>" in seen_system_messages[1]
    assert "(kb://asset" in response.result[-1].content


def test_blocked_knowledge_bypass_tool_message_rejects_grep_after_knowledge_activity(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document(
                "E210郑民生-民间盲派八字.md",
                document_id="doc-1",
                knowledge_base_name="E210郑民生-民间盲派八字",
            )
        ],
    )

    user_input = "这份《E210郑民生-民间盲派八字》里，文中如何区分牢狱之灾和伤灾残疾？"
    request = ToolCallRequest(
        tool_call={"id": "tool-1", "name": "grep", "args": {"pattern": "牢狱"}},
        tool=_tool("grep"),
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(content="", tool_calls=[{"id": "call-tree", "name": "get_document_tree", "args": {}}]),
                ToolMessage(content="{}", tool_call_id="call-tree", name="get_document_tree"),
            ]
        },
        runtime=SimpleNamespace(
            context={"thread_id": "thread-1", "original_user_input": user_input}
        ),
    )

    blocked = blocked_knowledge_bypass_tool_message(request)

    assert blocked is not None
    assert blocked.tool_call_id == "tool-1"
    assert "must stay on the knowledge tools" in blocked.content


def test_blocked_knowledge_bypass_tool_message_rejects_read_file_on_large_tool_results_after_knowledge_activity(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document(
                "PRML.pdf",
                document_id="doc-1",
                knowledge_base_name="PRML",
            )
        ],
    )

    user_input = "PRML 里关于 Figure 3.1 的图想表达什么？"
    request = ToolCallRequest(
        tool_call={
            "id": "tool-2",
            "name": "read_file",
            "args": {"file_path": "/large_tool_results/call-tree"},
        },
        tool=_tool("read_file"),
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(content="", tool_calls=[{"id": "call-tree", "name": "get_document_tree", "args": {}}]),
                ToolMessage(
                    content="Tool result too large, the result of this tool call call-tree was saved in the filesystem at this path: /large_tool_results/call-tree",
                    tool_call_id="call-tree",
                    name="get_document_tree",
                ),
            ]
        },
        runtime=SimpleNamespace(
            context={"thread_id": "thread-1", "original_user_input": user_input}
        ),
    )

    blocked = blocked_knowledge_bypass_tool_message(request)

    assert blocked is not None
    assert blocked.tool_call_id == "tool-2"
    assert "narrow the subtree" in blocked.content


def test_blocked_knowledge_visual_tool_message_blocks_get_document_image_before_evidence(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document(
                "PRML.pdf",
                document_id="doc-1",
                knowledge_base_name="PRML",
            )
        ],
    )

    user_input = "根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"
    request = ToolCallRequest(
        tool_call={
            "id": "tool-3a",
            "name": "get_document_image",
            "args": {"document_name_or_id": "PRML.pdf", "page_number": 22},
        },
        tool=_tool("get_document_image"),
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(content="", tool_calls=[{"id": "call-tree", "name": "get_document_tree", "args": {}}]),
                ToolMessage(content="{}", tool_call_id="call-tree", name="get_document_tree"),
            ]
        },
        runtime=SimpleNamespace(
            context={"thread_id": "thread-1", "original_user_input": user_input}
        ),
    )

    blocked = blocked_knowledge_visual_tool_message(request)

    assert blocked is not None
    assert blocked.tool_call_id == "tool-3a"
    assert "do not call `get_document_image` or `view_image` before grounding" in blocked.content


def test_blocked_knowledge_visual_tool_message_requires_evidence_before_view_image(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, selected_document_ids=None, ready_only=False: [
            _document(
                "PRML.pdf",
                document_id="doc-1",
                knowledge_base_name="PRML",
            )
        ],
    )

    user_input = "根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"
    request = ToolCallRequest(
        tool_call={
            "id": "tool-3",
            "name": "view_image",
            "args": {"image_path": "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png"},
        },
        tool=_tool("view_image"),
        state={
            "messages": [
                HumanMessage(content=user_input),
                AIMessage(content="", tool_calls=[{"id": "call-tree", "name": "get_document_tree", "args": {}}]),
                ToolMessage(content="{}", tool_call_id="call-tree", name="get_document_tree"),
            ]
        },
        runtime=SimpleNamespace(
            context={"thread_id": "thread-1", "original_user_input": user_input}
        ),
    )

    blocked = blocked_knowledge_visual_tool_message(request)

    assert blocked is not None
    assert blocked.tool_call_id == "tool-3"
    assert "First use `get_document_evidence" in blocked.content


def test_blocked_knowledge_visual_tool_message_allows_inspection_after_evidence():
    request = ToolCallRequest(
        tool_call={
            "id": "tool-4",
            "name": "view_image",
            "args": {"image_path": "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png"},
        },
        tool=_tool("view_image"),
        state={
            "messages": [
                HumanMessage(content="根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(
                    content='{"returned_pages":"22-22","items":[{"node_id":"0006","evidence_blocks":[{"page_number":22,"image_path":"/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png","citation_markdown":"[citation:PRML.pdf p.22](kb://citation?x=1)"}]}]}',
                    tool_call_id="call-evidence",
                    name="get_document_evidence",
                ),
            ]
        },
        runtime=SimpleNamespace(context={"thread_id": "thread-1"}),
    )

    assert blocked_knowledge_visual_tool_message(request) is None


def test_blocked_knowledge_visual_tool_message_rejects_failed_evidence_for_get_document_image():
    request = ToolCallRequest(
        tool_call={
            "id": "tool-5",
            "name": "get_document_image",
            "args": {"document_name_or_id": "PRML.pdf", "page_number": 22},
        },
        tool=_tool("get_document_image"),
        state={
            "messages": [
                HumanMessage(content="根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(
                    content="Error: The requested node is a root branch with many descendants.",
                    tool_call_id="call-evidence",
                    name="get_document_evidence",
                ),
            ]
        },
        runtime=SimpleNamespace(context={"thread_id": "thread-1"}),
    )

    blocked = blocked_knowledge_visual_tool_message(request)

    assert blocked is not None
    assert "does not count as grounding" in blocked.content


def test_blocked_knowledge_visual_tool_message_rejects_get_document_image_for_unmatched_page():
    request = ToolCallRequest(
        tool_call={
            "id": "tool-5b",
            "name": "get_document_image",
            "args": {"document_name_or_id": "PRML.pdf", "page_number": 22},
        },
        tool=_tool("get_document_image"),
        state={
            "messages": [
                HumanMessage(content="根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(
                    content='{"returned_pages":"13-20","items":[{"node_id":"0286","evidence_blocks":[{"page_number":13,"citation_markdown":"[citation:PRML.pdf p.13](kb://citation?x=1)"}]}]}',
                    tool_call_id="call-evidence",
                    name="get_document_evidence",
                ),
            ]
        },
        runtime=SimpleNamespace(context={"thread_id": "thread-1"}),
    )

    blocked = blocked_knowledge_visual_tool_message(request)

    assert blocked is not None
    assert "covers the same page" in blocked.content


def test_blocked_knowledge_visual_tool_message_rejects_guessed_view_image_path():
    request = ToolCallRequest(
        tool_call={
            "id": "tool-5c",
            "name": "view_image",
            "args": {"image_path": "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png"},
        },
        tool=_tool("view_image"),
        state={
            "messages": [
                HumanMessage(content="根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(
                    content='{"returned_pages":"13-20","items":[{"node_id":"0286","evidence_blocks":[{"page_number":13,"image_path":"/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0013.png","citation_markdown":"[citation:PRML.pdf p.13](kb://citation?x=1)"}]}]}',
                    tool_call_id="call-evidence",
                    name="get_document_evidence",
                ),
            ]
        },
        runtime=SimpleNamespace(context={"thread_id": "thread-1"}),
    )

    blocked = blocked_knowledge_visual_tool_message(request)

    assert blocked is not None
    assert "only use the exact `image_path` returned in the current turn" in blocked.content


def test_blocked_knowledge_visual_tool_message_allows_view_image_after_get_document_image():
    request = ToolCallRequest(
        tool_call={
            "id": "tool-5d",
            "name": "view_image",
            "args": {"image_path": "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png"},
        },
        tool=_tool("view_image"),
        state={
            "messages": [
                HumanMessage(content="根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(
                    content='{"returned_pages":"21-23","items":[{"node_id":"0005","evidence_blocks":[{"page_number":22,"citation_markdown":"[citation:PRML.pdf p.22](kb://citation?x=1)"}]}]}',
                    tool_call_id="call-evidence",
                    name="get_document_evidence",
                ),
                AIMessage(content="", tool_calls=[{"id": "call-image", "name": "get_document_image", "args": {}}]),
                ToolMessage(
                    content='{"page_number":22,"image_path":"/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png"}',
                    tool_call_id="call-image",
                    name="get_document_image",
                ),
            ]
        },
        runtime=SimpleNamespace(context={"thread_id": "thread-1"}),
    )

    assert blocked_knowledge_visual_tool_message(request) is None


def test_blocked_knowledge_visual_tool_message_rejects_failed_evidence_for_view_image():
    request = ToolCallRequest(
        tool_call={
            "id": "tool-6",
            "name": "view_image",
            "args": {"image_path": "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png"},
        },
        tool=_tool("view_image"),
        state={
            "messages": [
                HumanMessage(content="根据 PRML 里的 Figure 1.1，只根据图片本身回答内容。"),
                AIMessage(content="", tool_calls=[{"id": "call-evidence", "name": "get_document_evidence", "args": {}}]),
                ToolMessage(
                    content="Error: Requested document evidence is too large.",
                    tool_call_id="call-evidence",
                    name="get_document_evidence",
                ),
            ]
        },
        runtime=SimpleNamespace(context={"thread_id": "thread-1"}),
    )

    blocked = blocked_knowledge_visual_tool_message(request)

    assert blocked is not None
    assert "does not count as grounding" in blocked.content
