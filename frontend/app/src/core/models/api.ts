import { authFetch } from "@/core/auth/fetch";

import { getBackendBaseURL } from "../config";

import type { Model } from "./types";

export async function loadModels() {
  const res = await authFetch(`${getBackendBaseURL()}/api/models`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Failed to load models: ${res.statusText}`);
  }
  const { models } = (await res.json()) as { models?: Model[] };
  return models ?? [];
}
