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

function getGatewayBaseURL() {
  return trimTrailingSlash(
    env.NEXT_PUBLIC_BACKEND_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL,
  );
}

export function getBackendBaseURL() {
  // Honor an explicit gateway base URL in the browser. This keeps host-run
  // `pnpm dev` on :3000 from depending on Next dev rewrites for API traffic.
  if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    return getGatewayBaseURL();
  }

  return getBrowserBaseURL() ?? getGatewayBaseURL();
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
