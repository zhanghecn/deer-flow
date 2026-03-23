import { env } from "@/env";

const DEFAULT_APP_BASE_URL = "http://localhost:3000";
const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8001";

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function getBrowserBaseURL() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.location.origin;
}

function shouldUseDevProxy() {
  return typeof window !== "undefined" && import.meta.env.DEV;
}

function getGatewayBaseURL() {
  return trimTrailingSlash(
    env.VITE_BACKEND_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL,
  );
}

export function getBackendBaseURL() {
  const browserBaseURL = getBrowserBaseURL();

  // In Vite dev we intentionally prefer the app origin so `/api` goes through
  // the dev server proxy. This avoids host-mismatch issues like
  // `localhost` vs `127.0.0.1` and keeps auth/CORS behavior aligned with the
  // workspace app.
  if (shouldUseDevProxy() && browserBaseURL) {
    return browserBaseURL;
  }

  // Outside Vite dev, honor an explicit gateway base URL in the browser.
  if (env.VITE_BACKEND_BASE_URL) {
    return getGatewayBaseURL();
  }

  return browserBaseURL ?? getGatewayBaseURL();
}

export function getLangGraphBaseURL(isMock?: boolean) {
  if (isMock) {
    const browserBaseURL = getBrowserBaseURL();
    if (browserBaseURL) {
      return `${browserBaseURL}/mock/api`;
    }

    return `${DEFAULT_APP_BASE_URL}/mock/api`;
  }

  return `${getBackendBaseURL()}/api/langgraph`;
}
