export interface Skill {
  name: string;
  description: string;
  description_i18n?: Partial<Record<"en-US" | "zh-CN", string>> | null;
  category: string;
  license: string | null;
  source_path?: string | null;
  enabled: boolean;
}

export interface EditableSkill {
  name: string;
  description: string;
  description_i18n?: Partial<Record<"en-US" | "zh-CN", string>> | null;
  category?: string;
  source_path?: string | null;
  can_edit?: boolean;
  status?: string | null;
  skill_md: string;
}

export interface CreateSkillRequest {
  name: string;
  description?: string;
  description_i18n?: Partial<Record<"en-US" | "zh-CN", string>> | null;
  skill_md: string;
}

export interface UpdateSkillRequest {
  description?: string;
  description_i18n?: Partial<Record<"en-US" | "zh-CN", string>> | null;
  skill_md?: string;
}
