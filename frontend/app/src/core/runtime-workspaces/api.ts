import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

export type RuntimeWorkspaceSession = {
  session_id: string;
  access_token: string;
  mode: "runtime" | "authoring";
  target_path: string;
  relative_url: string;
  public_base_path: string;
  expires_at: string;
};

export async function openRuntimeWorkspace(
  threadId: string,
): Promise<RuntimeWorkspaceSession> {
  const res = await authFetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/runtime-workspace/open`,
    {
      method: "POST",
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      err.error ?? `Failed to open runtime workspace: ${res.statusText}`,
    );
  }
  return (await res.json()) as RuntimeWorkspaceSession;
}
