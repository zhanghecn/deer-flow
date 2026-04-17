import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

import type {
  CreateSkillRequest,
  EditableSkill,
  Skill,
  UpdateSkillRequest,
} from "./type";

type APIErrorShape = {
  detail?: string;
  details?: string;
  error?: string;
};

function resolveAPIErrorMessage(
  payload: APIErrorShape,
  fallback: string,
): string {
  return payload.details ?? payload.detail ?? payload.error ?? fallback;
}

export async function loadSkills(): Promise<Skill[]> {
  const skills = await authFetch(`${getBackendBaseURL()}/api/skills`);
  if (!skills.ok) {
    const err = (await skills.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to load skills: ${skills.statusText}`,
      ),
    );
  }
  const json = (await skills.json()) as { skills: Skill[] };
  return json.skills;
}

export async function getSkill(
  skillName: string,
  sourcePath?: string,
): Promise<EditableSkill> {
  const query = sourcePath
    ? `?source_path=${encodeURIComponent(sourcePath)}`
    : "";
  const response = await authFetch(
    `${getBackendBaseURL()}/api/skills/${skillName}${query}`,
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to load skill '${skillName}': ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<EditableSkill>;
}

export async function createSkill(
  request: CreateSkillRequest,
): Promise<EditableSkill> {
  const response = await authFetch(`${getBackendBaseURL()}/api/skills`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to create skill: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<EditableSkill>;
}

export async function enableSkill(skillName: string, enabled: boolean) {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/skills/${skillName}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled,
      }),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to update skill state: ${response.statusText}`,
      ),
    );
  }
  return response.json();
}

export async function updateSkill(
  skillName: string,
  request: UpdateSkillRequest,
): Promise<EditableSkill> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/skills/${skillName}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to update skill: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<EditableSkill>;
}

export async function deleteSkill(skillName: string): Promise<void> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/skills/${skillName}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to delete skill: ${response.statusText}`,
      ),
    );
  }
}

function extractFilenameFromDisposition(headerValue: string | null) {
  if (!headerValue) {
    return null;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const plainMatch = /filename=\"?([^\";]+)\"?/i.exec(headerValue);
  return plainMatch?.[1] ?? null;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1_000);
}

export async function downloadSkill(params: {
  skillName: string;
  sourcePath?: string | null;
}): Promise<string> {
  const query = params.sourcePath?.trim()
    ? `?source_path=${encodeURIComponent(params.sourcePath.trim())}`
    : "";
  const response = await authFetch(
    `${getBackendBaseURL()}/api/skills/${encodeURIComponent(params.skillName)}/download${query}`,
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to download skill: ${response.statusText}`,
      ),
    );
  }

  const blob = await response.blob();
  const filename =
    extractFilenameFromDisposition(
      response.headers.get("Content-Disposition"),
    ) ?? `${params.skillName}.skill`;
  triggerBrowserDownload(blob, filename);
  return filename;
}

export interface InstallSkillRequest {
  thread_id: string;
  path: string;
}

export interface InstallSkillResponse {
  success: boolean;
  skill_name: string;
  message: string;
}

export async function installSkill(
  request: InstallSkillRequest,
): Promise<InstallSkillResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/skills/install`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    // Handle HTTP error responses (4xx, 5xx)
    const errorData = await response.json().catch(() => ({}));
    const errorMessage =
      errorData.detail ?? `HTTP ${response.status}: ${response.statusText}`;
    return {
      success: false,
      skill_name: "",
      message: errorMessage,
    };
  }

  return response.json();
}
