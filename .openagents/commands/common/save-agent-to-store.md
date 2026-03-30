---
name: save-agent-to-store
kind: hard
description: 确认将当前 agent 草稿保存到 dev 仓库
authoring_actions:
  - save_agent_to_store
---

用户已明确确认：现在允许把当前 agent 草稿或当前线程里的 dev 运行时修改版保存到当前项目的 dev agent 仓库。
`/save-agent-to-store` 只是进入保存工作流的路由，不会替你解析目标 agent 名称。
如果当前运行不是被保存的那个非 `lead_agent` dev agent 本身，你必须显式传 `save_agent_to_store(agent_name=...)`。
如果条件满足，请调用 `save_agent_to_store`。
附加说明：{{user_text}}
