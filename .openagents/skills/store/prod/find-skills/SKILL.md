---
name: find-skills
description: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.
---

# Find Skills

Use this skill when the user wants an existing skill from the current skills ecosystem instead of drafting a brand-new skill from scratch.

## Core Rules

- Search the local archived skill store first.
- The local archived store lives under `/mnt/skills/store/dev/...` and `/mnt/skills/store/prod/...`.
- Use normal file-reading tools such as `ls`, `glob`, `grep`, and `read_file` to locate candidate skills and inspect their `SKILL.md`.
- If a suitable local archived skill already exists, reuse it. Do not install or create a duplicate just because an external registry also has something similar.
- When a local skill is selected for agent creation, keep its exact `source_path` such as `store/dev/contract-review` or `store/prod/frontend-design`.
- Only run external registry discovery when the user explicitly wants installation, or when no suitable local archived skill exists.
- When a missing skill should be installed for a dev workflow, prefer the built-in `install_skill_from_registry` tool.
- Search can be parallel, but install skills one at a time. Wait for each install result before starting the next install.
- Do not use `npx skills add`, `cp`, `mkdir`, `write_file`, or similar shell steps to fake installation into a runtime directory.
- Treat `/mnt/user-data/agents/{status}/{name}/skills/...` as a runtime copy only. It is never proof that a skill was installed durably.
- If the current run is `prod`, or the install tool is unavailable, say that clearly instead of claiming success. Prod usage must rely on already-published prod skills.

## Workflow

### Step 1: Understand the Request

Identify:

1. The domain, such as design, video, writing, coding, testing, deployment, or research
2. The specific job the user wants done
3. Whether the user wants local skill reuse only, local reuse plus agent creation, or external discovery / installation

### Step 2: Search the Local Archived Store First

Inspect the local archived store before doing anything external:

- `/mnt/skills/store/dev/...`
- `/mnt/skills/store/prod/...`

Use filesystem tools to:

1. List candidate skill directories
2. Read candidate `SKILL.md` files
3. Compare the skill descriptions and workflows to the user's request
4. Record the exact `source_path` for each good match

Examples of valid local `source_path` values:

- `store/dev/contract-review`
- `store/prod/find-skills`
- `store/prod/frontend-design`

### Step 3: Present the Best Local Match

When you find relevant local skills, present:

1. The skill name
2. Why it matches the request
3. The exact local `source_path`
4. Whether it already exists in `store/dev` or `store/prod`
5. Whether the next step is to attach it to an agent or simply use it directly

If the task is agent creation or agent update, the final persistence step must preserve that exact source:

```text
setup_agent(..., skills=[{source_path: "store/dev/contract-review"}])
```

If the same skill name exists in both `store/dev` and `store/prod`, do not collapse it to a bare `{name}` entry.

### Step 4: External Discovery Only When Needed

Only if no suitable local archived skill exists, or the user explicitly asks for external discovery, run:

```bash
npx --yes skills find <query>
```

Examples:

- `npx --yes skills find ui design`
- `npx --yes skills find video generation`
- `npx --yes skills find contract review`
- `npx --yes skills find playwright testing`

Typical results look like:

```text
Install with npx skills add <owner/repo@skill>

vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### Step 5: Install Only Through the Durable Path

If the user explicitly wants installation in a dev workflow, call:

```text
install_skill_from_registry(source="owner/repo@skill-name")
```

After the tool succeeds:

1. Report the exact installed skill name
2. State that it was persisted into the durable dev skill store
3. Do not describe `/mnt/user-data/agents/.../skills` as the installation target
4. If multiple skills must be installed, call the install tool sequentially instead of in parallel

Manual fallback for developers only:

```bash
bash <current-skill-dir>/scripts/install-skill.sh <owner/repo@skill-name> <target-root>
```

This helper requires an explicit target root and is not the normal agent workflow.

## Common Categories

| Category | Example queries |
| --- | --- |
| Design | `design`, `ui`, `ux`, `landing page` |
| Video | `video`, `video generation`, `film`, `storyboard` |
| Writing | `writing`, `copywriting`, `blog`, `marketing` |
| Coding | `coding`, `programming`, `react`, `typescript`, `review` |
| Testing | `testing`, `playwright`, `jest`, `e2e` |
| Legal | `contract review`, `legal review`, `document audit` |
| DevOps | `deploy`, `docker`, `ci-cd`, `kubernetes` |

## When No Skill Is Found

If no good match exists:

1. Say that no suitable existing skill was found in the local archived store
2. If relevant, say whether external registry discovery was also checked
3. Offer to help directly
4. Suggest creating a new skill only if that is the right next step
