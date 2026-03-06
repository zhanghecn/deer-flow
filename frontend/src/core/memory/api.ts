import { authFetch } from "@/core/auth/fetch";
import { getBackendBaseURL } from "../config";

import type { UserMemory } from "./types";

export async function loadMemory() {
  const memory = await authFetch(`${getBackendBaseURL()}/api/memory`);
  const json = await memory.json();
  return json as UserMemory;
}
