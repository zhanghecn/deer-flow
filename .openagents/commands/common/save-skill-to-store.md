---
name: save-skill-to-store
kind: hard
description: 确认将当前 skill 草稿保存到 dev 仓库
authoring_actions:
  - save_skill_to_store
---

用户已明确确认：现在允许把当前 skill 草稿保存到 `.openagents/skills/store/dev`。
如果条件满足，请调用 `save_skill_to_store`。
附加说明：{{user_text}}
