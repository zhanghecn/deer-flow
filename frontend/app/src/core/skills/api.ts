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
