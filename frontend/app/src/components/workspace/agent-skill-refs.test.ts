import { describe, expect, it } from "vitest";

import type { AgentSkillRef } from "@/core/agents/types";
import type { Skill } from "@/core/skills/type";

import {
  buildSkillMaterializedPath,
  buildSkillSourcePath,
  createSkillRef,
  isSkillRefSelected,
  removeSkillRef,
  serializeSkillRefForRequest,
  toggleSkillRefSelection,
} from "./agent-skill-refs";

function createSkill(overrides: Partial<Skill>): Skill {
  return {
    name: "bootstrap",
    description: "",
    category: "store/prod",
    license: null,
    enabled: true,
    ...overrides,
  };
}

describe("agent skill refs", () => {
  it("preserves explicit aliased source paths", () => {
    const skill = createSkill({
      name: "vercel-deploy",
      source_path: "store/prod/vercel-deploy-claimable",
    });

    expect(buildSkillSourcePath(skill)).toBe(
      "store/prod/vercel-deploy-claimable",
    );
    expect(buildSkillMaterializedPath(skill)).toBe(
      "skills/vercel-deploy-claimable",
    );
  });

  it("derives nested materialized paths from store sources", () => {
    const skill = createSkill({
      name: "contract-review",
      category: "store/prod",
      source_path: "store/prod/contracts/review",
    });

    expect(buildSkillMaterializedPath(skill)).toBe("skills/contracts/review");
  });

  it("creates sourced skill refs with derived archive paths", () => {
    const skillRef = createSkillRef(
      createSkill({
        name: "vercel-deploy",
        source_path: "store/prod/vercel-deploy-claimable",
      }),
    );

    expect(skillRef).toEqual({
      name: "vercel-deploy",
      category: "store/prod",
      source_path: "store/prod/vercel-deploy-claimable",
      materialized_path: "skills/vercel-deploy-claimable",
    });
  });

  it("derives canonical materialized paths from system skill sources", () => {
    const skill = createSkill({
      name: "bootstrap",
      category: "system",
      source_path: "system/skills/bootstrap",
    });

    expect(buildSkillMaterializedPath(skill)).toBe("skills/bootstrap");
  });

  it("normalizes non-canonical system skill sources before save", () => {
    const skill = createSkill({
      name: "bootstrap",
      category: "system",
      source_path: "system/bootstrap",
    });

    expect(buildSkillSourcePath(skill)).toBe("system/skills/bootstrap");
    expect(buildSkillMaterializedPath(skill)).toBe("skills/bootstrap");
  });

  it("builds canonical source paths for system skills without explicit source_path", () => {
    const skill = createSkill({
      name: "bootstrap",
      category: "system",
      source_path: undefined,
    });

    expect(buildSkillSourcePath(skill)).toBe("system/skills/bootstrap");
    expect(buildSkillMaterializedPath(skill)).toBe("skills/bootstrap");
  });

  it("strips derived fields from sourced skill requests", () => {
    const skillRef: AgentSkillRef = {
      name: "vercel-deploy",
      category: "store/prod",
      source_path: "store/prod/vercel-deploy-claimable",
      materialized_path: "skills/vercel-deploy-claimable",
    };

    expect(serializeSkillRefForRequest(skillRef)).toEqual({
      name: "vercel-deploy",
      source_path: "store/prod/vercel-deploy-claimable",
    });
  });

  it("preserves agent-owned materialized paths", () => {
    const skillRef: AgentSkillRef = {
      name: "contract-review",
      category: null,
      source_path: null,
      materialized_path: "skills/contract-review",
    };

    expect(serializeSkillRefForRequest(skillRef)).toEqual({
      name: "contract-review",
      materialized_path: "skills/contract-review",
    });
  });

  it("replaces duplicate archived store names with the newly chosen source", () => {
    const selected = toggleSkillRefSelection(
      [
        {
          name: "frontend-dev",
          category: "store/dev",
          source_path: "store/dev/frontend-dev",
          materialized_path: "skills/frontend-dev",
        },
      ],
      {
        name: "frontend-dev",
        category: "store/prod",
        source_path: "store/prod/frontend-dev",
        materialized_path: "skills/frontend-dev",
      },
    );

    expect(selected).toEqual([
      {
        name: "frontend-dev",
        category: "store/prod",
        source_path: "store/prod/frontend-dev",
        materialized_path: "skills/frontend-dev",
      },
    ]);
  });

  it("replaces same-name archived variants across canonical scopes", () => {
    const selected = toggleSkillRefSelection(
      [
        {
          name: "china-lawyer-analyst",
          category: "system",
          source_path: "system/skills/china-lawyer-analyst",
          materialized_path: "skills/china-lawyer-analyst",
        },
      ],
      {
        name: "china-lawyer-analyst",
        category: "store/dev",
        source_path: "store/dev/china-lawyer-analyst",
        materialized_path: "skills/china-lawyer-analyst",
      },
    );

    expect(selected).toEqual([
      {
        name: "china-lawyer-analyst",
        category: "store/dev",
        source_path: "store/dev/china-lawyer-analyst",
        materialized_path: "skills/china-lawyer-analyst",
      },
    ]);
  });

  it("removes selected skill refs by their stable key", () => {
    const selected = removeSkillRef(
      [
        {
          name: "frontend-dev",
          category: "store/prod",
          source_path: "store/prod/frontend-dev",
          materialized_path: "skills/frontend-dev",
        },
      ],
      {
        name: "frontend-dev",
        category: "store/prod",
        source_path: "store/prod/frontend-dev",
        materialized_path: "skills/frontend-dev",
      },
    );

    expect(selected).toEqual([]);
  });

  it("replaces same-name agent-owned skills when selecting an archived source", () => {
    const selected = toggleSkillRefSelection(
      [
        {
          name: "frontend-dev",
          category: null,
          source_path: null,
          materialized_path: "skills/custom/frontend-dev",
        },
      ],
      {
        name: "frontend-dev",
        category: "store/prod",
        source_path: "store/prod/frontend-dev",
        materialized_path: "skills/frontend-dev",
      },
    );

    expect(selected).toEqual([
      {
        name: "frontend-dev",
        category: "store/prod",
        source_path: "store/prod/frontend-dev",
        materialized_path: "skills/frontend-dev",
      },
    ]);
  });

  it("detects selected skill refs by exact source path", () => {
    expect(
      isSkillRefSelected(
        [
          {
            name: "frontend-dev",
            category: "store/prod",
            source_path: "store/prod/frontend-dev",
            materialized_path: "skills/frontend-dev",
          },
        ],
        {
          name: "frontend-dev",
          category: "store/dev",
          source_path: "store/dev/frontend-dev",
          materialized_path: "skills/frontend-dev",
        },
      ),
    ).toBe(false);
  });
});
