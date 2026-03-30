---
name: save-skill-to-store
kind: hard
description: 确认将当前 skill 草稿保存到 dev 仓库
authoring_actions:
  - save_skill_to_store
---

用户已明确确认：现在允许把当前 skill 草稿保存到当前项目的 dev skill 仓库。
`/save-skill-to-store` 只是进入保存工作流的路由，不会替你解析目标 skill 名称。
如果条件满足，请显式调用 `save_skill_to_store(skill_name=...)`。
附加说明：{{user_text}}
