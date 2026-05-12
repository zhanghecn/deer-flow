import { ComarkClient } from "@comark/react";
import security from "@comark/react/plugins/security";
import type { RenderOptions } from "beautiful-mermaid";
import mermaid from "comark/plugins/mermaid";
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
} from "react";

import type { PublicAPITurnArtifact } from "../lib/public-api";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  artifacts?: PublicAPITurnArtifact[];
  apiToken?: string;
  baseURL?: string;
}

const safeProtocol = /^(https?|ircs?|mailto|xmpp):/i;
const explicitScheme = /^[a-z][a-z\d+.-]*:/i;
const THREAD_ROOT_PREFIX = "/mnt/user-data";
// Assistant text is untrusted. Keep Comark's heavier plugins optional, but
// always strip active content and data images before custom link handling runs.
const comarkPlugins = [
  security({
    allowDataImages: false,
    blockedTags: ["script", "style", "iframe", "object", "embed"],
  }),
  mermaid(),
];

const MermaidBlock = lazy(() =>
  import("@comark/react/components/Mermaid").then(({ Mermaid }) => ({
    default: Mermaid,
  })),
);
type MermaidThemeProp = ComponentProps<typeof MermaidBlock>["theme"];

const readableMermaidTheme: RenderOptions = {
  bg: "#ffffff",
  fg: "#292524",
  line: "#78716c",
  accent: "#0f766e",
  muted: "#57534e",
  surface: "#f5f5f4",
  border: "#d6d3d1",
  padding: 16,
  layerSpacing: 28,
  nodeSpacing: 28,
};

const readableMermaidDarkTheme: RenderOptions = {
  bg: "#18181b",
  fg: "#f4f4f5",
  line: "#a1a1aa",
  accent: "#2dd4bf",
  muted: "#d4d4d8",
  surface: "#27272a",
  border: "#52525b",
  padding: 16,
  layerSpacing: 28,
  nodeSpacing: 28,
};

type KnowledgeCitationTarget = {
  kind: "citation" | "asset";
  artifactPath: string;
  assetPath?: string;
  locatorLabel?: string;
};

type ArtifactPathTarget = {
  kind: "artifact_path";
  artifactPath: string;
};

function normalizeMarkdownURL(url: string | null | undefined) {
  const value = url?.trim();
  if (!value) {
    return undefined;
  }

  if (value.startsWith("kb://") || safeProtocol.test(value)) {
    return value;
  }
  if (explicitScheme.test(value)) {
    return "";
  }
  // Operator-owned relative resources should stay clickable without relying on
  // model prose inference. Bare paths become origin-relative links.
  return value.startsWith("#") ||
    value.startsWith("?") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
    ? value
    : `/${value.replace(/^\/+/, "")}`;
}

function parseKnowledgeCitationHref(
  href: string | null | undefined,
): KnowledgeCitationTarget | null {
  if (!href?.startsWith("kb://")) {
    return null;
  }

  try {
    const url = new URL(href);
    const artifactPath = url.searchParams.get("artifact_path")?.trim();
    if (!artifactPath) {
      return null;
    }
    return {
      kind: url.hostname === "asset" ? "asset" : "citation",
      artifactPath,
      assetPath: url.searchParams.get("asset_path") ?? undefined,
      locatorLabel: url.searchParams.get("locator_label") ?? undefined,
    };
  } catch {
    return null;
  }
}

function stripURLSuffixes(value: string) {
  return value.split("#", 1)[0].split("?", 1)[0];
}

function decodeMaybeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseArtifactPathHref(
  href: string | null | undefined,
): ArtifactPathTarget | null {
  const value = href?.trim();
  if (!value || value.startsWith("kb://") || safeProtocol.test(value)) {
    return null;
  }

  let candidate = value;
  if (explicitScheme.test(value)) {
    try {
      const url = new URL(value);
      if (!["artifact:", "sandbox:", "file:"].includes(url.protocol)) {
        return null;
      }
      candidate = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }

  const pathCandidate = stripURLSuffixes(
    decodeMaybeURIComponent(candidate).replace(/\\/g, "/"),
  );
  const normalizedCandidate = pathCandidate.replace(/^\.\//, "");
  const isRuntimeArtifactPath =
    normalizedCandidate.startsWith("/mnt/user-data/outputs/") ||
    normalizedCandidate.startsWith("mnt/user-data/outputs/") ||
    normalizedCandidate.startsWith("/outputs/") ||
    normalizedCandidate.startsWith("outputs/");
  if (!isRuntimeArtifactPath) {
    return null;
  }

  return {
    kind: "artifact_path",
    artifactPath: normalizedCandidate,
  };
}

function normalizeVirtualPath(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith(THREAD_ROOT_PREFIX)
    ? trimmed
    : `${THREAD_ROOT_PREFIX}/${trimmed.replace(/^\/+/, "")}`;
}

function findArtifactForKnowledgeTarget(
  target: KnowledgeCitationTarget | null,
  artifacts: PublicAPITurnArtifact[],
) {
  if (!target) {
    return null;
  }
  const preferredPath =
    target.kind === "asset" ? target.assetPath : target.artifactPath;
  const normalizedPreferredPath = normalizeVirtualPath(preferredPath);
  if (!normalizedPreferredPath) {
    return null;
  }

  return (
    artifacts.find(
      (artifact) =>
        normalizeVirtualPath(artifact.virtual_path) === normalizedPreferredPath,
    ) ?? null
  );
}

function findArtifactForPathTarget(
  target: ArtifactPathTarget | null,
  artifacts: PublicAPITurnArtifact[],
) {
  if (!target) {
    return null;
  }

  const normalizedTargetPath = normalizeVirtualPath(target.artifactPath);
  if (!normalizedTargetPath) {
    return null;
  }

  return (
    artifacts.find(
      (artifact) =>
        normalizeVirtualPath(artifact.virtual_path) === normalizedTargetPath,
    ) ?? null
  );
}

function resolvePublicAPIDownloadURL(baseURL: string, downloadURL: string) {
  const trimmedBaseURL = baseURL.trim().replace(/\/+$/, "");
  const normalizedBaseURL = trimmedBaseURL.endsWith("/v1")
    ? `${trimmedBaseURL}/`
    : `${trimmedBaseURL}/v1/`;
  return new URL(downloadURL, normalizedBaseURL).toString();
}

async function fetchPublicArtifactBlob(params: {
  artifact: PublicAPITurnArtifact;
  apiToken: string;
  baseURL: string;
}) {
  const response = await fetch(
    resolvePublicAPIDownloadURL(params.baseURL, params.artifact.download_url),
    {
      headers: {
        Authorization: `Bearer ${params.apiToken}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to load source: ${response.statusText}`);
  }
  return response.blob();
}

async function openPublicArtifact(params: {
  artifact: PublicAPITurnArtifact;
  apiToken: string;
  baseURL: string;
}) {
  const openedWindow = window.open("about:blank", "_blank");
  if (openedWindow) {
    // The artifact fetch needs an Authorization header, so reserve a tab during
    // the trusted click and fill it with the fetched blob once it arrives.
    openedWindow.opener = null;
  }

  try {
    const blob = await fetchPublicArtifactBlob(params);
    const objectURL = URL.createObjectURL(blob);
    if (openedWindow && !openedWindow.closed) {
      openedWindow.location.replace(objectURL);
    } else {
      window.location.assign(objectURL);
    }
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
  } catch (error) {
    if (openedWindow && !openedWindow.closed) {
      openedWindow.close();
    }
    throw error;
  }
}

function KnowledgeAwareLink({
  href,
  children,
  artifacts,
  apiToken,
  baseURL,
  onClick,
  ...props
}: ComponentProps<"a"> & {
  artifacts: PublicAPITurnArtifact[];
  apiToken?: string;
  baseURL?: string;
}) {
  const knowledgeTarget = parseKnowledgeCitationHref(href);
  const artifactPathTarget = parseArtifactPathHref(href);
  const artifact =
    findArtifactForKnowledgeTarget(knowledgeTarget, artifacts) ??
    findArtifactForPathTarget(artifactPathTarget, artifacts);
  const canOpenArtifact = Boolean(artifact && apiToken && baseURL);
  const normalizedHref = normalizeMarkdownURL(href);
  const resolvedHref =
    artifact && baseURL
      ? resolvePublicAPIDownloadURL(baseURL, artifact.download_url)
      : normalizedHref;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || (!knowledgeTarget && !artifactPathTarget)) {
      return;
    }

    if (!artifact || !apiToken || !baseURL) {
      event.preventDefault();
      console.warn("Referenced artifact is unavailable in this demo.");
      return;
    }

    event.preventDefault();
    void openPublicArtifact({
      artifact,
      apiToken,
      baseURL,
    }).catch((error) => {
      console.error("Failed to open knowledge citation artifact:", error);
    });
  }

  if (!knowledgeTarget && !artifactPathTarget) {
    return (
      <a {...props} href={normalizedHref} onClick={onClick}>
        {children}
      </a>
    );
  }

  return (
    <a
      {...props}
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!canOpenArtifact ? true : undefined}
      data-kb-citation={knowledgeTarget?.kind}
      data-artifact-path={artifactPathTarget?.kind}
      data-kb-resolution={canOpenArtifact ? "resolved" : "missing"}
      title={
        !canOpenArtifact
          ? "Artifact is not available in this public API response."
          : props.title
      }
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

function KnowledgeAwareImage({
  src,
  alt,
  artifacts,
  apiToken,
  baseURL,
  ...props
}: ComponentProps<"img"> & {
  artifacts: PublicAPITurnArtifact[];
  apiToken?: string;
  baseURL?: string;
}) {
  const knowledgeTarget = parseKnowledgeCitationHref(src);
  const artifactPathTarget = parseArtifactPathHref(src);
  const normalizedSrc = normalizeMarkdownURL(src);
  const artifact =
    knowledgeTarget?.kind === "asset"
      ? findArtifactForKnowledgeTarget(knowledgeTarget, artifacts)
      : findArtifactForPathTarget(artifactPathTarget, artifacts);
  const [objectURL, setObjectURL] = useState("");

  useEffect(() => {
    if (!artifact || !apiToken || !baseURL) {
      setObjectURL("");
      return;
    }

    let cancelled = false;
    let nextObjectURL = "";
    void fetchPublicArtifactBlob({ artifact, apiToken, baseURL })
      .then((blob) => {
        if (cancelled) {
          return;
        }
        nextObjectURL = URL.createObjectURL(blob);
        setObjectURL(nextObjectURL);
      })
      .catch((error) => {
        console.error("Failed to load knowledge asset image:", error);
        setObjectURL("");
      });

    return () => {
      cancelled = true;
      if (nextObjectURL) {
        URL.revokeObjectURL(nextObjectURL);
      }
    };
  }, [apiToken, artifact, baseURL]);

  if ((knowledgeTarget?.kind === "asset" || artifactPathTarget) && !objectURL) {
    return (
      <span
        data-kb-citation={knowledgeTarget?.kind}
        data-artifact-path={artifactPathTarget?.kind}
        data-kb-resolution="missing"
      >
        [Image unavailable:{" "}
        {alt || knowledgeTarget?.locatorLabel || artifactPathTarget?.artifactPath || "source"}]
      </span>
    );
  }

  return <img {...props} src={objectURL || normalizedSrc} alt={alt} />;
}

function MarkdownTable(props: ComponentProps<"table">) {
  return (
    <div className="markdown-table-wrap">
      <table {...props} />
    </div>
  );
}

function MarkdownMermaid(props: ComponentProps<typeof MermaidBlock>) {
  return (
    <Suspense fallback={<div className="mermaid">Rendering diagram...</div>}>
      <MermaidBlock
        {...props}
        // The React component type exposes colors, but beautiful-mermaid also
        // accepts spacing options at runtime; keep diagrams compact and legible.
        theme={readableMermaidTheme as MermaidThemeProp}
        themeDark={readableMermaidDarkTheme as MermaidThemeProp}
      />
    </Suspense>
  );
}

export function MarkdownRenderer({
  content,
  className = "",
  isStreaming = false,
  artifacts = [],
  apiToken,
  baseURL,
}: MarkdownRendererProps) {
  const components = useMemo(
    () => ({
      a: (props: ComponentProps<"a">) => (
        <KnowledgeAwareLink
          {...props}
          artifacts={artifacts}
          apiToken={apiToken}
          baseURL={baseURL}
        />
      ),
      img: (props: ComponentProps<"img">) => (
        <KnowledgeAwareImage
          {...props}
          artifacts={artifacts}
          apiToken={apiToken}
          baseURL={baseURL}
        />
      ),
      mermaid: MarkdownMermaid,
      table: MarkdownTable,
    }),
    [apiToken, artifacts, baseURL],
  );

  if (!content) {
    return null;
  }

  return (
    <ComarkClient
      className={`markdown-body ${className}`}
      // Keep the demo renderer lean: Comark handles streaming-safe Markdown,
      // while heavier syntax/diagram plugins can be added explicitly later.
      components={components}
      plugins={comarkPlugins}
      streaming={isStreaming}
    >
      {content}
    </ComarkClient>
  );
}
