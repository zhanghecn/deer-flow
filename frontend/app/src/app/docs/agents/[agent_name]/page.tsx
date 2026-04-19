import { ExternalLinkIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildPublicAgentPlaygroundPath,
  buildPublicAgentReferencePath,
  usePublicAgentExportDoc,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { listReferenceOperations, usePublicAgentOpenAPIDoc } from "./openapi";
import { getAgentPublicDocsPageText } from "./page.i18n";
import {
  CopyableCodeBlock,
  DeveloperDocsShell,
  DocsMethodBadge,
  PublicDocsPageHeading,
  PublicDocsStatePanel,
  type DeveloperDocsSidebarSection,
} from "./shared";

function buildJavaScriptSnippet(baseURL: string, agentName: string) {
  return `const response = await fetch("${baseURL}/turns", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.OPENAGENTS_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    agent: "${agentName}",
    input: {
      text: "Review the uploaded materials and summarize the next actions.",
    },
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const turn = await response.json();
console.log(turn.output_text);`;
}

function buildPythonSnippet(baseURL: string, agentName: string) {
  return `import json
import os
import urllib.request

request = urllib.request.Request(
    "${baseURL}/turns",
    data=json.dumps(
        {
            "agent": "${agentName}",
            "input": {
                "text": "Review the uploaded materials and summarize the next actions."
            },
        }
    ).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['OPENAGENTS_API_KEY']}",
        "Content-Type": "application/json",
    },
    method="POST",
)

with urllib.request.urlopen(request) as response:
    turn = json.loads(response.read().decode("utf-8"))

print(turn["output_text"])`;
}

function buildCurlSnippet(baseURL: string, agentName: string) {
  return `curl -X POST "${baseURL}/turns" \\
  -H "Authorization: Bearer <user_created_key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent": "${agentName}",
    "input": {
      "text": "Review the uploaded materials and summarize the next actions."
    }
  }'`;
}

/** Flat route listing — one row per route, no table borders */
function RouteList({
  routes,
  referencePath,
  openReferenceLabel,
}: {
  routes: ReturnType<typeof listReferenceOperations>;
  referencePath: string;
  openReferenceLabel: string;
}) {
  return (
    <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
      {routes.map((route) => (
        <div
          key={route.anchorId}
          className="flex items-center gap-3 px-4 py-3"
        >
          <DocsMethodBadge method={route.method} />
          <code className="font-mono text-[13px] text-zinc-700">
            {route.path}
          </code>
          <span className="text-[13px] text-zinc-500">{route.title}</span>
          <div className="ml-auto">
            <Button asChild variant="ghost" size="sm" className="h-7 text-[11px]">
              <Link to={`${referencePath}#${route.anchorId}`}>
                {openReferenceLabel}
                <ExternalLinkIcon className="size-3" />
              </Link>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AgentPublicDocsPage() {
  const { locale } = useI18n();
  const text = getAgentPublicDocsPageText(locale);
  const { agent_name } = useParams<{ agent_name: string }>();
  const { exportDoc, isLoading, error } = usePublicAgentExportDoc(agent_name);
  const {
    openapiDoc,
    openapiURL,
    isLoading: isOpenAPILoading,
    error: openapiError,
  } = usePublicAgentOpenAPIDoc(exportDoc);

  if (isLoading || (exportDoc && isOpenAPILoading)) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.heroEyebrow}
        title={text.loadingTitle}
        description={text.loadingDescription}
      />
    );
  }

  if (!exportDoc || error) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.heroEyebrow}
        title={text.loadFailedTitle}
        description={
          error instanceof Error ? error.message : text.loadFailedDescription
        }
        actionLabel={text.openHome}
        actionHref="/"
      />
    );
  }

  if (!openapiDoc || openapiError) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.heroEyebrow}
        title={text.referenceFailedTitle}
        description={
          openapiError instanceof Error
            ? openapiError.message
            : text.referenceFailedDescription
        }
        actionLabel={text.openHome}
        actionHref="/"
      />
    );
  }

  const routes = listReferenceOperations(openapiDoc);
  const referencePath = buildPublicAgentReferencePath(exportDoc.agent);
  const playgroundPath = buildPublicAgentPlaygroundPath(exportDoc.agent);
  const javascriptSnippet = buildJavaScriptSnippet(
    exportDoc.api_base_url,
    exportDoc.agent,
  );
  const pythonSnippet = buildPythonSnippet(
    exportDoc.api_base_url,
    exportDoc.agent,
  );
  const curlSnippet = buildCurlSnippet(exportDoc.api_base_url, exportDoc.agent);

  const sidebarSections: DeveloperDocsSidebarSection[] = [
    {
      title: text.heroEyebrow,
      items: [
        { label: text.navOverview, href: "#overview" },
        { label: text.navQuickstart, href: "#quickstart" },
        { label: text.navAuth, href: "#authentication" },
        { label: text.navRoutes, href: "#routes" },
        { label: text.navNext, href: "#next-steps" },
      ],
    },
  ];

  return (
    <DeveloperDocsShell
      activeTab="overview"
      agentName={exportDoc.agent}
      openapiURL={openapiURL}
      exportURL={exportDoc.documentation_json_url}
      sidebarSections={sidebarSections}
    >
      <div className="space-y-10">
        {/* Overview */}
        <section id="overview" className="scroll-mt-20 space-y-5">
          <div className="flex items-center gap-2.5">
            <DocsMethodBadge method="POST" />
            <code className="rounded-md bg-zinc-50 px-3 py-1.5 font-mono text-[13px] text-zinc-800">
              /v1/turns
            </code>
            <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-500">
              {`agent=${exportDoc.agent}`}
            </span>
          </div>

          <PublicDocsPageHeading
            eyebrow={text.heroEyebrow}
            title={text.heroTitle}
            description={text.heroDescription}
          />

          {/* Info grid */}
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
            <div className="grid gap-0 divide-y divide-zinc-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                  {text.baseURL}
                </p>
                <p className="mt-1 font-mono text-[12px] text-zinc-800">
                  {exportDoc.api_base_url}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {text.baseURLNote}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                  {text.apiKeyLabel}
                </p>
                <p className="mt-1 font-mono text-[12px] text-zinc-800">
                  {text.apiKeyExample}
                </p>
              </div>
            </div>
            <div className="grid gap-0 divide-y divide-zinc-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                  {text.modelName}
                </p>
                <p className="mt-1 font-mono text-[12px] text-zinc-800">
                  {exportDoc.agent}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                  {text.modesLabel}
                </p>
                <p className="mt-1 text-[12px] text-zinc-600">
                  {text.modesValue}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Quickstart */}
        <section
          id="quickstart"
          className="scroll-mt-20 space-y-4 border-t border-zinc-100 pt-10"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              {text.quickstartEyebrow}
            </p>
            <h2 className="mt-1.5 text-[18px] font-semibold tracking-tight text-zinc-900">
              {text.quickstartTitle}
            </h2>
            <p className="mt-2 text-[13.5px] leading-6 text-zinc-500">
              {text.quickstartDescription}
            </p>
          </div>

          <Tabs defaultValue="javascript">
            <TabsList className="h-9 rounded-md border border-zinc-200 bg-transparent p-0.5">
              <TabsTrigger
                value="javascript"
                className="rounded-md px-4 text-[12px] data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
              >
                {text.jsTab}
              </TabsTrigger>
              <TabsTrigger
                value="python"
                className="rounded-md px-4 text-[12px] data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
              >
                {text.pythonTab}
              </TabsTrigger>
              <TabsTrigger
                value="curl"
                className="rounded-md px-4 text-[12px] data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
              >
                {text.curlTab}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="javascript" className="mt-3">
              <CopyableCodeBlock
                title="JavaScript"
                code={javascriptSnippet}
                copyLabel={text.copy}
                copiedLabel={text.copied}
              />
            </TabsContent>
            <TabsContent value="python" className="mt-3">
              <CopyableCodeBlock
                title="Python"
                code={pythonSnippet}
                copyLabel={text.copy}
                copiedLabel={text.copied}
              />
            </TabsContent>
            <TabsContent value="curl" className="mt-3">
              <CopyableCodeBlock
                title="cURL"
                code={curlSnippet}
                copyLabel={text.copy}
                copiedLabel={text.copied}
              />
            </TabsContent>
          </Tabs>
        </section>

        {/* Authentication */}
        <section
          id="authentication"
          className="scroll-mt-20 space-y-4 border-t border-zinc-100 pt-10"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              {text.authEyebrow}
            </p>
            <h2 className="mt-1.5 text-[18px] font-semibold tracking-tight text-zinc-900">
              {text.authTitle}
            </h2>
            <p className="mt-2 text-[13.5px] leading-6 text-zinc-500">
              {text.authDescription}
            </p>
          </div>

          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
            <div className="grid gap-0 divide-y divide-zinc-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                  {text.authHeaderLabel}
                </p>
                <p className="mt-1 text-[13px] font-medium text-zinc-800">
                  Authorization
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                  {text.authValueLabel}
                </p>
                <p className="mt-1 font-mono text-[12px] text-zinc-800">
                  Bearer &lt;user_created_key&gt;
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                  {text.authScopeLabel}
                </p>
                <p className="mt-1 text-[13px] text-zinc-600">
                  {text.authScopeValue}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Routes */}
        <section
          id="routes"
          className="scroll-mt-20 space-y-4 border-t border-zinc-100 pt-10"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              {text.routesEyebrow}
            </p>
            <h2 className="mt-1.5 text-[18px] font-semibold tracking-tight text-zinc-900">
              {text.routesTitle}
            </h2>
            <p className="mt-2 text-[13.5px] leading-6 text-zinc-500">
              {text.routesDescription}
            </p>
          </div>

          <RouteList
            routes={routes}
            referencePath={referencePath}
            openReferenceLabel={text.openReference}
          />
        </section>

        {/* Next Steps */}
        <section
          id="next-steps"
          className="scroll-mt-20 space-y-4 border-t border-zinc-100 pt-10"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              {text.nextEyebrow}
            </p>
            <h2 className="mt-1.5 text-[18px] font-semibold tracking-tight text-zinc-900">
              {text.nextTitle}
            </h2>
            <p className="mt-2 text-[13.5px] leading-6 text-zinc-500">
              {text.nextDescription}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white px-5 py-5">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                {text.playgroundEyebrow}
              </p>
              <h3 className="mt-2 text-[14px] font-semibold text-zinc-900">
                {text.playgroundTitle}
              </h3>
              <p className="mt-1 text-[13px] leading-5 text-zinc-500">
                {text.playgroundDescription}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4 h-8 rounded-md text-[12px]">
                <Link to={playgroundPath}>
                  {text.openPlayground}
                  <ExternalLinkIcon className="size-3.5" />
                </Link>
              </Button>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-5 py-5">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                {text.referenceEyebrow}
              </p>
              <h3 className="mt-2 text-[14px] font-semibold text-zinc-900">
                {text.referenceTitle}
              </h3>
              <p className="mt-1 text-[13px] leading-5 text-zinc-500">
                {text.referenceDescription}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4 h-8 rounded-md text-[12px]">
                <Link to={referencePath}>
                  {text.openReferencePage}
                  <ExternalLinkIcon className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </DeveloperDocsShell>
  );
}
