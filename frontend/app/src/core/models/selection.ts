import type { Model } from "./types";

type ModelLike = Pick<Model, "name">;

export function normalizeModelName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function findAvailableModelName(
  models: ModelLike[],
  ...candidates: unknown[]
): string | undefined {
  for (const candidate of candidates) {
    const normalizedName = normalizeModelName(candidate);
    if (!normalizedName) {
      continue;
    }
    if (models.some((model) => model.name === normalizedName)) {
      return normalizedName;
    }
  }

  return undefined;
}
