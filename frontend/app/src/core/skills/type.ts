export interface Skill {
  name: string;
  description: string;
  category: string;
  license: string | null;
  source_path?: string | null;
  enabled: boolean;
}
