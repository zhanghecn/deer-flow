from src.agents.lead_agent import prompt as prompt_module


def test_apply_prompt_template_includes_backend_resolved_command_prompt(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template(
        command_name="create-agent",
        command_kind="soft",
        command_args="请创建一个合同审查智能体",
        command_prompt="你现在开始一个 agent 创作任务。\n用户需求：\n请创建一个合同审查智能体",
    )

    assert "<runtime_command>" in rendered
    assert "command_name: create-agent" in rendered
    assert "<runtime_command_instruction>" in rendered
    assert "请创建一个合同审查智能体" in rendered
