const KEY_PREFIX = "openagents:stale-asset-reload:";
const COOLDOWN_MS = 10000;

function shouldReload() {
  try {
    const key = `${KEY_PREFIX}${window.location.origin}${window.location.pathname}`;
    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(key) || "0");
    if (Number.isFinite(previous) && now - previous < COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(key, String(now));
    return true;
  } catch {
    return true;
  }
}

// This module is served only for deleted Vite hashed assets after a deploy.
// Reloading with a cache-busting URL forces the browser to fetch the current
// no-store index.html while avoiding a tight loop if a deployment is broken.
if (typeof window !== "undefined" && shouldReload()) {
  const url = new URL(window.location.href);
  url.searchParams.set("_oa_reload", String(Date.now()));
  window.location.replace(url.toString());
}

export default function StaleAssetReloadPlaceholder() {
  return null;
}
