import { getLocalizedSkillDescription } from "@/core/skills";
import type { Skill } from "@/core/skills/type";

export const SKILLS_PAGE_SIZE = 8;

export function filterSkillsByQuery(
  skills: Skill[],
  query: string,
  locale: "en-US" | "zh-CN",
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return skills;
  }

  return skills.filter((skill) =>
    [
      skill.name,
      skill.source_path ?? "",
      skill.category ?? "",
      getLocalizedSkillDescription(skill, locale),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number = SKILLS_PAGE_SIZE,
) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    currentPage,
    totalPages,
    pageItems: items.slice(startIndex, endIndex),
    startIndex,
    endIndex: Math.min(endIndex, items.length),
  };
}
