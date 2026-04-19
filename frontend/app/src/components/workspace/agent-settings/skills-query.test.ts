import { describe, expect, it } from "vitest";

import type { Skill } from "@/core/skills/type";

import { filterSkillsByQuery, paginateItems } from "./skills-query";

const SKILLS: Skill[] = [
  {
    name: "playwright-cli",
    description: "Browser automation for testing websites",
    category: "system",
    license: null,
    source_path: "system/skills/playwright-cli",
    enabled: true,
  },
  {
    name: "security-review",
    description: "Audit code for trust-boundary issues",
    category: "custom",
    license: null,
    source_path: "custom/skills/security-review",
    enabled: true,
  },
];

describe("skills-query helpers", () => {
  it("matches against name, source path, and localized description", () => {
    expect(filterSkillsByQuery(SKILLS, "browser automation", "en-US")).toEqual([
      SKILLS[0],
    ]);
    expect(
      filterSkillsByQuery(SKILLS, "custom/skills/security-review", "en-US"),
    ).toEqual([SKILLS[1]]);
  });

  it("paginates items with bounded page numbers", () => {
    const items = Array.from({ length: 10 }, (_, index) => index + 1);
    const page = paginateItems(items, 3, 4);

    expect(page.currentPage).toBe(3);
    expect(page.totalPages).toBe(3);
    expect(page.pageItems).toEqual([9, 10]);
    expect(page.startIndex).toBe(8);
    expect(page.endIndex).toBe(10);
  });
});
