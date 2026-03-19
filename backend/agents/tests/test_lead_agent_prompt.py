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
