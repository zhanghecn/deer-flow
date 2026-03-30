import { describe, expect, it } from "vitest";

import type { AgentSkillRef } from "@/core/agents/types";
import type { Skill } from "@/core/skills/type";

import {
  buildSkillMaterializedPath,
  buildSkillSourcePath,
  createSkillRef,
  serializeSkillRefForRequest,
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

    expect(buildSkillSourcePath(skill)).toBe("store/prod/vercel-deploy-claimable");
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
});
