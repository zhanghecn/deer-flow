import { useQuery } from "@tanstack/react-query";

import type { AgentExportDoc } from "@/core/agents";

export type OpenAPIHttpMethod =
  | "delete"
  | "get"
  | "head"
  | "options"
  | "patch"
  | "post"
  | "put";

type OpenAPIReferenceObject = {
  $ref?: string;
};

export interface OpenAPISchema extends OpenAPIReferenceObject {
  type?: string;
  format?: string;
  description?: string;
  nullable?: boolean;
  enum?: unknown[];
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  additionalProperties?: boolean | OpenAPISchema;
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  default?: unknown;
  example?: unknown;
}

export interface OpenAPIExample {
  summary?: string;
  value?: unknown;
}

export interface OpenAPIMediaType {
  schema?: OpenAPISchema;
  example?: unknown;
  examples?: Record<string, OpenAPIExample>;
}

export interface OpenAPIRequestBody {
  required?: boolean;
  content?: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIParameter {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  schema?: OpenAPISchema;
}

export interface OpenAPIResponseObject extends OpenAPIReferenceObject {
  description?: string;
  content?: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses?: Record<string, OpenAPIResponseObject>;
}

export interface OpenAPIDocument {
  openapi?: string;
  info?: {
    title?: string;
    description?: string;
    version?: string;
  };
  paths?: Record<string, Partial<Record<OpenAPIHttpMethod, OpenAPIOperation>>>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
    responses?: Record<string, OpenAPIResponseObject>;
  };
}

export interface ReferenceOperation {
  anchorId: string;
  method: OpenAPIHttpMethod;
  path: string;
  title: string;
  description: string;
  tag: string;
  operationId: string;
  parameters: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Array<{
    status: string;
    response: OpenAPIResponseObject;
  }>;
}

export interface ReferenceSchemaEntry {
  anchorId: string;
  name: string;
  schema: OpenAPISchema;
  description: string;
}

export interface OpenAPISchemaFieldRow {
  path: string;
  level: number;
  type: string;
  required: boolean;
  description: string;
  notes: string[];
}

const OPENAPI_HTTP_METHODS: OpenAPIHttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
];

export function resolvePublicAgentOpenAPIURL(exportDoc: AgentExportDoc) {
  return (
    exportDoc.openapi_url ??
    `/open/agents/${encodeURIComponent(exportDoc.agent)}/openapi.json`
  );
}

export function normalizePublicOperationPath(path: string) {
  return path.startsWith("/v1") ? path : `/v1${path}`;
}

function slugifySegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildOperationAnchorId(method: string, path: string) {
  const pathSlug = path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map(slugifySegment)
    .join("-");
  return `operation-${slugifySegment(method)}-${pathSlug || "root"}`;
}

export function buildSchemaAnchorId(name: string) {
  return `schema-${slugifySegment(name)}`;
}

export function schemaRefName(schema: OpenAPISchema | null | undefined) {
  if (!schema?.$ref) {
    return "";
  }
  return schema.$ref.split("/").pop() ?? "";
}

export function resolveSchema(
  document: OpenAPIDocument,
  schema: OpenAPISchema | null | undefined,
): OpenAPISchema | null {
  if (!schema) {
    return null;
  }

  const referenceName = schemaRefName(schema);
  if (!referenceName) {
    return schema;
  }

  return document.components?.schemas?.[referenceName] ?? null;
}

export function resolveResponse(
  document: OpenAPIDocument,
  response: OpenAPIResponseObject | null | undefined,
): OpenAPIResponseObject | null {
  if (!response) {
    return null;
  }

  const referenceName = response.$ref?.split("/").pop();
  if (!referenceName) {
    return response;
  }

  return document.components?.responses?.[referenceName] ?? null;
}

function formatInlineSchemaValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatOpenAPISchemaType(
  document: OpenAPIDocument,
  schema: OpenAPISchema | null | undefined,
): string {
  if (!schema) {
    return "unknown";
  }

  const referenceName = schemaRefName(schema);
  if (referenceName) {
    return referenceName;
  }

  const resolved = resolveSchema(document, schema) ?? schema;

  if (resolved.oneOf?.length) {
    return resolved.oneOf
      .map((item) => formatOpenAPISchemaType(document, item))
      .join(" | ");
  }
  if (resolved.anyOf?.length) {
    return resolved.anyOf
      .map((item) => formatOpenAPISchemaType(document, item))
      .join(" | ");
  }
  if (resolved.allOf?.length) {
    return resolved.allOf
      .map((item) => formatOpenAPISchemaType(document, item))
      .join(" & ");
  }
  if (resolved.type === "array") {
    return `array<${formatOpenAPISchemaType(document, resolved.items)}>`;
  }
  if (resolved.type === "object" && resolved.additionalProperties) {
    if (resolved.additionalProperties === true) {
      return "object";
    }
    return `map<string, ${formatOpenAPISchemaType(document, resolved.additionalProperties)}>`;
  }
  if (resolved.type) {
    return resolved.format ? `${resolved.type} (${resolved.format})` : resolved.type;
  }
  if (resolved.properties) {
    return "object";
  }

  return "unknown";
}

export function getOpenAPISchemaMetaItems(
  document: OpenAPIDocument,
  schema: OpenAPISchema | null | undefined,
): string[] {
  if (!schema) {
    return [];
  }

  const resolved = resolveSchema(document, schema) ?? schema;
  const items: string[] = [];

  if (resolved.enum?.length) {
    items.push(
      `enum: ${resolved.enum.map((value) => formatInlineSchemaValue(value)).join(", ")}`,
    );
  }
  if (resolved.default !== undefined) {
    items.push(`default: ${formatInlineSchemaValue(resolved.default)}`);
  }
  if (resolved.example !== undefined) {
    items.push(`example: ${formatInlineSchemaValue(resolved.example)}`);
  }
  if (resolved.nullable) {
    items.push("nullable");
  }
  if (resolved.additionalProperties === true) {
    items.push("additional properties allowed");
  }

  return items;
}

export function inferOpenAPISampleValue(
  document: OpenAPIDocument,
  schema: OpenAPISchema | null | undefined,
): unknown {
  if (!schema) {
    return {};
  }

  const resolved = resolveSchema(document, schema) ?? schema;

  if (resolved.example !== undefined) {
    return resolved.example;
  }
  if (resolved.default !== undefined) {
    return resolved.default;
  }
  if (resolved.enum?.length) {
    return resolved.enum[0];
  }
  if (resolved.oneOf?.length) {
    return inferOpenAPISampleValue(document, resolved.oneOf[0]);
  }
  if (resolved.anyOf?.length) {
    return inferOpenAPISampleValue(document, resolved.anyOf[0]);
  }
  if (resolved.allOf?.length) {
    return Object.assign(
      {},
      ...resolved.allOf.map((item) => inferOpenAPISampleValue(document, item)),
    );
  }
  if (resolved.type === "array") {
    return resolved.items
      ? [inferOpenAPISampleValue(document, resolved.items)]
      : [];
  }
  if (resolved.type === "object" || resolved.properties) {
    const result: Record<string, unknown> = {};
    for (const [name, propertySchema] of Object.entries(
      resolved.properties ?? {},
    )) {
      result[name] = inferOpenAPISampleValue(document, propertySchema);
    }
    return result;
  }
  if (resolved.type === "integer" || resolved.type === "number") {
    return 0;
  }
  if (resolved.type === "boolean") {
    return false;
  }
  if (resolved.format === "binary") {
    return "<binary>";
  }

  return "string";
}

