---
name: openpencil-design
description: Create or modify OpenPencil `.op` design documents for Deer Flow threads. Use when the user wants a UI page, landing page, dashboard, form, or visual design draft that can be opened in the proxied OpenPencil board.
---

# OpenPencil Design

Create and update OpenPencil `PenDocument` files directly inside the Deer Flow thread-local outputs artifact area.

## Canonical Design File

Unless the user explicitly names another design file, always use:

`/mnt/user-data/outputs/designs/canvas.op`

This file is the single source of truth shared by:

- Deer Flow chat-driven editing
- the proxied OpenPencil design board
- later follow-up turns in the same thread

Do not switch to host paths, Docker paths, or archived agent paths.

## Required Workflow

1. Always start by calling `read_file` on `/mnt/user-data/outputs/designs/canvas.op`.
2. If `read_file` succeeds, treat that JSON as the current source of truth and update that same file.
3. If `read_file` reports that the file does not exist, create it with `write_file`.
4. When updating an existing design, preserve the existing document structure unless the user clearly wants a full redesign.
5. After editing, give a visible chat summary of what changed.
6. Do not create a second mirrored copy elsewhere. This `.op` file already lives under outputs, so the artifact workspace can expose and download it directly.

## Exact Tool Contract

The mutation tools must use the exact canonical path.

- Every `write_file` call must include:
  - `file_path="/mnt/user-data/outputs/designs/canvas.op"`
  - `content="<full pretty-printed PenDocument JSON>"`
- Every `edit_file` call must include:
  - `file_path="/mnt/user-data/outputs/designs/canvas.op"`
  - `old_string="<exact current text from read_file>"`
  - `new_string="<full pretty-printed PenDocument JSON after your update>"`
- Never omit `file_path`.
- Never use `/.`, `.`, a relative path, an archived skill path, or a host path.
- Never pass only a JSON fragment to `content` or `new_string`; write the full document.

## Default Mutation Pattern

For new Deer Flow threads, this file is normally pre-seeded with a minimal document. That means the normal path is:

1. `read_file("/mnt/user-data/outputs/designs/canvas.op")`
2. `edit_file(...)` on that same exact path
3. Replace the full current JSON string with the full updated JSON string

Use `write_file` only when the initial `read_file` proves the file is missing.

### Safe Full-Document Edit Example

```json
{
  "file_path": "/mnt/user-data/outputs/designs/canvas.op",
  "old_string": "{\"version\":\"1.0.0\",\"children\":[]}",
  "new_string": "{\"version\":\"1.0.0\",\"children\":[{\"id\":\"page-root\",\"type\":\"frame\",\"name\":\"Page\",\"width\":1440,\"height\":2200,\"layout\":\"vertical\",\"children\":[]}]}"
}
```

## PenDocument Contract

The file must always remain valid JSON with:

- a string `version`
- either `children` or `pages`

Minimal empty document:

```json
{"version":"1.0.0","children":[]}
```

### Typical Page Skeleton

For a single-page marketing or app screen, prefer a root frame:

```json
{
  "version": "1.0.0",
  "children": [
    {
      "id": "page-root",
      "type": "frame",
      "name": "Page",
      "width": 1440,
      "height": 2200,
      "layout": "vertical",
      "children": []
    }
  ]
}
```

## Design Guidance

Use OpenPencil-compatible node structures and keep layouts intentional.

### Common node types

- `frame`
- `rectangle`
- `text`
- `image`
- `ellipse`
- `line`
- `path`
- `group`

### Useful properties

- `width`, `height`
- `layout`: `vertical`, `horizontal`, `none`
- `gap`
- `padding`
- `justifyContent`
- `alignItems`
- `cornerRadius`
- `fill`
- `stroke`
- `effects`
- `children`

### Schema details that must stay exact

- `fill` must be an array, for example:
  - `[{"type":"solid","color":"#FFFFFF"}]`
  - not `{"color":"#FFFFFF"}`
- `stroke` must use `thickness` plus `fill`, for example:
  - `{"thickness":1,"fill":[{"type":"solid","color":"#E5E7EB"}]}`
  - not `{"width":1,"color":"#E5E7EB"}`
- `padding` must be a number or an array:
  - `24`
  - `[16,24]`
  - `[12,16,12,16]`
  - not `{"left":16,"right":16}`
- `justifyContent` uses OpenPencil enums:
  - `space_between`
  - `space_around`
  - not CSS-style `space-between`
- Text nodes must use `content`, not `text`
- Shadow effects should include `offsetX`, `offsetY`, `blur`, `spread`, `color`

### Text nodes

- Use `content`
- Set `fontSize`, `fontWeight`, `fontFamily` when needed
- Prefer clear hierarchy: headline, subheading, body, caption

### Layout rules

- Do not set arbitrary child `x`/`y` positions inside layout containers
- Prefer container-driven layout over manual absolute positioning
- Keep sibling sizing strategies consistent within one row or column
- For marketing pages, use clear section rhythm instead of one giant flat canvas

## Output Style

When the user asks for a design:

- Create or update the `.op` file
- Summarize the structure you created
- Mention that the design can be opened from the artifact list or the design board

When the user asks for a modification:

- Read the current `.op` file first
- Describe the delta, not the whole file
- Keep previous sections/components unless the user asked to replace them

## Guardrails

- Keep JSON valid and complete
- Prefer stable pretty-printed JSON with normal line breaks and 2-space indentation
- Do not invent non-JSON wrappers
- Do not output partial JSON snippets as if they were already saved
- If a file-mutation tool reports an invalid OpenPencil document error, fix the JSON and retry before replying
- Do not rely on `op` CLI, MCP, Electron, or local desktop-only file APIs
- Do not call `write_file` without an explicit absolute `file_path`
- Do not call `edit_file` without copying the exact current text from `read_file`
- Do not rewrite the document from scratch if a focused edit is enough
