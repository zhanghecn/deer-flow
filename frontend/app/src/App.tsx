import { BrowserRouter } from "react-router-dom";

import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_LOCALE } from "@/core/i18n";
import { I18nProvider } from "@/core/i18n/context";
import { getLocaleFromCookie } from "@/core/i18n/cookies";

import { AppRoutes } from "./routes";

export function App() {
  const locale = getLocaleFromCookie() ?? DEFAULT_LOCALE;

  return (
    <BrowserRouter>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <I18nProvider initialLocale={locale}>
          <AppRoutes />
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
