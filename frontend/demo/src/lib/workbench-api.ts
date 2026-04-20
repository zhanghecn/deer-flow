export type StoredFileRow = {
  path: string;
  size_bytes: number;
  updated_at: string;
  mime_type: string;
};

export type ToolCatalogEntry = {
  name: string;
  summary: string;
  returns: string;
  arguments: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    default?: string | number | null;
  }>;
};

export type WorkbenchHealth = {
  status: string;
  storage_root: string;
  seed_root?: string | null;
  file_count: number;
  mcp_url: string;
  tool_catalog: ToolCatalogEntry[];
};

export type ToolInvocation = {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  executed_at: string;
};

export type FileListResponse = {
  items: StoredFileRow[];
  total: number;
};

export type ToolCatalogResponse = {
  tools: ToolCatalogEntry[];
};

export type FilePreviewResponse = {
  path: string;
  content: string;
  page: number;
  page_size: number;
  total_chars: number;
  has_more: boolean;
};

export type UploadFilesResponse = {
  saved_count: number;
};

export type ResetFilesResponse = {
  removed_files: number;
  remaining_files: number;
};

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function buildWorkbenchURL(baseURL: string, path: string) {
  return new URL(path, `${trimSlash(baseURL)}/`).toString();
}

async function readJSON<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      detail?: string;
      error?: string;
    };
    throw new Error(payload.detail ?? payload.error ?? fallback);
  }
  return response.json() as Promise<T>;
}

export async function fetchWorkbenchHealth(baseURL: string) {
  const response = await fetch(buildWorkbenchURL(baseURL, "./api/health"));
  return readJSON<WorkbenchHealth>(response, "Failed to load workbench health.");
}

export async function fetchWorkbenchFiles(baseURL: string) {
  const response = await fetch(
    buildWorkbenchURL(baseURL, "./api/files?limit=200"),
  );
  return readJSON<FileListResponse>(
    response,
    "Failed to load uploaded files.",
  );
}

export async function fetchWorkbenchToolCatalog(baseURL: string) {
  const response = await fetch(buildWorkbenchURL(baseURL, "./api/tool-catalog"));
  return readJSON<ToolCatalogResponse>(
    response,
    "Failed to load workbench tool catalog.",
  );
}

export async function fetchWorkbenchFilePreview(
  baseURL: string,
  path: string,
  page = 1,
  pageSize = 4000,
) {
  const query = new URLSearchParams({
    path,
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await fetch(
    buildWorkbenchURL(baseURL, `./api/files/content?${query.toString()}`),
  );
  return readJSON<FilePreviewResponse>(response, "Failed to read uploaded file.");
}

export async function uploadWorkbenchFiles(params: {
  baseURL: string;
  files: File[];
  relativePaths: string[];
}) {
  const formData = new FormData();
  for (const file of params.files) {
    formData.append("files", file);
  }
  formData.append("relative_paths", JSON.stringify(params.relativePaths));
  const response = await fetch(buildWorkbenchURL(params.baseURL, "./api/files"), {
    method: "POST",
    body: formData,
  });
  return readJSON<UploadFilesResponse>(
    response,
    "Failed to upload files to the workbench.",
  );
}

export async function deleteWorkbenchFile(baseURL: string, path: string) {
  const query = new URLSearchParams({ path });
  const response = await fetch(
    buildWorkbenchURL(baseURL, `./api/files?${query.toString()}`),
    { method: "DELETE" },
  );
  return readJSON<{ deleted: string }>(
    response,
    "Failed to delete workbench file.",
  );
}

export async function resetWorkbenchFiles(baseURL: string) {
  const response = await fetch(buildWorkbenchURL(baseURL, "./api/files/reset"), {
    method: "POST",
  });
  return readJSON<ResetFilesResponse>(
    response,
    "Failed to reset workbench files.",
  );
}

export async function invokeWorkbenchTool(params: {
  baseURL: string;
  toolName: string;
  arguments: Record<string, unknown>;
}) {
  const response = await fetch(
    buildWorkbenchURL(
      params.baseURL,
      `./api/tools/${encodeURIComponent(params.toolName)}/invoke`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arguments: params.arguments }),
    },
  );
  return readJSON<ToolInvocation>(
    response,
    "Failed to execute workbench tool.",
  );
}
