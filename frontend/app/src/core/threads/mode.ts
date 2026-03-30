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
    // Copied-skill and other domain agents should stay on direct execution by
    // default. Planner/todo behavior must be an explicit UI choice instead of a
    // frontend-wide hidden default on every chat turn.
    is_plan_mode: false,
    // Keep delegated subagent behavior opt-in as well. Domain agents should not
    // silently inherit extra planner/delegation surface on every turn.
    subagent_enabled: false,
    reasoning_effort: getReasoningEffortForMode(resolvedMode),
  };
}
