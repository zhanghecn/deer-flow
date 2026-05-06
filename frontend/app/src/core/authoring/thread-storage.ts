import { uuid } from "@/core/utils/uuid";

const AUTHORING_THREAD_STORAGE_PREFIX = "openagents:authoring-thread:";

type AuthoringThreadTarget = {
  kind: "agent" | "skill";
  name: string;
  agentStatus?: "dev" | "prod";
  sourcePath?: string | null;
};

export function buildAuthoringThreadStorageKey(target: AuthoringThreadTarget) {
  return [
    target.kind,
    target.name,
    target.agentStatus ?? "",
    target.sourcePath ?? "",
  ].join(":");
}

function storageKeyForTarget(target: AuthoringThreadTarget) {
  // Sticky threads are scoped by the explicit authoring target so settings
  // saves can restage the same visible workspace without crossing dev/prod or
  // same-named skill source variants.
  return `${AUTHORING_THREAD_STORAGE_PREFIX}${buildAuthoringThreadStorageKey(target)}`;
}

export function readStoredAuthoringThreadId(target: AuthoringThreadTarget) {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(storageKeyForTarget(target));
}

export function getOrCreateAuthoringThreadId(target: AuthoringThreadTarget) {
  if (typeof window === "undefined") {
    return uuid();
  }

  const storageKey = storageKeyForTarget(target);
  const existing = readStoredAuthoringThreadId(target);
  if (existing) {
    return existing;
  }

  const nextThreadId = uuid();
  window.sessionStorage.setItem(storageKey, nextThreadId);
  return nextThreadId;
}
