from src.agents.lead_agent import prompt as prompt_module


def test_apply_prompt_template_keeps_base_prompt_free_of_runtime_command_blocks(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template()

    assert "<runtime_command>" not in rendered
    assert "<runtime_command_instruction>" not in rendered
    assert "never expose internal runtime paths such as `/mnt/user-data/...`" in rendered
    assert "verify every explicit user constraint" in rendered
    assert 'approximate length such as "500字左右"' in rendered
    assert "required keywords, and requested scope" in rendered
    assert "put concrete choices in the structured `options` array" in rendered


def test_apply_prompt_template_includes_knowledge_base_retrieval_guardrails(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template()

    assert "Knowledge Base Sources" in rendered
    assert "Knowledge Base Freshness Rule" in rendered
    assert "Knowledge Base Output Contract" in rendered
    assert "Knowledge Base Inline Citation Rule" in rendered
    assert "Knowledge Base Tree Is Not Evidence Rule" in rendered
    assert "Knowledge Base Evidence Before Prose Rule" in rendered
    assert "Knowledge Base Multi-Node Rule" in rendered
    assert "Knowledge Base Retrieval Discipline" in rendered
    assert "copy that exact markdown into the visible answer" in rendered
    assert "Knowledge Base First-Answer Visual Rule" in rendered
    assert "Knowledge Base Figure Rule" in rendered
    assert "Knowledge Base Scope Rule" in rendered
    assert "Knowledge Base Visual Grounding Rule" in rendered
    assert "Knowledge Base Tree Window Rule" in rendered
    assert 'window_mode="root_overview"' in rendered
