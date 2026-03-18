const SKILL_REFERENCE_TOKEN = /(?:^|\s)\$([A-Za-z0-9_-]+)/g;

export function extractSkillReferences(input: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  const trimmed = input.trim();
  if (!trimmed) {
    return references;
  }

  for (const match of trimmed.matchAll(SKILL_REFERENCE_TOKEN)) {
    const skillName = match[1]?.trim();
    if (!skillName || seen.has(skillName)) {
      continue;
    }
    seen.add(skillName);
    references.push(skillName);
  }

  return references;
}

export function getSkillReferenceQuery(input: string): string | null {
  const pattern = /(?:^|\s)\$([A-Za-z0-9_-]*)$/;
  const match = pattern.exec(input);
  if (!match) {
    return null;
  }
  return match[1] ?? "";
}
