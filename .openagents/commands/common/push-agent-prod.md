---
name: push-agent-prod
kind: hard
description: 确认将 dev agent 推送到 prod
authoring_actions:
  - push_agent_prod
---

用户已明确确认：现在允许把指定的 dev agent 推送到当前项目的 prod agent 仓库。
`/push-agent-prod` 只是进入发布工作流的路由，不会替你解析目标 agent 名称。
如果当前运行不是要发布的那个非 `lead_agent` dev agent 本身，你必须显式传 `push_agent_prod(agent_name=...)`。
如果条件满足，请调用 `push_agent_prod`。
附加说明：{{user_text}}
