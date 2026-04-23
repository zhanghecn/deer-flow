// Demo pages can run inside older browsers or embedded webviews where the
// Web Crypto object exists but randomUUID is still missing. These IDs are
// only used for local UI bookkeeping, so a lightweight fallback is enough.
function createFallbackDemoId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDemoId(prefix = "demo"): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return createFallbackDemoId(prefix);
}
