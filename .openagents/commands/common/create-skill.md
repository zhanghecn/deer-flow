---
name: create-skill
kind: soft
description: 开始创建一个新技能
authoring_actions: []
---

你现在开始一个 skill 创作任务。
用户需求：
{{user_text}}

默认目标：尽快产出一个可测试的最小可用 skill 草稿，而不是一次性做成大而全的技能包。

执行要求：
- 默认不要先联网，也不要大范围检索或长时间探索；只有在用户明确要求、或技能内容明显依赖你不了解的最新外部事实时才这么做。
- 默认不要先调用 `find-skills`；只有当用户更像是在找现成 skill，而不是要求你新建 skill 时才考虑。
- 默认不要先完整走 `skill-creator` 的扩展工作流；如果只是常见领域 skill，请直接起草。只有在你确实需要模板或校验帮助时，才最小化使用其中的脚本或参考。
- 先在 `/mnt/user-data/authoring/skills` 下起草，再等待用户明确保存。
- 首轮草稿默认创建 `SKILL.md`、`skill.i18n.json`，以及最多 1-2 个被 `SKILL.md` 直接引用的小型 reference 文件。
- `skill.i18n.json` 只用于 skill 描述的中英文元数据，locale 只允许 `en-US` 和 `zh-CN`。
- `SKILL.md` frontmatter 里的 `description` 仍然必须保留，作为原始描述和默认回退值；不要把 i18n 字段塞进 frontmatter。
- 如果当前只确定一种语言，就只填写已确认的 locale；不要为了凑齐中英文而臆造翻译。任何未填写或取不到的 locale，后续运行时都会回退到 `SKILL.md` 的原始 `description`。
- 不要生成示例 assets、占位 scripts、冗长参考手册、演示文件，除非用户明确要求。
- 对文件输入类 skill，不要默认假设 `.pdf` / `.docx` 会自动生成同名 `.md` 转换文件；应优先指导智能体直接对用户上传的原始文件路径调用 `read_file`，只有在用户明确提供额外提取产物时才读取这些派生文件。
- 不要在草稿已可用后继续做额外美化、扩展、清理或多轮验证；完成可测试草稿后就结束当前回合。
- 当前回合结束时，必须给出简短结果说明，并附上 `<next_steps>`。只要 skill 已可测试，前两个 next-step 默认应分别是“测试 skill”和“创建 agent”。
- “测试 skill” 这个 next-step 的 `prompt` 必须明确说明：使用当前线程内刚创建的 draft skill，并先读取 `/mnt/user-data/authoring/skills/<skill-name>/SKILL.md`。
- “测试 skill” 这个 next-step 默认不要让后续回合去模拟、杜撰或自动生成一份示例合同。若当前线程里已有合适的真实上传文件，就直接用那个文件测试；若还没有真实文件，就让后续回合先提示用户上传或选择一份真实合同再开始测试。
- “创建 agent” 这个 next-step 的 `prompt` 必须明确说明：agent 要基于当前线程内的 draft skill 创建，不能假设该 skill 已经发布到 store/shared。
- “创建 agent” 这个 next-step 应引导后续回合创建一个可直接切换测试的 `dev` agent，并生成正式 agent archive 所需的 `AGENTS.md`、`config.yaml` 和 copied skill。
- 第三个可选 next-step 再考虑“优化 skill”或“保存 skill”；不要用“安装到当前 agent”替代“创建 agent”。
