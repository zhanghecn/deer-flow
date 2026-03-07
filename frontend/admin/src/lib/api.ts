const BASE_URL =
  import.meta.env.VITE_GATEWAY_BASE_URL || "http://localhost:8001";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("admin_auth");
    if (!raw) return null;
    return JSON.parse(raw).token ?? null;
  } catch {
    return null;
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers: extraHeaders, ...rest } = options;
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((extraHeaders as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (res.status === 401) {
    localStorage.removeItem("admin_auth");
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function login(
  account: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string; name: string; role: string; avatar_url?: string } }> {
  return api("/api/auth/login", {
    method: "POST",
    body: { account, password },
  });
}
