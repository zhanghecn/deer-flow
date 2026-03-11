---
name: save-agent-to-store
kind: hard
description: 确认将当前 agent 草稿保存到 dev 仓库
authoring_actions:
  - save_agent_to_store
---

用户已明确确认：现在允许把当前 agent 草稿或当前线程里的 dev 运行时修改版保存到 `.openagents/agents/dev`。
如果条件满足，请调用 `save_agent_to_store`。
附加说明：{{user_text}}
