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
  return getBrowserBaseURL() ?? getGatewayBaseURL();
}

export function getLangGraphBaseURL(isMock?: boolean) {
  const browserBaseURL = getBrowserBaseURL();

  if (isMock) {
    if (browserBaseURL) {
      return `${browserBaseURL}/mock/api`;
    }

    return `${DEFAULT_APP_BASE_URL}/mock/api`;
  }

  return `${browserBaseURL ?? getGatewayBaseURL()}/api/langgraph`;
}
