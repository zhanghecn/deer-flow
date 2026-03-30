import type { Locale } from "@/core/i18n";

import type { Skill } from "./type";

export const SKILL_SCOPE_ORDER = ["store/dev", "store/prod"] as const;
export const DEV_AGENT_SKILL_SCOPE_ORDER = ["store/dev", "store/prod"] as const;
export const PROD_AGENT_SKILL_SCOPE_ORDER = ["store/prod"] as const;

export type SkillScope = (typeof SKILL_SCOPE_ORDER)[number];

export function normalizeSkillScope(
  scope: string | null | undefined,
): SkillScope | null {
  if (scope === "store/dev" || scope === "store/prod") {
    return scope;
  }
  return null;
}

export function formatSkillScopeLabel(
  scope: SkillScope,
  locale: Locale = "en-US",
) {
  if (locale === "zh-CN") {
    if (scope === "store/dev") {
      return "开发仓库";
    }
    return "生产仓库";
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

export function getAllowedSkillScopesForAgent(
  status: "dev" | "prod",
) {
  return status === "prod"
    ? [...PROD_AGENT_SKILL_SCOPE_ORDER]
    : [...DEV_AGENT_SKILL_SCOPE_ORDER];
}

export function filterSkillsByScope<T extends Pick<Skill, "category">>(
  skills: T[],
  scope: SkillScope,
) {
  return skills.filter(
    (skill) => normalizeSkillScope(skill.category) === scope,
  );
}

export function getDuplicateSkillNames(
  skills: Pick<Skill, "name" | "category">[],
  scopes: SkillScope[],
) {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const scope = normalizeSkillScope(skill.category);
    if (!scope || !scopes.includes(scope)) {
      continue;
    }
    counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
}
