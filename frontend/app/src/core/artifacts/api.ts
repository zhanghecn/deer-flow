import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

export async function listThreadOutputArtifacts(threadId: string) {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/artifacts/list`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      payload.error ?? `Failed to load artifacts: ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    artifacts?: string[];
  };
  if (!Array.isArray(payload.artifacts)) {
    return [];
  }
  return payload.artifacts.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}
