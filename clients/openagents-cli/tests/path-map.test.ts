import { expect, test } from "bun:test"

import { createPathMap, rewriteVirtualPath, rewriteVirtualPathsInCommand } from "../src/path-map"

test("rewriteVirtualPath maps workspace and runtime roots", () => {
  const map = createPathMap("/tmp/workspace", "/tmp/runtime")

  expect(rewriteVirtualPath("/mnt/user-data/workspace/src/app.ts", map)).toBe("/tmp/workspace/src/app.ts")
  expect(rewriteVirtualPath("/mnt/user-data/tmp/cache.db", map)).toBe("/tmp/runtime/tmp/cache.db")
  expect(rewriteVirtualPath("/mnt/user-data/outputs/report.txt", map)).toBe("/tmp/runtime/outputs/report.txt")
  expect(rewriteVirtualPath("/mnt/user-data/agents/dev/lead_agent/AGENTS.md", map)).toBe(
    "/tmp/runtime/agents/dev/lead_agent/AGENTS.md",
  )
  expect(rewriteVirtualPath("/agents/dev/lead_agent/skills/demo/SKILL.md", map)).toBe(
    "/tmp/runtime/agents/dev/lead_agent/skills/demo/SKILL.md",
  )
  expect(rewriteVirtualPath("/authoring/skills/demo/SKILL.md", map)).toBe(
    "/tmp/runtime/authoring/skills/demo/SKILL.md",
  )
})

test("rewriteVirtualPathsInCommand rewrites absolute virtual paths inside shell commands", () => {
  const map = createPathMap("/tmp/workspace", "/tmp/runtime")
  const rewritten = rewriteVirtualPathsInCommand(
    "cat /agents/dev/lead_agent/skills/demo/SKILL.md > /tmp/demo-copy.md",
    map,
  )

  expect(rewritten).toContain("/tmp/runtime/agents/dev/lead_agent/skills/demo/SKILL.md")
  expect(rewritten).toContain("/tmp/runtime/tmp/demo-copy.md")
})
