import { ChevronDownIcon } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePublicAgentExportDoc } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

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
import { getAgentPublicReferencePageText } from "./page.i18n";
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
} from "../shared";

function renderNotes(notes: string[]) {
  if (notes.length === 0) {
    return "—";
  }

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
  if (!mediaEntry) {
    return "";
  }

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

  return `${requestLine} \\
${authLine} \\
  -H "Content-Type: ${contentType}" \\
  -d '${buildOperationRequestExample(document, operation)}'`;
}

function FieldTable({
  rows,
  text,
}: {
  rows: ReturnType<typeof listOpenAPISchemaFieldRows>;
  text: ReturnType<typeof getAgentPublicReferencePageText>;
}) {
  if (rows.length === 0) {
    return (
      <DocsSurface className="px-5 py-5">
        <p className="text-sm leading-6 text-slate-500">{text.noFields}</p>
      </DocsSurface>
    );
  }

  return (
    <DocsSurface className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead className="w-[300px]">{text.fieldColumn}</TableHead>
              <TableHead className="w-[190px]">{text.typeColumn}</TableHead>
              <TableHead className="w-[110px]">{text.requiredColumn}</TableHead>
              <TableHead>{text.detailsColumn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.path}>
                <TableCell className="py-3">
                  <div
                    className="font-mono text-[13px] text-slate-950"
                    style={{ paddingLeft: `${row.level * 18}px` }}
                  >
                    {row.path}
                  </div>
                </TableCell>
                <TableCell className="py-3 font-mono text-[12px] text-slate-600">
                  {row.type}
                </TableCell>
                <TableCell className="py-3 text-sm text-slate-600">
                  {row.required ? text.requiredYes : text.requiredNo}
                </TableCell>
                <TableCell className="py-3 text-sm text-slate-600">
                  <div className="space-y-1">
                    {row.description ? <p>{row.description}</p> : null}
                    <p className="text-[12px] text-slate-500">
                      {renderNotes(row.notes)}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DocsSurface>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
          {contentType}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] text-slate-600">
          {schemaType}
        </span>
      </div>

      {meta.length > 0 ? (
        <p className="text-sm leading-6 text-slate-500">{renderNotes(meta)}</p>
      ) : null}

      <FieldTable rows={fieldRows} text={text} />
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
    entry.description ||
    (resolveSchema(document, entry.schema) ?? entry.schema).description ||
    "";

  return (
    <Collapsible className="rounded-xl border border-slate-200 bg-white">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-[13px] text-slate-950">
              {entry.name}
            </code>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {schemaType}
            </span>
          </div>
          {description ? (
            <p className="mt-2 text-sm leading-6 [overflow-wrap:anywhere] break-words text-slate-600">
              {description}
            </p>
          ) : null}
          {meta.length > 0 ? (
            <p className="mt-2 text-[12px] leading-5 text-slate-500">
              {renderNotes(meta)}
            </p>
          ) : null}
        </div>
        <ChevronDownIcon className="size-4 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-slate-200 px-5 py-5">
        <FieldTable rows={rows} text={text} />
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
      className="scroll-mt-28 rounded-xl border border-slate-200 bg-white px-6 py-6"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <DocsMethodBadge method={operation.method} />
          <code className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-[12px] text-slate-700">
            {operation.path}
          </code>
        </div>
        <div>
          <h3 className="text-[1.5rem] leading-[1.08] font-semibold tracking-[-0.04em] text-slate-950">
            {operation.title}
          </h3>
          {operation.description ? (
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-slate-600">
              {operation.description}
            </p>
          ) : null}
        </div>
      </div>

      <Tabs defaultValue={firstStatus || "request"} className="space-y-5">
        <TabsList className="grid h-auto w-full max-w-[420px] grid-cols-3 rounded-lg bg-slate-100 p-1">
          <TabsTrigger value="request" className="rounded-full">
            {text.requestTab}
          </TabsTrigger>
          <TabsTrigger value="responses" className="rounded-full">
            {text.responseTab}
          </TabsTrigger>
          <TabsTrigger value="example" className="rounded-full">
            {text.exampleTab}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="space-y-6">
          {operation.parameters.length > 0 ? (
            <div className="space-y-4">
              <DocsSectionHeading
                eyebrow={text.parametersEyebrow}
                title={text.parametersTitle}
              />
              <DocsSurface className="overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="min-w-[780px]">
                    <TableHeader>
                      <TableRow className="bg-slate-50/80">
                        <TableHead className="w-[220px]">
                          {text.fieldColumn}
                        </TableHead>
                        <TableHead className="w-[130px]">
                          {text.locationColumn}
                        </TableHead>
                        <TableHead className="w-[190px]">
                          {text.typeColumn}
                        </TableHead>
                        <TableHead>{text.detailsColumn}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {operation.parameters.map((parameter) => (
                        <TableRow
                          key={`${operation.anchorId}-${parameter.name}`}
                        >
                          <TableCell className="py-3 font-mono text-[13px] text-slate-950">
                            {parameter.name}
                          </TableCell>
                          <TableCell className="py-3 text-sm text-slate-600">
                            {parameter.in}
                          </TableCell>
                          <TableCell className="py-3 font-mono text-[12px] text-slate-600">
                            {formatOpenAPISchemaType(
                              document,
                              parameter.schema,
                            )}
                          </TableCell>
                          <TableCell className="py-3 text-sm text-slate-600">
                            {parameter.description ||
                              renderNotes(
                                getOpenAPISchemaMetaItems(
                                  document,
                                  parameter.schema,
                                ),
                              )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </DocsSurface>
            </div>
          ) : null}

          {requestMediaEntries.map(([contentType, mediaType]) => (
            <div
              key={`${operation.anchorId}-${contentType}`}
              className="space-y-4"
            >
              <DocsSectionHeading
                eyebrow={text.requestEyebrow}
                title={text.requestTitle}
                description={contentType}
              />
              <FieldTable
                rows={listOpenAPISchemaFieldRows(document, mediaType.schema)}
                text={text}
              />
            </div>
          ))}
        </TabsContent>

        <TabsContent value="responses" className="space-y-5">
          <Tabs defaultValue={firstStatus} className="space-y-4">
            <TabsList className="flex h-auto flex-wrap rounded-lg bg-slate-100 p-1">
              {operation.responses.map((response) => (
                <TabsTrigger
                  key={`${operation.anchorId}-${response.status}`}
                  value={response.status}
                  className="rounded-full"
                >
                  {response.status}
                </TabsTrigger>
              ))}
            </TabsList>

            {operation.responses.map((response) => (
              <TabsContent
                key={`${operation.anchorId}-${response.status}-panel`}
                value={response.status}
                className="space-y-4"
              >
                <p className="text-sm leading-6 text-slate-600">
                  {response.response.description || text.responseTab}
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

        <TabsContent value="example" className="space-y-4">
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
    if (typeof window === "undefined") {
      return;
    }

    const targetId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!targetId) {
      return;
    }

    // Contract sections mount after the OpenAPI document resolves, so hash
    // navigation needs one post-render pass to land on the final element.
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
      <div className="space-y-12 pt-2">
        <section id="reference" className="scroll-mt-28 space-y-8">
          <PublicDocsPageHeading
            eyebrow={text.eyebrow}
            title={text.title}
            description={text.description}
          />

          <DocsKeyValueGrid
            items={[
              {
                label: text.summaryBaseURL,
                value: exportDoc.api_base_url,
                mono: true,
              },
              {
                label: text.summaryVersion,
                value: openapiDoc.info?.version || "1.0.0",
              },
              {
                label: text.summarySpec,
                value: openapiDoc.openapi || "OpenAPI",
              },
              {
                label: text.summaryAuth,
                value: "Bearer <user_created_key>",
                mono: true,
              },
            ]}
          />
        </section>

        <section
          id="operations"
          className="scroll-mt-28 space-y-8 border-t border-slate-200 pt-12"
        >
          <DocsSectionHeading
            eyebrow={text.operationsEyebrow}
            title={text.operationsTitle}
            description={text.operationsDescription}
          />

          <div className="space-y-8">
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

        <section
          id="schemas"
          className="scroll-mt-28 space-y-6 border-t border-slate-200 pt-12"
        >
          <DocsSectionHeading
            eyebrow={text.schemasEyebrow}
            title={text.schemasTitle}
            description={text.schemasDescription}
          />

          <div className="space-y-4">
            {schemas.map((schema) => (
              <div
                id={schema.anchorId}
                key={schema.anchorId}
                className="scroll-mt-28"
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
