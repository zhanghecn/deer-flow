import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "@/core/config";

type APIErrorShape = {
  detail?: string;
  details?: string;
  error?: string;
};

export type DesignBoardSession = {
  access_token: string;
  thread_id: string;
  session_id: string;
  session_generation: number;
  target_path: string;
  revision: string;
  relative_url: string;
  expires_at: string;
};

export type DesignBoardDocumentPayload = {
  target_path: string;
  revision: string;
  document: unknown;
};

export class DesignBoardDocumentReadError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "DesignBoardDocumentReadError";
    this.statusCode = statusCode;
  }
}

function resolveAPIErrorMessage(
  payload: APIErrorShape,
  fallback: string,
): string {
  return payload.details ?? payload.detail ?? payload.error ?? fallback;
}

export async function openDesignBoard(
  threadId: string,
  options?: {
    targetPath?: string;
  },
): Promise<DesignBoardSession> {
  const url = new URL(
    `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/design-board/open`,
  );
  if (options?.targetPath?.trim()) {
    // Opening a concrete `.op` artifact must stay explicit at the API layer so
    // the gateway never has to infer which design file the user meant.
    url.searchParams.set("target_path", options.targetPath.trim());
  }

  const response = await authFetch(url.toString(), {
    method: "POST",
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new Error(
      resolveAPIErrorMessage(
        err,
        `Failed to open design board: ${response.statusText}`,
      ),
    );
  }
  return response.json() as Promise<DesignBoardSession>;
}

export async function readDesignBoardDocument(
  session: Pick<DesignBoardSession, "access_token">,
): Promise<DesignBoardDocumentPayload> {
  const response = await fetch(`${getBackendBaseURL()}/api/design/document`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as APIErrorShape;
    throw new DesignBoardDocumentReadError(
      resolveAPIErrorMessage(
        err,
        `Failed to load design document: ${response.statusText}`,
      ),
      response.status,
    );
  }
  return response.json() as Promise<DesignBoardDocumentPayload>;
}
