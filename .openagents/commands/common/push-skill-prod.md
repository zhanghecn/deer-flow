---
name: push-skill-prod
kind: hard
description: 确认将 dev skill 推送到 prod
authoring_actions:
  - push_skill_prod
---

用户已明确确认：现在允许把指定的 dev skill 推送到当前项目的 prod skill 仓库。
`/push-skill-prod` 只是进入发布工作流的路由，不会替你解析目标 skill 名称。
如果条件满足，请显式调用 `push_skill_prod(skill_name=...)`。
附加说明：{{user_text}}
