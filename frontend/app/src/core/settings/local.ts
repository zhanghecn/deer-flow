import type { AgentThreadContext } from "../threads";
import {
  DEFAULT_SUBAGENT_ENABLED,
  normalizeThreadMode,
  type ThreadMode,
  type ThreadReasoningEffort,
} from "../threads/mode";

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  notification: {
    enabled: true,
  },
  context: {
    model_name: undefined,
    mode: undefined,
    reasoning_effort: undefined,
    subagent_enabled: DEFAULT_SUBAGENT_ENABLED,
    agent_status: "dev",
    execution_backend: undefined,
    remote_session_id: undefined,
  },
  layout: {
    sidebar_collapsed: false,
  },
};

const LOCAL_SETTINGS_KEY = "openagents.local-settings";

export interface LocalSettings {
  notification: {
    enabled: boolean;
  };
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
  > & {
    mode: ThreadMode | undefined;
    reasoning_effort?: ThreadReasoningEffort;
    subagent_enabled?: boolean;
  };
  layout: {
    sidebar_collapsed: boolean;
  };
}

export function getLocalSettings(): LocalSettings {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_SETTINGS;
  }
  const json = localStorage.getItem(LOCAL_SETTINGS_KEY);
  try {
    if (json) {
      const settings = JSON.parse(json);
      const mergedSettings = {
        ...DEFAULT_LOCAL_SETTINGS,
        context: {
          ...DEFAULT_LOCAL_SETTINGS.context,
          ...settings.context,
          mode: normalizeThreadMode(settings.context?.mode),
        },
        layout: {
          ...DEFAULT_LOCAL_SETTINGS.layout,
          ...settings.layout,
        },
        notification: {
          ...DEFAULT_LOCAL_SETTINGS.notification,
          ...settings.notification,
        },
      };
      return mergedSettings;
    }
  } catch {}
  return DEFAULT_LOCAL_SETTINGS;
}

export function saveLocalSettings(settings: LocalSettings) {
  localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
}
