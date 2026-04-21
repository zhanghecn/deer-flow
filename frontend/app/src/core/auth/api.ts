import { getBackendBaseURL } from "@/core/config";

import { clearAuth, markAuthHydrated, type AuthUser, setAuth } from "./store";

interface AuthResponse {
  token: string;
  user: AuthUser;
}

export async function login(
  account: string,
  password: string,
): Promise<AuthResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Login failed: ${res.statusText}`);
  }
  const data = (await res.json()) as AuthResponse;
  setAuth(data.token, data.user);
  return data;
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<AuthResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/auth/register`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Registration failed: ${res.statusText}`);
  }
  const data = (await res.json()) as AuthResponse;
  setAuth(data.token, data.user);
  return data;
}

// StrictMode remounts and parallel route guards may all try to restore the same
// browser session at once, so collapse them into one in-flight request.
let restoreAuthSessionPromise: Promise<void> | null = null;

export async function restoreAuthSession(): Promise<void> {
  if (restoreAuthSessionPromise) {
    return restoreAuthSessionPromise;
  }

  restoreAuthSessionPromise = (async () => {
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/auth/session`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        clearAuth();
        return;
      }

      const data = (await res.json()) as AuthResponse;
      setAuth(data.token, data.user);
    } catch {
      clearAuth();
    } finally {
      markAuthHydrated();
      restoreAuthSessionPromise = null;
    }
  })();

  return restoreAuthSessionPromise;
}
