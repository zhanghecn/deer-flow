import { ChevronDownIcon } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePublicAgentExportDoc } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import {
  type OpenAPIDocument,
  type OpenAPIMediaType,
  type ReferenceOperation,
  type ReferenceSchemaEntry,
  formatOpenAPISchemaType,
  getOpenAPISchemaMetaItems,
  inferOpenAPISampleValue,
  listOpenAPISchemaFieldRows,
  listReferenceOperations,
  listReferenceSchemas,
  resolveSchema,
  usePublicAgentOpenAPIDoc,
} from "../openapi";
import {
  CopyableCodeBlock,
  DeveloperDocsShell,
  DocsMethodBadge,
  PublicDocsPageHeading,
  PublicDocsStatePanel,
  type DeveloperDocsSidebarSection,
} from "../shared";

import { getAgentPublicReferencePageText } from "./page.i18n";

function renderNotes(notes: string[]) {
  if (notes.length === 0) return null;
  return notes.join(" · ");
}

function getPrimaryMediaType(
  operation: ReferenceOperation,
): [string, OpenAPIMediaType] | null {
  const mediaEntries = Object.entries(operation.requestBody?.content ?? {});
  return mediaEntries[0] ?? null;
}

function buildOperationRequestExample(
  document: OpenAPIDocument,
  operation: ReferenceOperation,
) {
  const mediaEntry = getPrimaryMediaType(operation);
  if (!mediaEntry) return "";

  const [contentType, mediaType] = mediaEntry;
  if (contentType === "multipart/form-data") {
    const rows = listOpenAPISchemaFieldRows(document, mediaType.schema);
    return rows
      .filter((row) => row.level === 0)
      .map((row) =>
        row.type.includes("binary")
          ? `${row.path}=@./example.bin`
          : `${row.path}=${String(inferOpenAPISampleValue(document, resolveSchema(document, mediaType.schema)?.properties?.[row.path] ?? null))}`,
      )
      .join("\n");
  }

  const requestExample =
    Object.values(mediaType.examples ?? {})[0]?.value ??
    mediaType.example ??
    inferOpenAPISampleValue(document, mediaType.schema);

  return JSON.stringify(requestExample, null, 2);
}

function buildOperationCurlSnippet(
  document: OpenAPIDocument,
  baseURL: string,
  operation: ReferenceOperation,
) {
  const relativePath = operation.path
    .replace(/^\/v1/, "")
    .replace(/{([^}]+)}/g, "<$1>");
  const requestLine = `curl -X ${operation.method.toUpperCase()} "${baseURL}${relativePath}"`;
  const authLine = '  -H "Authorization: Bearer <user_created_key>"';
  const mediaEntry = getPrimaryMediaType(operation);

  if (!mediaEntry) {
    return `${requestLine} \\\n${authLine}`;
  }

  const [contentType, mediaType] = mediaEntry;
  if (contentType === "multipart/form-data") {
    const rows = listOpenAPISchemaFieldRows(document, mediaType.schema).filter(
      (row) => row.level === 0,
    );
    const formLines = rows.map((row) =>
      row.type.includes("binary")
        ? `  -F "${row.path}=@./example.bin"`
        : `  -F "${row.path}=example"`,
    );
    return [requestLine, authLine, ...formLines].join(" \\\n");
  }

  return `${requestLine} \
${authLine} \
  -H "Content-Type: ${contentType}" \
  -d '${buildOperationRequestExample(document, operation)}'`;
}

