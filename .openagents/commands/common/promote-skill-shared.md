---
name: promote-skill-shared
kind: hard
description: 确认将 prod skill 提升为 shared
authoring_actions:
  - promote_skill_shared
---

用户已明确确认：现在允许把指定的 prod store skill 提升为当前项目的 shared skill。
如果条件满足，请调用 `promote_skill_shared`。
附加说明：{{user_text}}
