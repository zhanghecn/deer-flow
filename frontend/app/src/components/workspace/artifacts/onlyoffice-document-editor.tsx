"use client";

import { useEffect, useMemo } from "react";

type OnlyOfficeConfig = Record<string, unknown>;

interface OnlyOfficeEditorInstance {
  destroyEditor?: () => void;
}

interface OnlyOfficeDocsAPI {
  DocEditor: new (id: string, config: OnlyOfficeConfig) => OnlyOfficeEditorInstance;
}

interface OnlyOfficeRegistry {
  instances?: Record<string, OnlyOfficeEditorInstance | undefined>;
}

interface OnlyOfficeEditorEvent {
  data?: {
    errorCode?: number;
    errorDescription?: string;
  };
}

declare global {
  interface Window {
    DocsAPI?: OnlyOfficeDocsAPI;
    DocEditor?: OnlyOfficeRegistry;
  }
}

const onlyOfficeScriptCache = new Map<string, Promise<void>>();

function normalizeDocumentServerUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function buildOnlyOfficeScriptUrl(
  documentServerUrl: string,
  config: OnlyOfficeConfig,
) {
  const baseUrl = normalizeDocumentServerUrl(documentServerUrl);
  const params = new URLSearchParams();
  const shardKey = extractShardKey(config);

  if (shardKey) {
    params.set("shardkey", shardKey);
  }

  const query = params.toString();
  return `${baseUrl}/web-apps/apps/api/documents/api.js${query ? `?${query}` : ""}`;
}

function extractShardKey(config: OnlyOfficeConfig) {
  const documentConfig = config.document;
  if (!documentConfig || typeof documentConfig !== "object") {
    return null;
  }

  const key = (documentConfig as Record<string, unknown>).key;
  if (typeof key !== "string") {
    return null;
  }

  const trimmed = key.trim();
  return trimmed || null;
}

function emitLoadError(
  callback: ((code: number, description: string) => void) | undefined,
  code: number,
  description: string,
) {
  if (callback) {
    callback(code, description);
    return;
  }

  console.error(description);
}

function getOnlyOfficeRegistry() {
  const registry = (window.DocEditor ??= {});
  registry.instances ??= {};
  return registry.instances;
}

function destroyOnlyOfficeInstance(editorId: string) {
  const instances = window.DocEditor?.instances;
  const existing = instances?.[editorId];

  if (!existing) {
    return;
  }

  try {
    existing.destroyEditor?.();
  } catch (error) {
    console.error("Failed to destroy ONLYOFFICE editor:", error);
  }

  delete instances?.[editorId];
}

function ensureOnlyOfficeScript(scriptUrl: string) {
  if (typeof window !== "undefined" && window.DocsAPI?.DocEditor) {
    return Promise.resolve();
  }

  const cached = onlyOfficeScriptCache.get(scriptUrl);
  if (cached) {
    return cached;
  }

  const promise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[data-onlyoffice-script="${scriptUrl}"]`,
    );

    const handleSuccess = () => {
      if (window.DocsAPI?.DocEditor) {
        resolve();
        return;
      }
      reject(new Error("DocsAPI is not defined"));
    };

    const handleError = () => {
      reject(new Error(`Error load DocsAPI from ${scriptUrl}`));
    };

    if (existingScript) {
      existingScript.addEventListener("load", handleSuccess, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.onlyofficeScript = scriptUrl;
    script.addEventListener("load", handleSuccess, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.body.appendChild(script);
  }).catch((error) => {
    onlyOfficeScriptCache.delete(scriptUrl);
    throw error;
  });

  onlyOfficeScriptCache.set(scriptUrl, promise);
  return promise;
}

export function OnlyOfficeDocumentEditor({
  id,
  documentServerUrl,
  config,
  onLoadComponentError,
  onEditorError,
}: {
  id: string;
  documentServerUrl: string;
  config: OnlyOfficeConfig;
  onLoadComponentError?: (code: number, description: string) => void;
  onEditorError?: (code: number, description: string) => void;
}) {
  const normalizedDocumentServerUrl = useMemo(
    () => normalizeDocumentServerUrl(documentServerUrl),
    [documentServerUrl],
  );
  const configSignature = useMemo(() => JSON.stringify(config), [config]);
  const scriptUrl = useMemo(
    () =>
      buildOnlyOfficeScriptUrl(
        normalizedDocumentServerUrl,
        JSON.parse(configSignature) as OnlyOfficeConfig,
      ),
    [configSignature, normalizedDocumentServerUrl],
  );

  useEffect(() => {
    let disposed = false;

    const mountEditor = async () => {
      try {
        await ensureOnlyOfficeScript(scriptUrl);
      } catch (error) {
        if (!disposed) {
          emitLoadError(
            onLoadComponentError,
            -2,
            error instanceof Error
              ? error.message
              : `Error load DocsAPI from ${normalizedDocumentServerUrl}`,
          );
        }
        return;
      }

      if (disposed) {
        return;
      }

      if (!window.DocsAPI?.DocEditor) {
        emitLoadError(onLoadComponentError, -3, "DocsAPI is not defined");
        return;
      }

      try {
        destroyOnlyOfficeInstance(id);
        const instances = getOnlyOfficeRegistry();
        const editorConfig = JSON.parse(configSignature) as OnlyOfficeConfig;
        const editorEvents =
          editorConfig.events && typeof editorConfig.events === "object"
            ? (editorConfig.events as Record<string, unknown>)
            : {};
        editorConfig.events = {
          ...editorEvents,
          onError: (event: OnlyOfficeEditorEvent) => {
            const errorCode =
              typeof event?.data?.errorCode === "number" ? event.data.errorCode : -1;
            const errorDescription =
              typeof event?.data?.errorDescription === "string" &&
              event.data.errorDescription.trim()
                ? event.data.errorDescription
                : "ONLYOFFICE editor reported an unknown error";
            onEditorError?.(errorCode, errorDescription);
            const existingOnError = editorEvents.onError;
            if (typeof existingOnError === "function") {
              existingOnError(event);
            }
          },
        };
        instances[id] = new window.DocsAPI.DocEditor(id, editorConfig);
      } catch (error) {
        emitLoadError(
          onLoadComponentError,
          -1,
          error instanceof Error
            ? error.message
            : "Unknown error loading component",
        );
      }
    };

    void mountEditor();

    return () => {
      disposed = true;
      destroyOnlyOfficeInstance(id);
      document.getElementById(id)?.replaceChildren();
    };
  }, [
    configSignature,
    id,
    normalizedDocumentServerUrl,
    onEditorError,
    onLoadComponentError,
    scriptUrl,
  ]);

  return <div id={id} />;
}
