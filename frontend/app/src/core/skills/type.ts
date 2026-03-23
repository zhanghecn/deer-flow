export interface Skill {
  name: string;
  description: string;
  description_i18n?: Partial<Record<"en-US" | "zh-CN", string>> | null;
  category: string;
  license: string | null;
  source_path?: string | null;
  enabled: boolean;
}
