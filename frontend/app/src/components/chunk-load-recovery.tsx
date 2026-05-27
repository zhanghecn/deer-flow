import { Component, type ReactNode } from "react";

const CHUNK_RELOAD_STORAGE_PREFIX = "openagents:chunk-reload:";
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;

const CHUNK_LOAD_ERROR_PATTERNS = [
  "ChunkLoadError",
  "Loading chunk",
  "CSS_CHUNK_LOAD_FAILED",
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ChunkLoadRecoveryOptions = {
  href: string;
  reload: () => void;
  storage?: BrowserStorage | null;
  now?: () => number;
};

type ChunkLoadRecoveryState = {
  error: unknown;
};

function chunkReloadStorageKey(href: string) {
  return `${CHUNK_RELOAD_STORAGE_PREFIX}${href}`;
}

function readReloadAttempt(value: string | null) {
  const attemptedAt = Number(value);
  return Number.isFinite(attemptedAt) ? attemptedAt : 0;
}

function clearChunkReloadAttempt(
  href: string,
  storage?: BrowserStorage | null,
) {
  storage?.removeItem(chunkReloadStorageKey(href));
}

function errorToSearchableText(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}\n${error.message}\n${error.stack ?? ""}`;
  }

  return String(error);
}

export function isChunkLoadError(error: unknown) {
  const text = errorToSearchableText(error);
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

export function recoverChunkLoadError(
  error: unknown,
  { href, reload, storage, now = Date.now }: ChunkLoadRecoveryOptions,
) {
  if (!isChunkLoadError(error)) {
    return false;
  }

  const storageKey = chunkReloadStorageKey(href);
  const currentTime = now();
  const attemptedAt = readReloadAttempt(storage?.getItem(storageKey) ?? null);
  if (attemptedAt > 0 && currentTime - attemptedAt < CHUNK_RELOAD_COOLDOWN_MS) {
    return false;
  }

  // A stale open tab can still point at removed Vite chunk hashes after a
  // deploy. Keep only a short cooldown marker: it prevents tight reload loops
  // for a genuinely missing asset without permanently breaking this same chat
  // URL across later local rebuilds.
  storage?.setItem(storageKey, String(currentTime));
  reload();
  return true;
}

export class ChunkLoadRecoveryBoundary extends Component<
  { children: ReactNode },
  ChunkLoadRecoveryState
> {
  state: ChunkLoadRecoveryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): ChunkLoadRecoveryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (typeof window === "undefined") {
      return;
    }

    const recovered = recoverChunkLoadError(error, {
      href: window.location.href,
      reload: () => window.location.reload(),
      storage: window.sessionStorage,
    });

    if (recovered) {
      return;
    }
  }

  private handleManualReload = () => {
    if (typeof window === "undefined") {
      return;
    }

    clearChunkReloadAttempt(window.location.href, window.sessionStorage);
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="bg-background flex min-h-screen items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <p className="text-foreground text-sm font-medium">
              页面资源加载失败
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              当前页面引用的前端资源不可用，请刷新后重试。
            </p>
            <button
              type="button"
              onClick={this.handleManualReload}
              className="border-border bg-background hover:bg-muted text-foreground mt-4 inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
