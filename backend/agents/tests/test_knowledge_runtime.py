from types import SimpleNamespace

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.runtime import Runtime

from src.agents.middlewares.knowledge_context_middleware import (
    KnowledgeContextMiddleware,
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
    status: str = "ready",
) -> KnowledgeDocumentRecord:
    return KnowledgeDocumentRecord(
        id=document_id,
        knowledge_base_id="kb-1",
        knowledge_base_name=knowledge_base_name,
        knowledge_base_description=None,
        display_name=name,
        file_kind="pdf",
        locator_type="page",
        status=status,
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


def _patch_thread_documents(monkeypatch, *documents: KnowledgeDocumentRecord) -> None:
    monkeypatch.setattr(
        "src.agents.middlewares.knowledge_context_middleware.KnowledgeService.get_thread_document_records",
        lambda self, *, user_id, thread_id, ready_only=False: list(documents),
    )


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
    _patch_thread_documents(
        monkeypatch,
        _document("annual-report.pdf", document_id="user-from-binding:thread-1"),
    )

    prompt = build_knowledge_context_prompt({"thread_id": "thread-1"})

    assert "<knowledge_context>" in prompt
    assert "<knowledge_thread_bindings>" in prompt
    assert "1 attached knowledge document(s), 1 ready for retrieval, across 1 knowledge base(s)" in prompt
    assert "<knowledge_attached_documents>" in prompt
    assert "<document_id>user-from-binding:thread-1</document_id>" in prompt
    assert "<display_name>annual-report.pdf</display_name>" in prompt
    assert "<knowledge_base>Finance</knowledge_base>" in prompt


def test_build_knowledge_context_prompt_prioritizes_user_and_agent_document_targets(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document("annual-report.pdf", document_id="doc-1"),
        _document("board-deck-q4.md", document_id="doc-2"),
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
    assert "<activation_rule>" in prompt
    assert "<user_targets>" in prompt
    assert "<document_id>doc-1</document_id>" in prompt
    assert "<display_name>annual-report.pdf</display_name>" in prompt
    assert "Treat these explicit targets as the first and authoritative retrieval choice" in prompt
    assert "Stay inside the attached knowledge toolchain for them" in prompt
    assert "Do not use generic filesystem or shell tools to locate or inspect document copies" in prompt
    assert "ignore this block and continue the normal general-purpose workflow" in prompt
    assert "attached documents already define the retrieval scope" in prompt
    assert "When this protocol is active, refresh evidence in the current turn before answering" in prompt
    assert "max_depth=2" in prompt
    assert "root_cursor" in prompt
    assert "When this protocol is active, prefer the injected ASCII" in prompt
    assert "When this protocol is active, pick one concrete ready document_id" in prompt
    assert "When this protocol is active, stay with the knowledge tools first" in prompt
    assert "<agent_default_targets>" in prompt
    assert "<display_name>board-deck-q4.md</display_name>" in prompt
    assert "get_document_evidence" in prompt
    assert "answer_requires_evidence=true" in prompt
    assert "display_markdown" in prompt
    assert "image_markdown" in prompt
    assert "retrieve visual evidence first" in prompt
    assert "instead of opening spill files" in prompt
    assert "do not inspect indexed knowledge artifacts in runtime outputs directly" in prompt
    assert "KB retrieval has started, do not switch to grep, glob, read_file, ls, find, execute" in prompt
    assert "do not inspect /mnt/user-data/outputs/.knowledge or /large_tool_results/... directly" in prompt
    assert "run_command" not in prompt
    assert "<knowledge_thread_bindings>" in prompt
    assert "<knowledge_bases>" in prompt
    assert "<knowledge_base>Finance</knowledge_base>" in prompt
    assert "<ready_documents>" in prompt


def test_build_knowledge_context_prompt_applies_kb_tool_priority_without_explicit_mentions(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document("annual-report.pdf", document_id="doc-1"),
    )

    prompt = build_knowledge_context_prompt(
        {
            "thread_id": "thread-1",
            "original_user_input": "总结这份已挂载年报里最重要的三项风险。",
        }
    )

    assert "<knowledge_document_selection>" not in prompt
    assert "<knowledge_tool_protocol>" in prompt
    assert "attached documents already define the retrieval scope" in prompt
    assert "When this protocol is active, stay with the knowledge tools first" in prompt
    assert "KB retrieval has started, do not switch to grep, glob, read_file, ls, find, execute" in prompt
    assert "do not inspect /mnt/user-data/outputs/.knowledge or /large_tool_results/... directly" in prompt
    assert "ignore this block and continue the normal general-purpose workflow" in prompt


def test_build_knowledge_context_prompt_includes_unavailable_attached_documents(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document("annual-report.pdf", document_id="doc-1", status="ready_degraded"),
        _document("board-deck-q4.md", document_id="doc-2", status="processing"),
    )

    prompt = build_knowledge_context_prompt({"thread_id": "thread-1"})

    assert "<ready_documents>" in prompt
    assert "<document_id>doc-1</document_id>" in prompt
    assert "<status>ready_degraded</status>" in prompt
    assert "<unavailable_documents>" in prompt
    assert "<document_id>doc-2</document_id>" in prompt
    assert "<status>processing</status>" in prompt
    assert "No attached documents are ready for retrieval" not in prompt


def test_knowledge_context_middleware_keeps_model_tool_list_stable_for_attached_document_turns(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document(
            "E210郑民生-民间盲派八字.md",
            document_id="doc-1",
            knowledge_base_name="E210郑民生-民间盲派八字",
        ),
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
    _patch_thread_documents(
        monkeypatch,
        _document(
            "E210郑民生-民间盲派八字.md",
            document_id="doc-1",
            knowledge_base_name="E210郑民生-民间盲派八字",
        ),
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
    _patch_thread_documents(
        monkeypatch,
        _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML"),
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


def test_knowledge_context_middleware_does_not_retry_tree_only_answer_without_current_turn_evidence(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML"),
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
        return ModelResponse(
            result=[
                AIMessage(
                    content="目录大概分为几部分，后面会讲概率模型、分类与降维。",
                )
            ]
        )

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 1
    assert len(seen_system_messages) == 1
    assert "<knowledge_response_recovery>" not in seen_system_messages[0]
    assert response.result[-1].content == "目录大概分为几部分，后面会讲概率模型、分类与降维。"


def test_knowledge_context_middleware_does_not_retry_evidence_answer_without_visible_citation(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML"),
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
        return ModelResponse(result=[AIMessage(content="Figure 1.1 展示了概率密度。")])

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 1
    assert len(seen_system_messages) == 1
    assert "<knowledge_response_recovery>" not in seen_system_messages[0]
    assert response.result[-1].content == "Figure 1.1 展示了概率密度。"


def test_knowledge_context_middleware_does_not_retry_grounded_evidence_answer_without_visible_citation(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document("PRML.pdf", document_id="doc-1", knowledge_base_name="PRML"),
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
        return ModelResponse(
            result=[
                AIMessage(
                    content="答案如下：\n\n![Figure 1.1](/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png)"
                )
            ]
        )

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 1
    assert len(seen_system_messages) == 1
    assert "<knowledge_response_recovery>" not in seen_system_messages[0]
    assert response.result[-1].content == "答案如下：\n\n![Figure 1.1](/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png)"


def test_knowledge_context_middleware_does_not_retry_inline_asset_without_structured_signal(monkeypatch):
    monkeypatch.setattr(
        "src.knowledge.runtime.get_runtime_db_store",
        lambda: _FakeDBStore(_FakeBinding("user-from-binding")),
    )
    _patch_thread_documents(
        monkeypatch,
        _document("annual-report.pdf", document_id="doc-1", knowledge_base_name="Annual"),
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
        return ModelResponse(
            result=[
                AIMessage(
                    content="封面展示的是联邦储备委员会大楼。[citation:annual-report.pdf p.1](kb://citation?x=1)"
                )
            ]
        )

    middleware = KnowledgeContextMiddleware()
    response = middleware.wrap_model_call(request, handler)

    assert call_count == 1
    assert len(seen_system_messages) == 1
    assert "<knowledge_response_recovery>" not in seen_system_messages[0]
    assert "(kb://citation" in response.result[-1].content
