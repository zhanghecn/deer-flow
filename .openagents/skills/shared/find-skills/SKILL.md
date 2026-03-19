---
name: find-skills
description: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.
---

# Find Skills

Use this skill when the user wants an existing skill from the skills ecosystem instead of drafting a brand-new skill from scratch.

## Core Rules

- Search first. Do not install blindly.
- Use `npx --yes skills find <query>` to discover candidates in non-interactive sandboxes.
- Treat `/mnt/user-data/agents/{status}/{name}/skills/...` as a runtime copy only. It is never proof that a skill was installed durably.
- When a missing skill should be installed for a dev workflow, prefer the built-in `install_skill_from_registry` tool.
- Search can be parallel, but install skills one at a time. Wait for each install result before starting the next install.
- Do not use `npx skills add`, `cp`, `mkdir`, `write_file`, or similar shell steps to fake installation into a runtime directory.
- If the current run is `prod`, or the install tool is unavailable, say that clearly instead of claiming success. Prod usage must rely on already-published prod skills.
- If a skill already exists in the available dev/prod stores, reuse that archived skill instead of creating a duplicate same-name dev skill.

## Workflow

### Step 1: Understand the Request

Identify:

1. The domain, such as design, video, writing, coding, testing, deployment, or research
2. The specific job the user wants done
3. Whether the user wants discovery only, or discovery plus installation

### Step 2: Search for Candidates

Run:

```bash
npx --yes skills find <query>
```

Examples:

- `npx --yes skills find ui design`
- `npx --yes skills find video generation`
- `npx --yes skills find copywriting`
- `npx --yes skills find coding`

Typical results look like:

```text
Install with npx skills add <owner/repo@skill>

vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### Step 3: Present the Best Match

When you find relevant skills, present:

1. The skill name
2. Why it matches the request
3. The install source, such as `owner/repo@skill-name`
4. The `skills.sh` link
5. Whether the skill is already available or still needs installation

### Step 4: Install Only Through the Durable Path

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
| DevOps | `deploy`, `docker`, `ci-cd`, `kubernetes` |

## When No Skill Is Found

If no good match exists:

1. Say that no suitable existing skill was found
2. Offer to help directly
3. Suggest creating a new skill only if that is the right next step
