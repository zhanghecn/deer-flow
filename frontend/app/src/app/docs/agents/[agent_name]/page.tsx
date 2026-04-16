import { ExternalLinkIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildPublicAgentPlaygroundPath,
  buildPublicAgentReferencePath,
  buildPublicAgentSupportPath,
  usePublicAgentExportDoc,
} from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { listReferenceOperations, usePublicAgentOpenAPIDoc } from "./openapi";
import { getAgentPublicDocsPageText } from "./page.i18n";
import {
  CopyableCodeBlock,
  DeveloperDocsShell,
  type DeveloperDocsSidebarSection,
  DocsKeyValueGrid,
  DocsMethodBadge,
  DocsSectionHeading,
  DocsSurface,
  PublicDocsPageHeading,
  PublicDocsStatePanel,
} from "./shared";

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

function RouteTable({
  routes,
  referencePath,
  openReferenceLabel,
  methodColumn,
  pathColumn,
  summaryColumn,
  docsColumn,
}: {
  routes: ReturnType<typeof listReferenceOperations>;
  referencePath: string;
  openReferenceLabel: string;
  methodColumn: string;
  pathColumn: string;
  summaryColumn: string;
  docsColumn: string;
}) {
  return (
    <DocsSurface className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[820px]">
          <TableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead className="w-[110px]">{methodColumn}</TableHead>
              <TableHead>{pathColumn}</TableHead>
              <TableHead className="w-[300px]">{summaryColumn}</TableHead>
              <TableHead className="w-[140px] text-right">
                {docsColumn}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route) => (
              <TableRow key={route.anchorId}>
                <TableCell>
                  <DocsMethodBadge method={route.method} />
                </TableCell>
                <TableCell className="font-mono text-[13px] [overflow-wrap:anywhere] text-slate-950">
                  {route.path}
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {route.title}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" className="rounded-md">
                    <Link to={`${referencePath}#${route.anchorId}`}>
                      {openReferenceLabel}
                      <ExternalLinkIcon className="size-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DocsSurface>
  );
}

