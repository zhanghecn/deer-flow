export type ThreadMode = "flash" | "pro";
export type LegacyThreadMode = ThreadMode | "thinking" | "ultra";
export type ThreadReasoningEffort = "minimal" | "high";

export function normalizeThreadMode(
  mode: string | null | undefined,
): ThreadMode | undefined {
  if (mode === "flash" || mode === "pro") {
    return mode;
  }
  if (mode === "thinking" || mode === "ultra") {
    return "pro";
  }
  return undefined;
}

export function getDefaultThreadMode(): ThreadMode {
  return "pro";
}

export function getResolvedThreadMode(
  mode: string | null | undefined,
): ThreadMode {
  return normalizeThreadMode(mode) ?? getDefaultThreadMode();
}

export function getReasoningEffortForMode(
  mode: ThreadMode,
): ThreadReasoningEffort {
  return mode === "flash" ? "minimal" : "high";
}

export function resolveSubmitFlags(mode: string | null | undefined) {
  const resolvedMode = getResolvedThreadMode(mode);

  return {
    mode: resolvedMode,
    thinking_enabled: resolvedMode !== "flash",
    is_plan_mode: true,
    subagent_enabled: true,
    reasoning_effort: getReasoningEffortForMode(resolvedMode),
  };
}
