export interface AuthoringFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface AuthoringDraft {
  root_path: string;
  files: AuthoringFileEntry[];
}

export interface AuthoringFilePayload {
  path: string;
  content: string;
}