function NextStepRow({
  eyebrow,
  title,
  description,
  href,
  actionLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <div className="grid gap-4 border-t border-slate-200 px-5 py-5 first:border-t-0 lg:grid-cols-[124px_minmax(0,1fr)_156px] lg:items-center">
      <p className="text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
        {eyebrow}
      </p>
      <div>
        <h3 className="text-[1rem] font-semibold tracking-[-0.03em] text-slate-950">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      <div className="lg:flex lg:justify-end">
        <Button asChild variant="outline" className="rounded-md">
          <Link to={href}>
            {actionLabel}
            <ExternalLinkIcon className="size-4" />
          </Link>
        </Button>
      </div>
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
  const supportPath = buildPublicAgentSupportPath(exportDoc.agent);
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
      <div className="space-y-10 pt-2">
        <section id="overview" className="scroll-mt-28 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <DocsMethodBadge method="POST" />
            <code className="rounded-md border border-slate-200 bg-white px-3 py-1 font-mono text-[12px] text-slate-700">
              /v1/responses
            </code>
            <code className="rounded-md border border-slate-200 bg-white px-3 py-1 font-mono text-[12px] text-slate-700">
              {`model=${exportDoc.agent}`}
            </code>
          </div>

          <PublicDocsPageHeading
            eyebrow={text.heroEyebrow}
            title={text.heroTitle}
            description={text.heroDescription}
          />

          <DocsKeyValueGrid
            items={[
              {
                label: text.baseURL,
                value: exportDoc.api_base_url,
                mono: true,
                description: text.baseURLNote,
              },
              {
                label: text.modelName,
                value: exportDoc.agent,
                mono: true,
              },
              {
                label: text.apiKeyLabel,
                value: text.apiKeyExample,
                mono: true,
              },
              {
                label: text.modesLabel,
                value: text.modesValue,
              },
            ]}
          />

          <DocsSurface className="overflow-hidden">
            <div className="grid gap-0 divide-y divide-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
              <div>
                <p className="px-6 pt-6 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.heroFactOneLabel}
                </p>
                <p className="px-6 pt-2 pb-6 text-sm leading-6 text-slate-700">
                  {text.heroFactOneValue}
                </p>
              </div>
              <div>
                <p className="px-6 pt-6 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.heroFactTwoLabel}
                </p>
                <p className="px-6 pt-2 pb-6 text-sm leading-6 text-slate-700">
                  {text.heroFactTwoValue}
                </p>
              </div>
              <div>
                <p className="px-6 pt-6 text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                  {text.heroFactThreeLabel}
                </p>
                <p className="px-6 pt-2 pb-6 text-sm leading-6 text-slate-700">
                  {routes.length} {text.heroFactThreeValue}
                </p>
              </div>
            </div>
          </DocsSurface>
        </section>

        <section
          id="quickstart"
          className="scroll-mt-28 space-y-5 border-t border-slate-200 pt-10"
        >
          <DocsSectionHeading
            eyebrow={text.quickstartEyebrow}
            title={text.quickstartTitle}
            description={text.quickstartDescription}
          />

          <Tabs defaultValue="javascript" className="space-y-4">
            <TabsList className="grid h-auto w-full max-w-[420px] grid-cols-3 rounded-md bg-slate-100 p-1">
              <TabsTrigger value="javascript" className="rounded-md">
                {text.jsTab}
              </TabsTrigger>
              <TabsTrigger value="python" className="rounded-md">
                {text.pythonTab}
              </TabsTrigger>
              <TabsTrigger value="curl" className="rounded-md">
                {text.curlTab}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="javascript">
              <CopyableCodeBlock
                title="JavaScript"
                code={javascriptSnippet}
                copyLabel={text.copy}
                copiedLabel={text.copied}
              />
            </TabsContent>
            <TabsContent value="python">
              <CopyableCodeBlock
                title="Python"
                code={pythonSnippet}
                copyLabel={text.copy}
                copiedLabel={text.copied}
              />
            </TabsContent>
            <TabsContent value="curl">
              <CopyableCodeBlock
                title="cURL"
                code={curlSnippet}
                copyLabel={text.copy}
                copiedLabel={text.copied}
              />
            </TabsContent>
          </Tabs>
        </section>

        <section
          id="authentication"
          className="scroll-mt-28 space-y-5 border-t border-slate-200 pt-10"
        >
          <DocsSectionHeading
            eyebrow={text.authEyebrow}
            title={text.authTitle}
            description={text.authDescription}
          />

          <DocsKeyValueGrid
            columns={3}
            items={[
              {
                label: text.authHeaderLabel,
                value: "Authorization",
              },
              {
                label: text.authValueLabel,
                value: "Bearer <user_created_key>",
                mono: true,
              },
              {
                label: text.authScopeLabel,
                value: text.authScopeValue,
              },
            ]}
          />
        </section>

        <section
          id="routes"
          className="scroll-mt-28 space-y-5 border-t border-slate-200 pt-10"
        >
          <DocsSectionHeading
            eyebrow={text.routesEyebrow}
            title={text.routesTitle}
            description={text.routesDescription}
          />

          <RouteTable
            routes={routes}
            referencePath={referencePath}
            openReferenceLabel={text.openReference}
            methodColumn={text.routeMethodColumn}
            pathColumn={text.routePathColumn}
            summaryColumn={text.routeSummaryColumn}
            docsColumn={text.routeDocsColumn}
          />
        </section>

        <section
          id="next-steps"
          className="scroll-mt-28 space-y-5 border-t border-slate-200 pt-10"
        >
          <DocsSectionHeading
            eyebrow={text.nextEyebrow}
            title={text.nextTitle}
            description={text.nextDescription}
          />

          <DocsSurface className="overflow-hidden">
            <NextStepRow
              eyebrow={text.supportEyebrow}
              title={text.supportTitle}
              description={text.supportDescription}
              href={supportPath}
              actionLabel={text.openSupport}
            />
            <NextStepRow
              eyebrow={text.playgroundEyebrow}
              title={text.playgroundTitle}
              description={text.playgroundDescription}
              href={playgroundPath}
              actionLabel={text.openPlayground}
            />
            <NextStepRow
              eyebrow={text.referenceEyebrow}
              title={text.referenceTitle}
              description={text.referenceDescription}
              href={referencePath}
              actionLabel={text.openReferencePage}
            />
          </DocsSurface>
        </section>
      </div>
    </DeveloperDocsShell>
  );
}
