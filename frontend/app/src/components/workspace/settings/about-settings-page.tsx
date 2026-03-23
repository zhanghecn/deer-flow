import { Streamdown } from "streamdown";

import { useI18n } from "@/core/i18n/hooks";

import { getAboutMarkdown } from "./about-content";

export function AboutSettingsPage() {
  const { locale } = useI18n();
  return <Streamdown>{getAboutMarkdown(locale)}</Streamdown>;
}
