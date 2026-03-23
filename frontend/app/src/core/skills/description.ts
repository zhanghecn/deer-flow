import type { Locale } from "@/core/i18n";

import type { Skill } from "./type";

export function getLocalizedSkillDescription(
  skill: Pick<Skill, "description" | "description_i18n">,
  locale: Locale,
) {
  const localized = skill.description_i18n?.[locale]?.trim();
  if (localized) {
    return localized;
  }
  return skill.description;
}
