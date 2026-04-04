import type { AgentSkillRef, AgentSkillRefInput } from "@/core/agents/types";
import {
  normalizeSkillScope,
  normalizeSkillScopeFromSourcePath,
  type SkillScope,
} from "@/core/skills/scope";
import type { Skill } from "@/core/skills/type";

const SKILL_SOURCE_SCOPE_PREFIXES = [
  "system/skills/",
  "custom/skills/",
  "store/prod/",
  "store/dev/",
] as const;

export function skillRefKey(skillRef: AgentSkillRef) {
  return (
    skillRef.source_path ??
    skillRef.materialized_path ??
    `${skillRef.category ?? "uncategorized"}:${skillRef.name}`
  );
}

function isArchivedLibrarySkillRef(skillRef: AgentSkillRef) {
  return Boolean(skillRef.source_path?.trim());
}

function skillRefNameKey(skillRef: AgentSkillRef) {
  return skillRef.name.trim().toLowerCase();
}

function canonicalizeArchivedSkillSourcePath(
  scope: SkillScope,
  sourcePath: string,
) {
  const normalizedPath = sourcePath.trim().replace(/^\/+|\/+$/g, "");
  if (scope === "system" && normalizedPath.startsWith("system/")) {
    const relativePath = normalizedPath.slice("system/".length);
    return relativePath.startsWith("skills/")
      ? normalizedPath
      : `system/skills/${relativePath}`;
  }
  if (scope === "custom" && normalizedPath.startsWith("custom/")) {
    const relativePath = normalizedPath.slice("custom/".length);
    return relativePath.startsWith("skills/")
      ? normalizedPath
      : `custom/skills/${relativePath}`;
  }
  return normalizedPath;
}

function removeArchivedVariantsWithSameName(
  skillRefs: AgentSkillRef[],
  nextRef: AgentSkillRef,
) {
  if (!isArchivedLibrarySkillRef(nextRef)) {
    return skillRefs;
  }

  return skillRefs.filter(
    (skillRef) =>
      !(
        isArchivedLibrarySkillRef(skillRef) &&
        skillRefNameKey(skillRef) === skillRefNameKey(nextRef)
      ),
  );
}

export function createSkillRef(skill: Skill): AgentSkillRef {
  return {
    name: skill.name,
    category: normalizeSkillCategory(skill.category, skill.source_path),
    source_path: buildSkillSourcePath(skill),
    materialized_path: buildSkillMaterializedPath(skill),
  };
}

export function serializeSkillRefForRequest(
  skillRef: AgentSkillRef,
): AgentSkillRefInput {
  const name = skillRef.name.trim();
  const sourcePath = skillRef.source_path?.trim();
  if (sourcePath) {
    return {
      name,
      source_path: sourcePath,
    };
  }

  const category = skillRef.category?.trim();
  const materializedPath = skillRef.materialized_path?.trim();
  return {
    name,
    ...(category ? { category } : {}),
    ...(materializedPath ? { materialized_path: materializedPath } : {}),
  };
}

export function buildSkillSourcePath(skill: Skill) {
  const scope = normalizeSkillCategory(skill.category, skill.source_path);
  const sourcePath = skill.source_path?.trim();
  if (sourcePath) {
    return canonicalizeArchivedSkillSourcePath(scope, sourcePath);
  }

  if (scope === "system" || scope === "custom") {
    return `${scope}/skills/${skill.name}`;
  }
  return `${scope}/${skill.name}`;
}

export function buildSkillMaterializedPath(skill: Skill) {
  const relativePath = stripSkillSourceScopePrefix(buildSkillSourcePath(skill));
  if (relativePath) {
    return `skills/${relativePath}`;
  }

  return `skills/${skill.name}`;
}

export function normalizeSkillCategory(
  category: string | null | undefined,
  sourcePath?: string | null,
): SkillScope {
  return (
    normalizeSkillScope(category) ??
    normalizeSkillScopeFromSourcePath(sourcePath) ??
    "store/dev"
  );
}

export function isSkillRefSelected(
  skillRefs: AgentSkillRef[],
  targetRef: AgentSkillRef,
) {
  return skillRefs.some(
    (skillRef) => skillRefKey(skillRef) === skillRefKey(targetRef),
  );
}

export function removeSkillRef(
  skillRefs: AgentSkillRef[],
  targetRef: AgentSkillRef,
) {
  return skillRefs.filter(
    (skillRef) => skillRefKey(skillRef) !== skillRefKey(targetRef),
  );
}

export function toggleSkillRefSelection(
  skillRefs: AgentSkillRef[],
  nextRef: AgentSkillRef,
) {
  if (isSkillRefSelected(skillRefs, nextRef)) {
    return removeSkillRef(skillRefs, nextRef);
  }

  return [
    ...removeArchivedVariantsWithSameName(skillRefs, nextRef),
    nextRef,
  ];
}

function stripSkillSourceScopePrefix(sourcePath: string) {
  for (const prefix of SKILL_SOURCE_SCOPE_PREFIXES) {
    if (sourcePath.startsWith(prefix)) {
      return sourcePath.slice(prefix.length);
    }
  }

  return "";
}
