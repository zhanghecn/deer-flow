import type { useI18n } from "@/core/i18n/hooks";

export type KnowledgeI18n = ReturnType<typeof useI18n>["t"];

export function statusTone(
  status: string,
): "default" | "secondary" | "destructive" {
  switch (status) {
    case "ready":
      return "default";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

export function statusLabel(status: string, t: KnowledgeI18n) {
  switch (status) {
    case "queued":
      return t.knowledge.status.queued;
    case "ready":
      return t.knowledge.status.ready;
    case "processing":
      return t.knowledge.status.processing;
    case "error":
      return t.knowledge.status.error;
    default:
      return status;
  }
}

export function visibilityLabel(visibility: string, t: KnowledgeI18n) {
  switch (visibility) {
    case "shared":
      return t.knowledge.visibilityShared;
    case "private":
      return t.knowledge.visibilityPrivate;
    default:
      return visibility;
  }
}

export function formatKnowledgeTimestamp(value: string | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}
