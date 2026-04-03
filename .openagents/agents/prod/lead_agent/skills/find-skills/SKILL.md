---
name: find-skills
description: Helps users discover, reuse, and install agent skills. Use this skill when the user wants capabilities that may exist as installable skills, including when they paste a bare registry reference, skill marketplace source, or GitHub repository/path that appears to be a skills library.
---

# Find Skills

Use this skill when the user wants an existing skill from the current skills ecosystem instead of drafting a brand-new skill from scratch.

## Core Rules

- Search the local archived skill store first.
- The local archived store lives under `/mnt/skills/store/dev/...` and `/mnt/skills/store/prod/...`.
- Use normal file-reading tools such as `ls`, `glob`, `grep`, and `read_file` to locate candidate skills and inspect their `SKILL.md`.
- If a suitable local archived skill already exists, reuse it. Do not install or create a duplicate just because an external registry also has something similar.
- If the user pastes a bare GitHub repo or path that appears to be a skills library, treat it as a discovery/install lead rather than defaulting to repository research.
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

Special handling for external sources:

- A bare GitHub repo or path can still mean "help me install or reuse skills from here" even if the user did not literally say "install".
- If the user explicitly asks to install everything from a bare repo root or multi-skill catalog, call `install_skill_from_registry(source="<repo-root-or-url>")` directly. Do not detour through `web_fetch`, repository research, or shell installation first.
- If the source points to a single installable skill, continue the install workflow.
- If the source looks like a multi-skill catalog or repository root and the user only wants discovery, inspect it enough to identify installable candidates, then ask a focused follow-up or present the best candidates.

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

If the user supplied a GitHub source directly:

1. Determine whether it is a single skill path or a multi-skill repository.
2. If the user explicitly asked to install everything from that repo root, call `install_skill_from_registry(source="<repo-root-or-url>")` directly.
3. If it is a multi-skill repository and the user only wants discovery, identify candidate skills first instead of claiming success on the whole repo.
4. Convert to a concrete installable source only when you know the exact skill to install.

### Step 5: Install Only Through the Durable Path

If the user explicitly wants installation in a dev workflow, call:

```text
install_skill_from_registry(source="owner/repo@skill-name")
```

For a bare registry repo or GitHub repo root that should install everything it exposes, call:

```text
install_skill_from_registry(source="https://github.com/owner/skills.git")
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
