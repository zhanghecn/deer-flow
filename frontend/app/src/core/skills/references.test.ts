import { describe, expect, it } from "vitest";

import {
  extractSkillReferences,
  getSkillReferenceQuery,
} from "./references";

describe("skill references", () => {
  it("extracts distinct skill references", () => {
    expect(
      extractSkillReferences("Use $frontend-design then $copywriting and $frontend-design again"),
    ).toEqual(["frontend-design", "copywriting"]);
  });

  it("detects the active trailing reference query", () => {
    expect(getSkillReferenceQuery("$fr")).toBe("fr");
    expect(getSkillReferenceQuery("please use $frontend")).toBe("frontend");
    expect(getSkillReferenceQuery("plain text")).toBeNull();
  });
});
