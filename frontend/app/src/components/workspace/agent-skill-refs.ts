import type { AgentSkillRef, AgentSkillRefInput } from "@/core/agents/types";
import { normalizeSkillScope, type SkillScope } from "@/core/skills/scope";
import type { Skill } from "@/core/skills/type";

const SKILL_SOURCE_SCOPE_PREFIXES = ["store/prod/", "store/dev/"] as const;

export function skillRefKey(skillRef: AgentSkillRef) {
  return (
    skillRef.source_path ??
    skillRef.materialized_path ??
    `${skillRef.category ?? "uncategorized"}:${skillRef.name}`
  );
}

function isArchivedStoreSkillRef(skillRef: AgentSkillRef) {
  return (
    normalizeSkillScope(skillRef.category) != null &&
    Boolean(skillRef.source_path?.trim())
  );
}

function skillRefNameKey(skillRef: AgentSkillRef) {
  return skillRef.name.trim().toLowerCase();
}

function removeArchivedStoreVariantsWithSameName(
  skillRefs: AgentSkillRef[],
  nextRef: AgentSkillRef,
) {
  if (!isArchivedStoreSkillRef(nextRef)) {
    return skillRefs;
  }

  return skillRefs.filter(
    (skillRef) =>
      !(
        isArchivedStoreSkillRef(skillRef) &&
        skillRefNameKey(skillRef) === skillRefNameKey(nextRef)
      ),
  );
}

export function createSkillRef(skill: Skill): AgentSkillRef {
  return {
    name: skill.name,
    category: normalizeSkillCategory(skill.category),
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
  const sourcePath = skill.source_path?.trim();
  if (sourcePath) {
    return sourcePath;
  }

  const scope = normalizeSkillCategory(skill.category);
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
): SkillScope {
  return normalizeSkillScope(category) ?? "store/dev";
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
    ...removeArchivedStoreVariantsWithSameName(skillRefs, nextRef),
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
