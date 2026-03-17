import type { Skill } from "./type";

export const SKILL_SCOPE_ORDER = ["shared", "store/dev", "store/prod"] as const;

export type SkillScope = (typeof SKILL_SCOPE_ORDER)[number];

export function normalizeSkillScope(
  scope: string | null | undefined,
): SkillScope | null {
  if (scope === "shared" || scope === "store/dev" || scope === "store/prod") {
    return scope;
  }
  return null;
}

export function formatSkillScopeLabel(scope: SkillScope) {
  if (scope === "shared") {
    return "Shared";
  }
  if (scope === "store/dev") {
    return "Store Dev";
  }
  return "Store Prod";
}

export function getSkillScopes(skills: Pick<Skill, "category">[]) {
  return SKILL_SCOPE_ORDER.filter((scope) =>
    skills.some((skill) => normalizeSkillScope(skill.category) === scope),
  );
}

export function filterSkillsByScope<T extends Pick<Skill, "category">>(
  skills: T[],
  scope: SkillScope,
) {
  return skills.filter(
    (skill) => normalizeSkillScope(skill.category) === scope,
  );
}