/** Flat parameter listing — NewAPI style: name + type inline, description + constraints below */
function ParamList({
  rows,
  text,
}: {
  rows: ReturnType<typeof listOpenAPISchemaFieldRows>;
  text: ReturnType<typeof getAgentPublicReferencePageText>;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-3 text-[13px] text-zinc-400">{text.noFields}</p>
    );
  }

  return (
    <div className="divide-y divide-zinc-100">
      {rows.map((row) => (
        <div
          key={row.path}
          className="py-3"
          style={{ paddingLeft: `${row.level * 20}px` }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <code className="font-mono text-[13px] font-medium text-zinc-900">
              {row.path}
            </code>
            {row.required ? (
              <span className="text-blue-500">*</span>
            ) : (
              <span className="text-zinc-300">?</span>
            )}
            <span className="font-mono text-[12px] text-zinc-400">
              {row.type}
            </span>
          </div>
          {row.description ? (
            <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
              {row.description}
            </p>
          ) : null}
          {row.notes.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {row.notes.map((note, i) => (
                <span
                  key={i}
                  className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-500"
                >
                  {note}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Flat parameter listing for URL/query parameters */
function ParamFlatList({
  parameters,
  document,
}: {
  parameters: ReferenceOperation["parameters"];
  document: OpenAPIDocument;
}) {
  if (parameters.length === 0) return null;

  return (
    <div className="divide-y divide-zinc-100">
      {parameters.map((param) => {
        const meta = getOpenAPISchemaMetaItems(document, param.schema);
        return (
          <div key={param.name} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <code className="font-mono text-[13px] font-medium text-zinc-900">
                {param.name}
              </code>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {param.in}
              </span>
              <span className="font-mono text-[12px] text-zinc-400">
                {formatOpenAPISchemaType(document, param.schema)}
              </span>
            </div>
            {param.description ? (
              <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
                {param.description}
              </p>
            ) : meta.length > 0 ? (
              <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
                {meta.join(" · ")}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ResponsePanel({
  document,
  mediaType,
  contentType,
  text,
}: {
  document: OpenAPIDocument;
  mediaType: OpenAPIMediaType;
  contentType: string;
  text: ReturnType<typeof getAgentPublicReferencePageText>;
}) {
  const fieldRows = listOpenAPISchemaFieldRows(document, mediaType.schema);
  const schemaType = formatOpenAPISchemaType(document, mediaType.schema);
  const meta = getOpenAPISchemaMetaItems(document, mediaType.schema);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10.5px] font-medium text-zinc-600">
          {contentType}
        </span>
        <span className="font-mono text-[11px] text-zinc-400">{schemaType}</span>
      </div>

      {meta.length > 0 ? (
        <p className="text-[13px] leading-5 text-zinc-500">
          {renderNotes(meta)}
        </p>
      ) : null}

      <ParamList rows={fieldRows} text={text} />
    </div>
  );
}

function SchemaDisclosure({
  document,
  entry,
  text,
}: {
  document: OpenAPIDocument;
  entry: ReferenceSchemaEntry;
  text: ReturnType<typeof getAgentPublicReferencePageText>;
}) {
  const rows = listOpenAPISchemaFieldRows(document, entry.schema);
  const schemaType = formatOpenAPISchemaType(document, entry.schema);
  const meta = getOpenAPISchemaMetaItems(document, entry.schema);
  const description =
    entry.description ??
    (resolveSchema(document, entry.schema) ?? entry.schema).description ??
    "";

  return (
    <Collapsible className="rounded-lg border border-zinc-200 bg-white">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-[13px] font-medium text-zinc-900">{entry.name}</code>
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10.5px] font-medium text-zinc-500">
              {schemaType}
            </span>
          </div>
          {description ? (
            <p className="mt-1 text-[13px] leading-5 text-zinc-500 [overflow-wrap:anywhere] break-words">
              {description}
            </p>
          ) : null}
          {meta.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {meta.map((m, i) => (
                <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {m}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <ChevronDownIcon className="size-3.5 shrink-0 text-zinc-400 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-zinc-100 px-5 py-4">
        <ParamList rows={rows} text={text} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function OperationSection({
  document,
  operation,
  baseURL,
  text,
}: {
  document: OpenAPIDocument;
  operation: ReferenceOperation;
  baseURL: string;
  text: ReturnType<typeof getAgentPublicReferencePageText>;
}) {
  const requestMediaEntries = Object.entries(
    operation.requestBody?.content ?? {},
  );
  const firstStatus = operation.responses[0]?.status ?? "";

  return (
    <article
      id={operation.anchorId}
      className="scroll-mt-20 space-y-5"
    >
      {/* Endpoint hero: method + path */}
      <div className="flex items-center gap-2.5">
        <DocsMethodBadge method={operation.method} />
        <code className="rounded-md bg-zinc-50 px-3 py-1.5 font-mono text-[13px] text-zinc-800">
          {operation.path}
        </code>
      </div>

      <div>
        <h3 className="text-[16px] font-semibold tracking-tight text-zinc-900">
          {operation.title}
        </h3>
        {operation.description ? (
          <p className="mt-1 max-w-[720px] text-[13.5px] leading-5 text-zinc-500">
            {operation.description}
          </p>
        ) : null}
      </div>

      {/* Tabs: Request / Response / Example */}
      <Tabs defaultValue={firstStatus || "request"} className="space-y-4">
        <TabsList className="h-9 rounded-md border border-zinc-200 bg-transparent p-0.5">
          <TabsTrigger
            value="request"
            className="rounded-md px-4 text-[12px] data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
          >
            {text.requestTab}
          </TabsTrigger>
          <TabsTrigger
            value="responses"
            className="rounded-md px-4 text-[12px] data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
          >
            {text.responseTab}
          </TabsTrigger>
          <TabsTrigger
            value="example"
            className="rounded-md px-4 text-[12px] data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
          >
            {text.exampleTab}
          </TabsTrigger>
        </TabsList>

        {/* Request tab */}
        <TabsContent value="request" className="space-y-5">
          {operation.parameters.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-[12px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">
                {text.parametersTitle}
              </h4>
              <ParamFlatList
                parameters={operation.parameters}
                document={document}
              />
            </div>
          ) : null}

          {requestMediaEntries.map(([contentType, mediaType]) => (
            <div
              key={`${operation.anchorId}-${contentType}`}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <h4 className="text-[12px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">
                  {text.requestTitle}
                </h4>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {contentType}
                </span>
              </div>
              <ParamList
                rows={listOpenAPISchemaFieldRows(document, mediaType.schema)}
                text={text}
              />
            </div>
          ))}
        </TabsContent>

        {/* Responses tab */}
        <TabsContent value="responses" className="space-y-4">
          <Tabs defaultValue={firstStatus} className="space-y-3">
            <TabsList className="flex h-8 flex-wrap rounded-md border border-zinc-200 bg-transparent p-0.5">
              {operation.responses.map((response) => (
                <TabsTrigger
                  key={`${operation.anchorId}-${response.status}`}
                  value={response.status}
                  className="rounded-md px-3 text-[12px] data-[state=active]:bg-zinc-900 data-[state=active]:text-white"
                >
                  {response.status}
                </TabsTrigger>
              ))}
            </TabsList>

            {operation.responses.map((response) => (
              <TabsContent
                key={`${operation.anchorId}-${response.status}-panel`}
                value={response.status}
                className="space-y-3"
              >
                <p className="text-[13px] leading-5 text-zinc-500">
                  {response.response.description ?? text.responseTab}
                </p>
                {Object.entries(response.response.content ?? {}).map(
                  ([contentType, mediaType]) => (
                    <ResponsePanel
                      key={`${operation.anchorId}-${response.status}-${contentType}`}
                      document={document}
                      mediaType={mediaType}
                      contentType={contentType}
                      text={text}
                    />
                  ),
                )}
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        {/* Example tab */}
        <TabsContent value="example" className="space-y-3">
          <CopyableCodeBlock
            title="cURL"
            code={buildOperationCurlSnippet(document, baseURL, operation)}
            copyLabel={text.copy}
            copiedLabel={text.copied}
          />
          {requestMediaEntries.length > 0 ? (
            <CopyableCodeBlock
              title={text.requestExampleTitle}
              code={buildOperationRequestExample(document, operation)}
              copyLabel={text.copy}
              copiedLabel={text.copied}
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </article>
  );
}

export default function AgentPublicReferencePage() {
  const { locale } = useI18n();
  const text = getAgentPublicReferencePageText(locale);
  const { agent_name } = useParams<{ agent_name: string }>();
  const { exportDoc, isLoading, error } = usePublicAgentExportDoc(agent_name);
  const {
    openapiDoc,
    openapiURL,
    isLoading: isOpenAPILoading,
    error: openapiError,
  } = usePublicAgentOpenAPIDoc(exportDoc);

  const operations = openapiDoc ? listReferenceOperations(openapiDoc) : [];
  const schemas = openapiDoc ? listReferenceSchemas(openapiDoc) : [];

  useEffect(() => {
    if (typeof window === "undefined") return;

    const targetId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!targetId) return;

    const frameID = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(frameID);
    };
  }, [operations.length, schemas.length]);

  if (isLoading || (exportDoc && isOpenAPILoading)) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.eyebrow}
        title={text.loadingTitle}
        description={text.loadingDescription}
      />
    );
  }

  if (!exportDoc || error) {
    return (
      <PublicDocsStatePanel
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

  if (!openapiDoc || openapiError) {
    return (
      <PublicDocsStatePanel
        eyebrow={text.eyebrow}
        title={text.loadFailedTitle}
        description={
          openapiError instanceof Error
            ? openapiError.message
            : text.loadFailedDescription
        }
        actionLabel={text.openHome}
        actionHref="/"
      />
    );
  }

  const sidebarSections: DeveloperDocsSidebarSection[] = [
    {
      title: text.operationsEyebrow,
      items: operations.map((operation) => ({
        label: operation.path.replace(/^\/v1/, "") || "/",
        href: `#${operation.anchorId}`,
        badge: operation.method.toUpperCase(),
      })),
    },
    {
      title: text.schemasEyebrow,
      items: schemas.map((schema) => ({
        label: schema.name,
        href: `#${schema.anchorId}`,
      })),
    },
  ];

  return (
    <DeveloperDocsShell
      activeTab="reference"
      agentName={exportDoc.agent}
      openapiURL={openapiURL}
      exportURL={exportDoc.documentation_json_url}
      sidebarSections={sidebarSections}
    >
      <div className="space-y-8">
        {/* Page heading */}
        <section id="reference" className="scroll-mt-20 space-y-4">
          <PublicDocsPageHeading
            eyebrow={text.eyebrow}
            title={text.title}
            description={text.description}
          />

          <div className="grid gap-0 divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                {text.summaryBaseURL}
              </p>
              <p className="mt-1 font-mono text-[12px] text-zinc-800">
                {exportDoc.api_base_url}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                {text.summaryAuth}
              </p>
              <p className="mt-1 font-mono text-[12px] text-zinc-800">
                Bearer &lt;user_created_key&gt;
              </p>
            </div>
          </div>
        </section>

        {/* Operations */}
        <section
          id="operations"
          className="scroll-mt-20 space-y-6 border-t border-zinc-100 pt-8"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              {text.operationsEyebrow}
            </p>
            <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-zinc-900">
              {text.operationsTitle}
            </h2>
          </div>

          <div className="space-y-8 divide-y divide-zinc-100">
            {operations.map((operation) => (
              <OperationSection
                key={operation.anchorId}
                document={openapiDoc}
                operation={operation}
                baseURL={exportDoc.api_base_url}
                text={text}
              />
            ))}
          </div>
        </section>

        {/* Schemas */}
        <section
          id="schemas"
          className="scroll-mt-20 space-y-4 border-t border-zinc-100 pt-8"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">
              {text.schemasEyebrow}
            </p>
            <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-zinc-900">
              {text.schemasTitle}
            </h2>
          </div>

          <div className="space-y-3">
            {schemas.map((schema) => (
              <div
                id={schema.anchorId}
                key={schema.anchorId}
                className="scroll-mt-20"
              >
                <SchemaDisclosure
                  document={openapiDoc}
                  entry={schema}
                  text={text}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </DeveloperDocsShell>
  );
}
