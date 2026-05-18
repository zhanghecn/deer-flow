import { Component, type ReactNode } from "react";

const CHUNK_RELOAD_STORAGE_PREFIX = "openagents:chunk-reload:";

const CHUNK_LOAD_ERROR_PATTERNS = [
  "ChunkLoadError",
  "Loading chunk",
  "CSS_CHUNK_LOAD_FAILED",
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

type ChunkLoadRecoveryOptions = {
  href: string;
  reload: () => void;
  storage?: BrowserStorage | null;
};

type ChunkLoadRecoveryState = {
  error: unknown;
};

function chunkReloadStorageKey(href: string) {
  return `${CHUNK_RELOAD_STORAGE_PREFIX}${href}`;
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
  { href, reload, storage }: ChunkLoadRecoveryOptions,
) {
  if (!isChunkLoadError(error)) {
    return false;
  }

  const storageKey = chunkReloadStorageKey(href);
  if (storage?.getItem(storageKey) === "1") {
    return false;
  }

  // A stale open tab can still point at removed Vite chunk hashes after a
  // deploy. Reload once for this URL so the browser gets the fresh index.html;
  // keep the session flag to prevent a reload loop if the asset is truly bad.
  storage?.setItem(storageKey, "1");
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
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
