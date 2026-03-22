/**
 * Cookie utilities for locale management (client-side only)
 */

import { type Locale, normalizeLocale } from "@/core/i18n";

const LOCALE_COOKIE_NAME = "locale";

/**
 * Get locale from cookie (client-side)
 */
export function getLocaleFromCookie(): Locale | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === LOCALE_COOKIE_NAME) {
      return normalizeLocale(decodeURIComponent(value ?? ""));
    }
  }
  return null;
}

/**
 * Set locale in cookie (client-side)
 */
export function setLocaleInCookie(locale: Locale): void {
  if (typeof document === "undefined") {
    return;
  }

  // Set cookie with 1 year expiration
  const maxAge = 365 * 24 * 60 * 60; // 1 year in seconds
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}