export function listOpenAPISchemaFieldRows(
  document: OpenAPIDocument,
  schema: OpenAPISchema | null | undefined,
): OpenAPISchemaFieldRow[] {
  if (!schema) {
    return [];
  }

  const rows: OpenAPISchemaFieldRow[] = [];

  function walk(
    currentSchema: OpenAPISchema,
    prefix: string,
    level: number,
    requiredNames: Set<string>,
    seenRefs: Set<string>,
  ) {
    const referenceName = schemaRefName(currentSchema);
    // Recursive component schemas can point back to themselves. Track the
    // reference chain explicitly so the docs renderer terminates cleanly.
    if (referenceName && seenRefs.has(referenceName)) {
      return;
    }

    const resolved = resolveSchema(document, currentSchema) ?? currentSchema;
    const nextSeenRefs = new Set(seenRefs);
    if (referenceName) {
      nextSeenRefs.add(referenceName);
    }

    for (const [name, propertySchema] of Object.entries(
      resolved.properties ?? {},
    )) {
      const propertyPath = prefix ? `${prefix}.${name}` : name;
      const resolvedPropertySchema =
        resolveSchema(document, propertySchema) ?? propertySchema;

      rows.push({
        path: propertyPath,
        level,
        type: formatOpenAPISchemaType(document, propertySchema),
        required: requiredNames.has(name),
        description: resolvedPropertySchema.description?.trim() ?? "",
        notes: getOpenAPISchemaMetaItems(document, propertySchema),
      });

      const nestedRequired = new Set(resolvedPropertySchema.required ?? []);

      if (
        resolvedPropertySchema.properties &&
        Object.keys(resolvedPropertySchema.properties).length > 0
      ) {
        walk(propertySchema, propertyPath, level + 1, nestedRequired, nextSeenRefs);
        continue;
      }

      if (
        resolvedPropertySchema.type === "array" &&
        resolvedPropertySchema.items
      ) {
        const itemSchema =
          resolveSchema(document, resolvedPropertySchema.items) ??
          resolvedPropertySchema.items;
        if (itemSchema.properties && Object.keys(itemSchema.properties).length > 0) {
          walk(
            resolvedPropertySchema.items,
            `${propertyPath}[]`,
            level + 1,
            new Set(itemSchema.required ?? []),
            nextSeenRefs,
          );
        }
      }
    }
  }

  const requiredRootFields = new Set(
    (resolveSchema(document, schema) ?? schema).required ?? [],
  );

  walk(schema, "", 0, requiredRootFields, new Set());
  return rows;
}

function normalizeOperationTitle(
  method: OpenAPIHttpMethod,
  path: string,
  operation: OpenAPIOperation,
) {
  const summary = operation.summary?.trim();
  if (summary) {
    return summary;
  }
  return `${method.toUpperCase()} ${normalizePublicOperationPath(path)}`;
}

export function listReferenceOperations(
  document: OpenAPIDocument,
): ReferenceOperation[] {
  const operations: ReferenceOperation[] = [];

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of OPENAPI_HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      const description = operation.description?.trim() ?? "";
      const tag = operation.tags?.[0]?.trim() || "Published Agents";
      const resolvedResponses = Object.entries(operation.responses ?? {})
        .map(([status, response]) => {
          const resolved = resolveResponse(document, response);
          return resolved ? { status, response: resolved } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      operations.push({
        anchorId: buildOperationAnchorId(method, path),
        method,
        path: normalizePublicOperationPath(path),
        title: normalizeOperationTitle(method, path, operation),
        description,
        tag,
        operationId: operation.operationId?.trim() || `${method}:${path}`,
        parameters: operation.parameters ?? [],
        requestBody: operation.requestBody,
        responses: resolvedResponses,
      });
    }
  }

  return operations;
}

export function listReferenceSchemas(
  document: OpenAPIDocument,
): ReferenceSchemaEntry[] {
  return Object.entries(document.components?.schemas ?? {})
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, schema]) => ({
      anchorId: buildSchemaAnchorId(name),
      name,
      schema,
      description: schema.description?.trim() ?? "",
    }));
}

export function usePublicAgentOpenAPIDoc(exportDoc: AgentExportDoc | null) {
  const openapiURL = exportDoc ? resolvePublicAgentOpenAPIURL(exportDoc) : null;
  const { data, isLoading, error } = useQuery<OpenAPIDocument>({
    queryKey: ["public-agents", exportDoc?.agent, "openapi", openapiURL],
    enabled: Boolean(openapiURL),
    queryFn: async () => {
      if (!openapiURL) {
        throw new Error("Missing OpenAPI URL");
      }

      // The public docs now treat the published OpenAPI document as the single
      // source of truth, instead of layering UI-specific fallbacks on top.
      const response = await fetch(openapiURL);
      if (!response.ok) {
        throw new Error(`Failed to load OpenAPI document: ${response.status}`);
      }
      return (await response.json()) as OpenAPIDocument;
    },
  });

  return {
    openapiDoc: data ?? null,
    openapiURL,
    isLoading,
    error,
  };
}
