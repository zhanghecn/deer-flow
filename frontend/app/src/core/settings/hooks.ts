import { useCallback, useLayoutEffect, useState } from "react";

import {
  DEFAULT_LOCAL_SETTINGS,
  getLocalSettings,
  saveLocalSettings,
  type LocalSettings,
} from "./local";

export type LocalSettingsSetter = <K extends keyof LocalSettings>(
  key: K,
  value: Partial<LocalSettings[K]>,
) => void;

function settingPatchKeepsCurrentValues<K extends keyof LocalSettings>(
  section: LocalSettings[K],
  value: Partial<LocalSettings[K]>,
) {
  for (const settingKey of Object.keys(value) as Array<keyof LocalSettings[K]>) {
    if (!Object.is(section[settingKey], value[settingKey])) {
      return false;
    }
  }
  return true;
}

export function useLocalSettings(): [
  LocalSettings,
  LocalSettingsSetter,
] {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<LocalSettings>(DEFAULT_LOCAL_SETTINGS);
  useLayoutEffect(() => {
    if (!mounted) {
      setState(getLocalSettings());
    }
    setMounted(true);
  }, [mounted]);
  const setter = useCallback<LocalSettingsSetter>(
    (key, value) => {
      if (!mounted) return;
      setState((prev) => {
        // Chat routes normalize context from effects; no-op patches must keep
        // the same object identity or those effects can feed each other.
        if (settingPatchKeepsCurrentValues(prev[key], value)) {
          return prev;
        }

        const newState = {
          ...prev,
          [key]: {
            ...prev[key],
            ...value,
          },
        } satisfies LocalSettings;
        saveLocalSettings(newState);
        return newState;
      });
    },
    [mounted],
  );
  return [state, setter];
}
