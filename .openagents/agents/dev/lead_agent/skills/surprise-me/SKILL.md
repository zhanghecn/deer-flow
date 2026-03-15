---
name: surprise-me
description: Create a delightful, unexpected "wow" experience for the user by dynamically discovering and creatively combining other enabled skills. Triggers when the user says "surprise me" or any request expressing a desire for an unexpected creative showcase. Also triggers when the user is bored, wants inspiration, or asks for "something interesting".
---

# Surprise Me

Deliver an unexpected, delightful experience by dynamically discovering available skills and combining them creatively.

## Workflow

### Step 1: Discover Available Skills

Read all the skills listed in the <available_skills>.

### Step 2: Plan the Surprise

Select **1 to 3** skills and design a creative mashup. The goal is a single cohesive deliverable, not separate demos.

Only select skills that can complete successfully in the current runtime.
If a skill requires unavailable credentials, binaries, or services, skip it and choose a different combination.

**Creative combination principles:**
- Juxtapose skills in unexpected ways (e.g., a presentation about algorithmic art, a research report turned into a slide deck, a styled doc with canvas-designed illustrations)
- Incorporate the user's known interests/context from memory if available
- Prioritize visual impact and emotional delight over information density
- The output should feel like a gift — polished, surprising, and fun

**Theme ideas (pick or remix):**
- Something tied to today's date, season, or trending news
- A mini creative project the user never asked for but would love
- A playful "what if" concept
- An aesthetic artifact combining data + design
- A fun interactive HTML/React experience

### Step 3: Fallback — No Other Skills Available

If no other skills are discovered (only surprise-me exists), use one of these fallbacks:

1. **News-based surprise**: Search today's news for a fascinating story, then create a beautifully designed HTML artifact presenting it in a visually striking way
2. **Interactive HTML experience**: Build a creative single-page web experience — generative art, a mini-game, a visual poem, an animated infographic, or an interactive story
3. **Personalized artifact**: Use known user context to create something personal and delightful

### Step 4: Execute

1. Read the full SKILL.md body of each selected skill
2. Follow each skill's instructions for technical execution
3. Combine outputs into one cohesive deliverable
4. Put the final user-facing deliverable in `/mnt/user-data/outputs`, not only in `/mnt/user-data/workspace`
5. If the deliverable is a frontend/web experience, save it as `/mnt/user-data/outputs/<project-name>/index.html` so the client can render it directly
6. Call `present_files` for every final file you want the user to open or preview
7. Present the result with minimal preamble — let the work speak for itself

Before committing to a skill-dependent branch, verify that the required runtime resources are available.
If a chosen skill fails to produce its promised output file, abandon that branch and finish with a different deliverable that can actually be presented.

### Output Protocol

- `/mnt/user-data/workspace` is for temporary prompts, scratch files, and intermediate assets only
- The user should never be left with only a workspace file path as the final result
- A successful surprise ends with one or more final files in `/mnt/user-data/outputs` plus a `present_files` call
- Prefer a single polished deliverable over many disconnected files

### Step 5: Reveal

Present the surprise with minimal spoilers. A short teaser line, then the artifact.

- **Good reveal:** "I made you something ✨" + [the artifact]
- **Bad reveal:** "I decided to combine the pptx skill with the canvas-design skill to create a presentation about..." (kills the surprise)
