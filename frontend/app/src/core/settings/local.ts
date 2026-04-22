import type { AgentThreadContext } from "../threads";
import {
  DEFAULT_SUBAGENT_ENABLED,
  getEffortForMode,
  normalizeThreadMode,
  type ThreadMode,
  type ThreadEffort,
} from "../threads/mode";
import type { WorkspaceSurface } from "../workspace-surface/types";

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  notification: {
    enabled: true,
  },
  context: {
    model_name: undefined,
    mode: undefined,
    effort: undefined,
    subagent_enabled: DEFAULT_SUBAGENT_ENABLED,
    agent_status: "dev",
    execution_backend: undefined,
    remote_session_id: undefined,
  },
  layout: {
    sidebar_collapsed: false,
    workspace_dock_open: false,
    workspace_dock_active_surface: "preview",
    workspace_dock_width_ratio: 38,
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
    effort?: ThreadEffort;
    subagent_enabled?: boolean;
  };
  layout: {
    sidebar_collapsed: boolean;
    workspace_dock_open?: boolean;
    workspace_dock_active_surface?: WorkspaceSurface;
    workspace_dock_width_ratio?: number;
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
      const normalizedMode = normalizeThreadMode(settings.context?.mode);
      const mergedSettings = {
        ...DEFAULT_LOCAL_SETTINGS,
        context: {
          ...DEFAULT_LOCAL_SETTINGS.context,
          ...settings.context,
          mode: normalizedMode,
          effort:
            settings.context?.effort ??
            (normalizedMode ? getEffortForMode(normalizedMode) : undefined),
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
