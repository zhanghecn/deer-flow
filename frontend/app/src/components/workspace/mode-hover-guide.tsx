import { useI18n } from "@/core/i18n/hooks";
import type { Translations } from "@/core/i18n/locales/types";
import type { ThreadMode } from "@/core/threads/mode";

import { Tooltip } from "./tooltip";

export type AgentMode = ThreadMode;

function getModeLabelKey(
  mode: AgentMode,
): keyof Pick<
  Translations["inputBox"],
  "flashMode" | "proMode"
> {
  switch (mode) {
    case "flash":
      return "flashMode";
    case "pro":
      return "proMode";
  }
}

function getModeDescriptionKey(
  mode: AgentMode,
): keyof Pick<
  Translations["inputBox"],
  "flashModeDescription" | "proModeDescription"
> {
  switch (mode) {
    case "flash":
      return "flashModeDescription";
    case "pro":
      return "proModeDescription";
  }
}

export function ModeHoverGuide({
  mode,
  children,
  showTitle = true,
}: {
  mode: AgentMode;
  children: React.ReactNode;
  /** When true, tooltip shows "ModeName: Description". When false, only description. */
  showTitle?: boolean;
}) {
  const { t } = useI18n();
  const label = t.inputBox[getModeLabelKey(mode)];
  const description = t.inputBox[getModeDescriptionKey(mode)];
  const content = showTitle ? `${label}: ${description}` : description;

  return <Tooltip content={content}>{children}</Tooltip>;
}
