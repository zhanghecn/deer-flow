import { ChevronDownIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PublicAPIPlaygroundPanel } from "@/components/workspace/public-api-playground-dialog";
import {
  type AgentExportDoc,
  usePublicAgentExportDoc,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { getAgentPublicDocsPageText } from "./page.i18n";

const LazyApiReferenceReact = lazy(async () => {
  const module = await import("@scalar/api-reference-react");
  return { default: module.ApiReferenceReact };
});

const SECTION_IDS = {
  quickstart: "quickstart",
  console: "live-console",
  contract: "contract-surface",
  schema: "schema-browser",
} as const;
const TOP_LEVEL_SECTION_HASHES = new Set(
  Object.values(SECTION_IDS).map((id) => `#${id}`),
);

const SCALAR_HIDDEN_CONTROL_LABELS = new Set([
  "Ask AI",
  "Developer Tools",
  "Configure",
  "Share",
  "Deploy",
  "VS Code",
  "Cursor",
  "Generate MCP",
  "Open API Client",
  "Powered by Scalar",
]);

type OpenAPIOperation = {
  summary?: string;
  tags?: string[];
};

type OpenAPIDocument = {
  info?: {
    title?: string;
    description?: string;
    version?: string;
  };
  paths?: Record<string, Record<string, OpenAPIOperation>>;
};

type DeveloperOperationSummary = {
  id: string;
  method: string;
  path: string;
  summary: string;
  scalarAnchor: string;
};

type DeveloperContractSummary = {
  title: string;
  description: string;
  version: string;
  operations: DeveloperOperationSummary[];
};

function normalizeScalarControlText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function shouldHideScalarControl(value: string) {
  const label = normalizeScalarControlText(value);
  return (
    SCALAR_HIDDEN_CONTROL_LABELS.has(label) ||
    label.startsWith("Download OpenAPI Document")
  );
}

function slugifyScalarSegment(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function normalizePublicPath(value: string) {
  return value.startsWith("/v1") ? value : `/v1${value}`;
}

function buildScalarOperationAnchor(tagName: string, method: string, path: string) {
  // Keep the anchor logic aligned with Scalar's current section ids so the
  // developer console can deep-link into the schema renderer without making the
  // page itself the source of truth for field-level API structure.
  return `api-1/tag/${slugifyScalarSegment(tagName)}/${method.toUpperCase()}${path}`;
}

function hashTargetsEmbeddedSchema(hash: string) {
  if (!hash) {
    return false;
  }
  // This page only owns a few top-level anchors itself. Any other hash belongs
  // to the embedded schema renderer and should force that region open so shared
  // deep links keep working even on a fresh page load.
  return hash === `#${SECTION_IDS.schema}` || !TOP_LEVEL_SECTION_HASHES.has(hash);
}

function prettifyEndpointName(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractPublicPath(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname || url;
  } catch {
    return url;
  }
}

function buildFallbackSummary(exportDoc: AgentExportDoc): DeveloperContractSummary {
  return {
    title: `${exportDoc.agent} Public API`,
    description:
      "OpenAI-compatible surface for a published OpenAgents contract.",
    version: "1.0.0",
    operations: Object.entries(exportDoc.endpoints).map(
      ([endpointName, endpoint], index) => {
        const publicPath = normalizePublicPath(extractPublicPath(endpoint.url));
        return {
          id: `fallback-operation-${index}`,
          method: endpoint.method.toUpperCase(),
          path: publicPath,
          summary: prettifyEndpointName(endpointName),
          scalarAnchor: "",
        };
      },
    ),
  };
}

function buildOpenAPISummary(
  document: OpenAPIDocument,
  fallbackAgentName: string,
): DeveloperContractSummary {
  const trimmedTitle = document.info?.title?.trim();
  const trimmedDescription = document.info?.description?.trim();
  const trimmedVersion = document.info?.version?.trim();

  const title =
    trimmedTitle && trimmedTitle.length > 0
      ? trimmedTitle
      : `${fallbackAgentName} Public API`;
  const description =
    trimmedDescription && trimmedDescription.length > 0
      ? trimmedDescription
      : "OpenAI-compatible surface for a published OpenAgents contract.";
  const version =
    trimmedVersion && trimmedVersion.length > 0 ? trimmedVersion : "1.0.0";

  const operations = Object.entries(document.paths ?? {}).flatMap(
    ([path, pathItem], pathIndex) =>
      Object.entries(pathItem ?? {}).map(([method, operation], methodIndex) => {
        const trimmedSummary = operation.summary?.trim();
        const trimmedTagName = operation.tags?.[0]?.trim();
        const tagName =
          trimmedTagName && trimmedTagName.length > 0
            ? trimmedTagName
            : "Published Agents";
        return {
          id: `openapi-operation-${pathIndex}-${methodIndex}`,
          method: method.toUpperCase(),
          path: normalizePublicPath(path),
          summary:
            trimmedSummary && trimmedSummary.length > 0
              ? trimmedSummary
              : `${method.toUpperCase()} ${normalizePublicPath(path)}`,
          scalarAnchor: buildScalarOperationAnchor(tagName, method, path),
        };
      }),
  );

  return {
    title,
    description,
    version,
    operations,
  };
}

function methodToneClass(method: string) {
  switch (method.toUpperCase()) {
    case "POST":
      return "bg-slate-950 text-white";
    case "GET":
      return "bg-emerald-100 text-emerald-950";
    case "DELETE":
      return "bg-rose-100 text-rose-950";
    default:
      return "bg-slate-100 text-slate-900";
  }
}

function buildJavaScriptSnippet(baseURL: string, agentName: string) {
  return `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAGENTS_API_KEY,
  baseURL: "${baseURL}",
});

const response = await client.responses.create({
  model: "${agentName}",
  input: "Review the uploaded materials and summarize the next actions.",
});

console.log(response.output_text);`;
}

function buildPythonSnippet(baseURL: string, agentName: string) {
  return `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OPENAGENTS_API_KEY"],
    base_url="${baseURL}",
)

response = client.responses.create(
    model="${agentName}",
    input="Review the uploaded materials and summarize the next actions.",
)

print(response.output_text)`;
}

function buildCurlSnippet(baseURL: string, agentName: string) {
  return `curl -X POST "${baseURL}/responses" \\
  -H "Authorization: Bearer <user_created_key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${agentName}",
    "input": "Review the uploaded materials and summarize the next actions."
  }'`;
}

function StatePanel({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="min-h-screen bg-[#f6f1e7] px-6 py-20">
      <section className="mx-auto max-w-4xl rounded-[32px] border border-slate-200 bg-white px-8 py-12 shadow-[0_30px_100px_-72px_rgba(15,23,42,0.3)]">
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
          {title}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-7">
          {description}
        </p>
        {actionLabel && actionHref ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to={actionHref}>{actionLabel}</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CopyableCodeBlock({
  code,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(copiedLabel);
    } catch {
      toast.error(copyLabel);
    }
  }

  return (
    <div className="overflow-hidden rounded-[30px] border border-slate-900/80 bg-slate-950 shadow-[0_30px_90px_-54px_rgba(15,23,42,0.8)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-rose-400/80" />
          <span className="size-2 rounded-full bg-amber-300/80" />
          <span className="size-2 rounded-full bg-emerald-400/80" />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
          onClick={handleCopy}
        >
          <CopyIcon className="size-4" />
          {copyLabel}
        </Button>
      </div>
      <ScrollArea className="h-[320px] px-4 py-4">
        <pre className="font-mono text-xs leading-6 whitespace-pre-wrap text-slate-100">
          {code}
        </pre>
      </ScrollArea>
    </div>
  );
}

function AnchorPill({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
    >
      {label}
    </a>
  );
}

function MetaCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_60px_-48px_rgba(15,23,42,0.35)]">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-3 text-base font-medium leading-7 text-slate-950",
          mono && "font-mono text-[13px] break-all",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-4xl">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-[clamp(1.8rem,3vw,2.8rem)] leading-[0.98] font-semibold tracking-[-0.05em] text-slate-950">
        {title}
      </h2>
      <p className="text-muted-foreground mt-4 text-sm leading-7">
        {description}
      </p>
    </div>
  );
}

export default function AgentPublicDocsPage() {
  const { locale } = useI18n();
  const text = getAgentPublicDocsPageText(locale);
  const { agent_name } = useParams<{ agent_name: string }>();
  const { exportDoc, isLoading, error } = usePublicAgentExportDoc(agent_name);
  const [openapiSummary, setOpenapiSummary] =
    useState<DeveloperContractSummary | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [currentHash, setCurrentHash] = useState("");
  const scalarContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function syncSchemaStateFromHash() {
      if (typeof window === "undefined") {
        return;
      }
      const nextHash = window.location.hash;
      setCurrentHash(nextHash);
      if (hashTargetsEmbeddedSchema(nextHash)) {
        setSchemaOpen(true);
      }
    }

    syncSchemaStateFromHash();
    window.addEventListener("hashchange", syncSchemaStateFromHash);
    return () => {
      window.removeEventListener("hashchange", syncSchemaStateFromHash);
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !schemaOpen ||
      !currentHash ||
      !hashTargetsEmbeddedSchema(currentHash) ||
      currentHash === `#${SECTION_IDS.schema}`
    ) {
      return;
    }

    const targetID = decodeURIComponent(currentHash.slice(1));
    let frameID = 0;
    let attempts = 0;

    function scrollToSchemaAnchor() {
      const target = document.getElementById(targetID);
      if (target) {
        target.scrollIntoView({ block: "start" });
        return;
      }

      attempts += 1;
      if (attempts < 120) {
        frameID = window.requestAnimationFrame(scrollToSchemaAnchor);
      }
    }

    // The schema viewer mounts lazily, so a direct deep link may arrive before
    // Scalar has created the target node. Retry briefly until the anchor
    // exists, then scroll it into view.
    frameID = window.requestAnimationFrame(scrollToSchemaAnchor);
    return () => {
      window.cancelAnimationFrame(frameID);
    };
  }, [currentHash, schemaOpen]);

  useEffect(() => {
    if (!exportDoc) {
      return;
    }

    const controller = new AbortController();
    const openapiURL =
      exportDoc.openapi_url ??
      `/open/agents/${encodeURIComponent(exportDoc.agent)}/openapi.json`;

    // The hero summary, route list, and schema browser all derive from the
    // same backend-generated OpenAPI document so the single-page developer
    // console does not invent a second contract surface.
    fetch(openapiURL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load OpenAPI document: ${response.status}`);
        }
        return response.json() as Promise<OpenAPIDocument>;
      })
      .then((document) => {
        if (!controller.signal.aborted) {
          setOpenapiSummary(buildOpenAPISummary(document, exportDoc.agent));
        }
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) {
          console.error(fetchError);
          setOpenapiSummary(null);
        }
      });

    return () => {
      controller.abort();
    };
  }, [exportDoc]);

  useEffect(() => {
    if (!schemaOpen || !scalarContainerRef.current) {
      return;
    }

    const root = scalarContainerRef.current;

    function markHidden(node: Element | null) {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const target = node.parentElement?.classList.contains("contents")
        ? node.parentElement
        : node;
      target.dataset.openagentsHidden = "true";
    }

    function pruneScalarChrome() {
      root
        .querySelectorAll<HTMLElement>(".scalar-reference-intro-clients")
        .forEach((element) => {
          markHidden(element);
        });

      root
        .querySelectorAll<HTMLElement>('[aria-label="Developer Tools"]')
        .forEach((element) => {
          markHidden(element);
        });

      root
        .querySelectorAll<HTMLElement>("button, a, [role='button']")
        .forEach((element) => {
          if (shouldHideScalarControl(element.textContent ?? "")) {
            markHidden(element);
          }
        });
    }

    pruneScalarChrome();

    const observer = new MutationObserver(() => {
      pruneScalarChrome();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [schemaOpen]);

  const scalarConfiguration = useMemo(() => {
    if (!exportDoc) {
      return null;
    }
    return {
      url:
        exportDoc.openapi_url ??
        `/open/agents/${encodeURIComponent(exportDoc.agent)}/openapi.json`,
      theme: "saturn" as const,
      layout: "modern" as const,
      showSidebar: false,
      forceDarkModeState: "light" as const,
      hideDarkModeToggle: true,
      hideClientButton: true,
      hiddenClients: true as const,
      showDeveloperTools: "never" as const,
      // Scalar replaced the older hideDownloadButton flag with an explicit
      // document download mode. Keep the new setting only so browser audits
      // stay free of deprecation noise.
      documentDownloadType: "none" as const,
      mcp: {
        // The developer console should document the published agent surface
        // itself, not Scalar's product ecosystem, so we disable vendor extras.
        disabled: true,
      },
      persistAuth: true,
      searchHotKey: "k" as const,
      telemetry: false,
    };
  }, [exportDoc]);

  const fallbackSummary = useMemo(
    () => (exportDoc ? buildFallbackSummary(exportDoc) : null),
    [exportDoc],
  );
  const contractSummary = openapiSummary ?? fallbackSummary;

  const javascriptSnippet = useMemo(() => {
    if (!exportDoc) {
      return "";
    }
    return buildJavaScriptSnippet(exportDoc.api_base_url, exportDoc.agent);
  }, [exportDoc]);

  const pythonSnippet = useMemo(() => {
    if (!exportDoc) {
      return "";
    }
    return buildPythonSnippet(exportDoc.api_base_url, exportDoc.agent);
  }, [exportDoc]);

  const curlSnippet = useMemo(() => {
    if (!exportDoc) {
      return "";
    }
    return buildCurlSnippet(exportDoc.api_base_url, exportDoc.agent);
  }, [exportDoc]);

  if (isLoading) {
    return (
      <StatePanel
        eyebrow={text.eyebrow}
        title={text.loadingTitle}
        description={text.loadingDescription}
      />
    );
  }

  if (!exportDoc || error || !contractSummary) {
    return (
      <StatePanel
        eyebrow={text.eyebrow}
        title={text.loadFailedTitle}
        description={
          error instanceof Error ? error.message : text.loadFailedDescription
        }
        actionLabel={text.openHome}
        actionHref="/"
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f1e7] text-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-[radial-gradient(circle_at_top_left,rgba(15,23,42,0.1),transparent_58%),radial-gradient(circle_at_top_right,rgba(148,163,184,0.18),transparent_46%)]" />

      <div className="relative mx-auto max-w-[1540px] px-4 pb-16 lg:px-8">
        <header className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-[#f6f1e7]/92 px-4 py-4 backdrop-blur lg:-mx-8 lg:px-8">
          <div className="mx-auto flex max-w-[1540px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-white px-3 py-1 text-[11px] tracking-[0.22em] uppercase"
              >
                {text.eyebrow}
              </Badge>
              <p className="truncate font-mono text-sm text-slate-900">
                {exportDoc.agent}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-slate-200 bg-white px-3 py-2">
                <p className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
                  {text.baseURL}
                </p>
                <p className="mt-1 max-w-[320px] truncate text-sm font-medium text-slate-900">
                  {exportDoc.api_base_url}
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-2">
                <p className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
                  {text.modelName}
                </p>
                <p className="mt-1 max-w-[240px] truncate text-sm font-medium text-slate-900">
                  {exportDoc.model ?? exportDoc.agent}
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="pt-10">
          <section
            id={SECTION_IDS.quickstart}
            className="scroll-mt-28 border-b border-slate-200 pb-12"
          >
            <div className="grid gap-10 xl:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)]">
              <div>
                <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
                  {text.eyebrow}
                </p>
                <h1 className="mt-4 max-w-4xl text-[clamp(2.8rem,5vw,5.4rem)] leading-[0.92] font-semibold tracking-[-0.08em] text-slate-950">
                  {text.heroTitle}
                </h1>
                <p className="text-muted-foreground mt-5 max-w-3xl text-base leading-8">
                  {text.heroDescription}
                </p>

                <nav className="mt-8 flex flex-wrap gap-2">
                  <AnchorPill
                    href={`#${SECTION_IDS.quickstart}`}
                    label={text.navQuickstart}
                  />
                  <AnchorPill
                    href={`#${SECTION_IDS.console}`}
                    label={text.navConsole}
                  />
                  <AnchorPill
                    href={`#${SECTION_IDS.contract}`}
                    label={text.navContract}
                  />
                  <AnchorPill
                    href={`#${SECTION_IDS.schema}`}
                    label={text.navSchema}
                    onClick={() => setSchemaOpen(true)}
                  />
                </nav>

                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  <MetaCard label={text.baseURL} value={exportDoc.api_base_url} />
                  <MetaCard
                    label={text.modelName}
                    value={exportDoc.model ?? exportDoc.agent}
                    mono
                  />
                  <MetaCard
                    label={text.apiKeyLabel}
                    value="Bearer <user_created_key>"
                    mono
                  />
                </div>

                <div className="mt-8 rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_24px_80px_-64px_rgba(15,23,42,0.35)]">
                  <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
                    {text.workflowEyebrow}
                  </p>
                  <h2 className="mt-4 text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                    {text.workflowTitle}
                  </h2>

                  <div className="mt-6 space-y-4">
                    {[text.workflowStepBaseURL, text.workflowStepModel, text.workflowStepMode].map(
                      (item, index) => (
                        <div
                          key={item}
                          className="grid gap-4 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[42px_minmax(0,1fr)]"
                        >
                          <div className="flex size-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900">
                            {index + 1}
                          </div>
                          <p className="text-sm leading-7 text-slate-900">{item}</p>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>

              <div className="xl:pt-10">
                <div className="rounded-[34px] border border-slate-200 bg-[linear-gradient(180deg,rgba(15,23,42,0.03),rgba(255,255,255,0.7))] p-4 shadow-[0_24px_80px_-62px_rgba(15,23,42,0.4)] lg:p-6">
                  <div className="max-w-lg">
                    <p className="text-muted-foreground text-[11px] font-medium tracking-[0.22em] uppercase">
                      {text.snippetEyebrow}
                    </p>
                    <h2 className="mt-4 text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                      {text.snippetTitle}
                    </h2>
                    <p className="text-muted-foreground mt-4 text-sm leading-7">
                      {text.snippetDescription}
                    </p>
                  </div>

                  <Tabs defaultValue="javascript" className="mt-6">
                    <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-white">
                      <TabsTrigger value="javascript">{text.jsTab}</TabsTrigger>
                      <TabsTrigger value="python">{text.pythonTab}</TabsTrigger>
                      <TabsTrigger value="curl">{text.curlTab}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="javascript" className="mt-4">
                      <CopyableCodeBlock
                        code={javascriptSnippet}
                        copyLabel={text.copy}
                        copiedLabel={text.copied}
                      />
                    </TabsContent>
                    <TabsContent value="python" className="mt-4">
                      <CopyableCodeBlock
                        code={pythonSnippet}
                        copyLabel={text.copy}
                        copiedLabel={text.copied}
                      />
                    </TabsContent>
                    <TabsContent value="curl" className="mt-4">
                      <CopyableCodeBlock
                        code={curlSnippet}
                        copyLabel={text.copy}
                        copiedLabel={text.copied}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </div>
          </section>

          <section
            id={SECTION_IDS.console}
            className="scroll-mt-28 border-b border-slate-200 py-12"
          >
            <SectionHeader
              eyebrow={text.consoleEyebrow}
              title={text.consoleTitle}
              description={text.consoleDescription}
            />

            <div className="mt-8">
              <PublicAPIPlaygroundPanel
                agentName={exportDoc.agent}
                defaultBaseURL={exportDoc.api_base_url}
                documentationURL={`#${SECTION_IDS.schema}`}
                accessMode="public"
                headerMode="hidden"
                hideDocumentationButton
              />
            </div>
          </section>

          <section
            id={SECTION_IDS.contract}
            className="scroll-mt-28 border-b border-slate-200 py-12"
          >
            <SectionHeader
              eyebrow={text.contractEyebrow}
              title={text.contractTitle}
              description={text.contractDescription}
            />

            <div className="mt-8 grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
                  <MetaCard label={text.versionLabel} value={contractSummary.version} />
                  <MetaCard
                    label={text.routesLabel}
                    value={String(contractSummary.operations.length)}
                  />
                  <MetaCard label={text.modesLabel} value={text.modesValue} />
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_24px_80px_-64px_rgba(15,23,42,0.35)]">
                  <h3 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
                    {text.authTitle}
                  </h3>
                  <p className="text-muted-foreground mt-3 text-sm leading-7">
                    {text.authDescription}
                  </p>

                  <div className="mt-6 space-y-3">
                    <div className="grid gap-2 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
                      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                        {text.authHeaderLabel}
                      </p>
                      <p className="font-mono text-sm text-slate-950">
                        {text.authHeaderValue}
                      </p>
                    </div>
                    <div className="grid gap-2 border-t border-slate-200 pt-3">
                      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                        {text.authValueLabel}
                      </p>
                      <p className="font-mono text-sm text-slate-950">
                        {text.authValueExample}
                      </p>
                    </div>
                    <div className="grid gap-2 border-t border-slate-200 pt-3">
                      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
                        {text.authScopeLabel}
                      </p>
                      <p className="text-sm leading-7 text-slate-950">
                        {text.authScopeValue}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_-64px_rgba(15,23,42,0.35)]">
                <div className="border-b border-slate-200 px-5 py-5">
                  <h3 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
                    {text.endpointsTitle}
                  </h3>
                  <p className="text-muted-foreground mt-3 max-w-3xl text-sm leading-7">
                    {text.endpointsDescription}
                  </p>
                </div>

                <div className="divide-y divide-slate-200">
                  {contractSummary.operations.map((operation) => (
                    <section
                      key={operation.id}
                      className="grid gap-4 px-5 py-5 lg:grid-cols-[160px_minmax(0,1fr)_140px]"
                    >
                      <div className="space-y-3">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-3 py-1 font-mono text-[11px] tracking-[0.18em] uppercase",
                            methodToneClass(operation.method),
                          )}
                        >
                          {operation.method}
                        </span>
                        <p className="font-mono text-xs leading-6 break-all text-slate-600">
                          {operation.path}
                        </p>
                      </div>

                      <div>
                        <p className="text-base font-medium leading-7 text-slate-950">
                          {operation.summary}
                        </p>
                      </div>

                      <div className="lg:text-right">
                        {operation.scalarAnchor ? (
                          <a
                            href={`#${operation.scalarAnchor}`}
                            onClick={() => setSchemaOpen(true)}
                            className="text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                          >
                            {text.openInSchema}
                          </a>
                        ) : null}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section
            id={SECTION_IDS.schema}
            className="scroll-mt-28 py-12"
          >
            <div className="rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_80px_-62px_rgba(15,23,42,0.35)]">
              <Collapsible open={schemaOpen} onOpenChange={setSchemaOpen}>
                <div className="flex flex-col gap-5 border-b border-slate-200 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-4xl">
                    <SectionHeader
                      eyebrow={text.schemaEyebrow}
                      title={text.schemaTitle}
                      description={text.schemaDescription}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {exportDoc.openapi_url ? (
                      <Button variant="outline" asChild className="rounded-full">
                        <a
                          href={exportDoc.openapi_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLinkIcon className="size-4" />
                          {text.rawOpenAPI}
                        </a>
                      </Button>
                    ) : null}
                    {exportDoc.documentation_json_url ? (
                      <Button variant="outline" asChild className="rounded-full">
                        <a
                          href={exportDoc.documentation_json_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLinkIcon className="size-4" />
                          {text.rawExport}
                        </a>
                      </Button>
                    ) : null}
                    <CollapsibleTrigger asChild>
                      <Button className="rounded-full">
                        <ChevronDownIcon
                          className={cn(
                            "size-4 transition-transform",
                            schemaOpen ? "rotate-180" : "rotate-0",
                          )}
                        />
                        {schemaOpen ? text.hideSchema : text.openSchema}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </div>

                <CollapsibleContent>
                  <style>
                    {`
                      .developer-console-schema [data-openagents-hidden="true"] {
                        display: none !important;
                      }

                      .developer-console-schema .t-doc__sidebar,
                      .developer-console-schema .t-doc__header {
                        display: none !important;
                      }

                      .developer-console-schema .references-rendered > .section-flare,
                      .developer-console-schema .references-rendered .section.introduction-section {
                        display: none !important;
                      }

                      .developer-console-schema .references-rendered .narrow-references-container {
                        max-width: none !important;
                        margin: 0 !important;
                        padding: 24px 24px 80px !important;
                      }
                    `}
                  </style>

                  <div className="developer-console-schema px-5 py-5">
                    {scalarConfiguration ? (
                      <Suspense
                        fallback={
                          <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                            {text.loadingSchema}
                          </div>
                        }
                      >
                        <div
                          ref={scalarContainerRef}
                          className="overflow-hidden rounded-[24px] border border-slate-200 bg-white"
                        >
                          <LazyApiReferenceReact configuration={scalarConfiguration} />
                        </div>
                      </Suspense>
                    ) : (
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                        {text.loadingSchema}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
