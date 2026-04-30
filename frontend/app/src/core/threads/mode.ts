export type ThreadMode = "flash" | "pro";
export type LegacyThreadMode = ThreadMode | "thinking" | "ultra";
export type ThreadEffort = "low" | "medium" | "high" | "max";

export const DEFAULT_SUBAGENT_ENABLED = true;

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

export function getEffortForMode(mode: ThreadMode): ThreadEffort | undefined {
  void mode;
  // Model-level reasoning defaults now live in the admin catalog. Workspace
  // mode should only toggle thinking on/off unless the user explicitly picks a
  // stronger per-run override elsewhere.
  return undefined;
}

export function resolveSubmitFlags(
  mode: string | null | undefined,
  options?: {
    planMode?: boolean;
  },
) {
  const resolvedMode = getResolvedThreadMode(mode);
  const planMode = options?.planMode ?? false;

  return {
    mode: resolvedMode,
    thinking_enabled: resolvedMode !== "flash",
    // Copied-skill and other domain agents should stay on direct execution by
    // default. Planner/todo behavior must be an explicit UI choice instead of a
    // frontend-wide hidden default on every chat turn.
    is_plan_mode: planMode,
    // Workspace chats no longer expose a per-turn task toggle. The agent's
    // runtime middleware deny-list owns whether the `task` tool is available.
    subagent_enabled: DEFAULT_SUBAGENT_ENABLED,
    effort: getEffortForMode(resolvedMode),
  };
}
