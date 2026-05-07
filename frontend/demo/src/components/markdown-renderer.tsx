import {
  defaultRehypePlugins,
  Streamdown,
  type MermaidConfig,
  type StreamdownProps,
} from "streamdown";
import {
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

const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;
const THREAD_ROOT_PREFIX = "/mnt/user-data";

type KnowledgeCitationTarget = {
  kind: "citation" | "asset";
  artifactPath: string;
  assetPath?: string;
  locatorLabel?: string;
};

type StreamdownElementNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: StreamdownElementNode[];
};

const defaultHardenPlugin = defaultRehypePlugins.harden as [
  unknown,
  Record<string, unknown>,
];

// Demo chat must preserve app-owned kb:// links so public API answers render
// the same citation surface as the 8083 workspace while keeping Streamdown's
// normal hardening for unrelated links and images.
const demoRehypePlugins = [
  rehypeNormalizeRelativeResourceLinks,
  [
    defaultHardenPlugin[0],
    {
      ...defaultHardenPlugin[1],
      allowedProtocols: ["kb:"],
    },
  ],
  defaultRehypePlugins.raw,
  defaultRehypePlugins.katex,
] as StreamdownProps["rehypePlugins"];

function normalizeStreamdownUrl(url: string) {
  if (url.startsWith("kb://")) {
    return url;
  }

  const colon = url.indexOf(":");
  const questionMark = url.indexOf("?");
  const numberSign = url.indexOf("#");
  const slash = url.indexOf("/");
  const hasExplicitScheme =
    colon !== -1 &&
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign);

  if (!hasExplicitScheme) {
    // Keep explicit Markdown links to operator-owned relative resources
    // clickable as origin-relative URLs without prose-level path inference.
    if (
      url.startsWith("#") ||
      url.startsWith("?") ||
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../")
    ) {
      return url;
    }
    return `/${url.replace(/^\/+/, "")}`;
  }

  if (safeProtocol.test(url.slice(0, colon))) {
    return url;
  }

  return "";
}

function streamdownUrlTransform(url: string) {
  return normalizeStreamdownUrl(url);
}

function rehypeNormalizeRelativeResourceLinks() {
  return (tree: StreamdownElementNode) => {
    const visitNode = (node: StreamdownElementNode) => {
      if (node.type === "element" && node.tagName === "a") {
        const href = node.properties?.href;
        if (typeof href === "string") {
          node.properties = {
            ...node.properties,
            href: normalizeStreamdownUrl(href),
          };
        }
      }
      for (const child of node.children ?? []) {
        visitNode(child);
      }
    };

    visitNode(tree);
  };
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
  const blob = await fetchPublicArtifactBlob(params);
  const objectURL = URL.createObjectURL(blob);
  const openedWindow = window.open(objectURL, "_blank", "noopener,noreferrer");
  if (!openedWindow) {
    window.location.assign(objectURL);
  }
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
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
  const artifact = findArtifactForKnowledgeTarget(knowledgeTarget, artifacts);
  const canOpenArtifact = Boolean(artifact && apiToken && baseURL);
  const resolvedHref =
    artifact && baseURL
      ? resolvePublicAPIDownloadURL(baseURL, artifact.download_url)
      : href;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !knowledgeTarget) {
      return;
    }

    if (!artifact || !apiToken || !baseURL) {
      event.preventDefault();
      console.warn("Knowledge citation artifact is unavailable in this demo.");
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

  if (!knowledgeTarget) {
    return (
      <a {...props} href={href} onClick={onClick}>
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
      data-kb-citation={knowledgeTarget.kind}
      data-kb-resolution={canOpenArtifact ? "resolved" : "missing"}
      title={
        !canOpenArtifact
          ? "Source artifact is not available in this public API response."
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
  const artifact =
    knowledgeTarget?.kind === "asset"
      ? findArtifactForKnowledgeTarget(knowledgeTarget, artifacts)
      : null;
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

  if (knowledgeTarget?.kind === "asset" && !objectURL) {
    return (
      <span data-kb-citation="asset" data-kb-resolution="missing">
        [Image unavailable: {alt || knowledgeTarget.locatorLabel || "source"}]
      </span>
    );
  }

  return <img {...props} src={objectURL || src} alt={alt} />;
}

const mermaidConfig = {
  theme: "base",
  themeVariables: {
    primaryColor: "#e0f2fe",
    primaryTextColor: "#0f172a",
    primaryBorderColor: "#38bdf8",
    lineColor: "#64748b",
    secondaryColor: "#ecfdf5",
    tertiaryColor: "#f8fafc",
    fontFamily:
      "IBM Plex Mono, IBM Plex Sans, PingFang SC, Microsoft YaHei, sans-serif",
  },
} satisfies MermaidConfig;

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
    }),
    [apiToken, artifacts, baseURL],
  );

  if (!content) {
    return null;
  }

  return (
    <Streamdown
      className={`markdown-body ${className}`}
      // Keep demo chat behavior aligned with the 8083 workspace renderer:
      // Streamdown owns Mermaid, math, syntax highlighting, and partial blocks.
      components={components}
      rehypePlugins={demoRehypePlugins}
      mermaidConfig={mermaidConfig}
      isAnimating={isStreaming}
      urlTransform={streamdownUrlTransform}
    >
      {content}
    </Streamdown>
  );
}
