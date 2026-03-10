/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8001";

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

function getGatewayBaseURL() {
  return trimTrailingSlash(
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL,
  );
}

/** @type {import("next").NextConfig} */
const config = {
  devIndicators: false,
  async rewrites() {
    const gatewayBaseURL = getGatewayBaseURL();

    return [
      {
        source: "/api/:path*",
        destination: `${gatewayBaseURL}/api/:path*`,
      },
      {
        source: "/open/:path*",
        destination: `${gatewayBaseURL}/open/:path*`,
      },
      {
        source: "/health",
        destination: `${gatewayBaseURL}/health`,
      },
    ];
  },
};

export default config;
