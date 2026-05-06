import { t } from "@/i18n";

export type SelectedField = {
  path: string;
  value: unknown;
};

const LEGACY_PREVIEW_KEYS = new Set(["preview", "truncated"]);
const LEGACY_RAW_KEYS = new Set(["raw"]);

const PRIORITY_KEYS = [
  "content",
  "markdown",
  "text",
  "message",
  "output",
  "response",
  "body",
  "final",
  "description",
];

const MARKDOWN_KEYS = [
  "markdown",
  "text",
  "content",
  "message",
  "output",
  "response",
  "body",
  "final",
  "description",
];

const VIRTUAL_PATH_PATTERN = /\/mnt\/user-data\/[^\s'",)]+/g;
const NON_VISIBLE_CONTENT_TYPES = new Set(["thinking", "reasoning"]);

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isScalar(value: unknown): boolean {
  return (
    value == null || ["string", "number", "boolean"].includes(typeof value)
  );
}

export function isMessageLike(
  value: unknown,
): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return "role" in value || "content" in value || "tool_calls" in value;
}

export function isToolLike(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return "name" in value || "arguments" in value || "parameters" in value;
}

export function allItemsMatch(
  value: unknown,
  predicate: (item: unknown) => boolean,
): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(predicate);
}

export function buildFieldPath(parent: string, label: string): string {
  if (parent === "$") {
    return label;
  }
  if (label.startsWith("[")) {
    return `${parent}${label}`;
  }
  return `${parent}.${label}`;
}

export function describeType(value: unknown): string {
  if (Array.isArray(value)) {
    return t("array({count})", { count: value.length });
  }
  if (isObject(value)) {
    return t("object({count})", { count: Object.keys(value).length });
  }
  if (value === null) return t("null");
  return t(typeof value);
}

export function toRawText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toSingleLine(value: unknown, max = 120): string {
  const text = toPreviewText(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export function hasTruncationMarker(value: string): boolean {
  return value.includes("...[truncated");
}

export function parseJsonString(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeCapturedText(value: string): string {
  return decodeEscapedUnicode(
    value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .trim(),
  );
}

function decodeEscapedUnicode(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function readQuotedAssignmentValue(
  text: string,
  startIndex: number,
): { value: string; endIndex: number } | null {
  const quote = text[startIndex];
  if (quote !== "'" && quote !== '"') {
    return null;
  }

  let rawValue = "";
  let escaped = false;

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      rawValue += `\\${char}`;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === quote) {
      return {
        value: normalizeCapturedText(rawValue),
        endIndex: index + 1,
      };
    }

    rawValue += char;
  }

  if (escaped) {
    rawValue += "\\";
  }

  return null;
}

function collectQuotedAssignmentValues(text: string, key: string): string[] {
  const pattern = new RegExp(
    `(?:['"]${key}['"]|\\b${key}\\b)\\s*(?::|=)\\s*`,
    "g",
  );
  const values: string[] = [];

  for (const match of text.matchAll(pattern)) {
    const matchedText = match[0];
    if (!matchedText) {
      continue;
    }

    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) {
      continue;
    }

    const parsedValue = readQuotedAssignmentValue(
      text,
      matchIndex + matchedText.length,
    );
    if (!parsedValue || parsedValue.value.length === 0) {
      continue;
    }

    values.push(parsedValue.value);
  }

  return values;
}

export function extractMessageStringText(text: string): string | null {
  const matches = collectQuotedAssignmentValues(text, "text");

  if (matches.length > 0) {
    return matches.join("\n\n");
  }

  const contentMatches = collectQuotedAssignmentValues(text, "content");
  if (contentMatches.length > 0) {
    return contentMatches.join("\n\n");
  }

  return null;
}

function isStandaloneMessageRepr(text: string): boolean {
  const trimmed = text.trim();
  // ToolRuntime reprs can contain nested HumanMessage text, but that text is
  // runtime context rather than the value being inspected in this JSON field.
  if (trimmed.includes("ToolRuntime(")) {
    return false;
  }

  return (
    /^(HumanMessage|AIMessage|SystemMessage|ToolMessage|ChatMessage|BaseMessage)\(/.test(
      trimmed,
    ) ||
    (/^\{/.test(trimmed) &&
      /(['"](?:role|type)['"]\s*:|(?:role|type)\s*=)/.test(trimmed))
  );
}

export function normalizeReadableString(value: string): unknown {
  const parsed = parseJsonString(value);
  if (parsed !== null) {
    return parsed;
  }

  const messageText = isStandaloneMessageRepr(value)
    ? extractMessageStringText(value)
    : null;
  if (messageText) {
    return {
      role: "message",
      content: messageText,
    };
  }

  return decodeEscapedUnicode(value);
}

export function sanitizeVirtualPath(path: string): string {
  const normalized = path.trim();
  if (!normalized.startsWith("/mnt/user-data/")) {
    return path;
  }

  const suffix = normalized.slice("/mnt/user-data/".length);
  if (suffix.startsWith("outputs/")) {
    return `output/${suffix.slice("outputs/".length)}`;
  }
  if (suffix.startsWith("uploads/")) {
    return `upload/${suffix.slice("uploads/".length)}`;
  }
  if (suffix.startsWith("workspace/")) {
    return `workspace/${suffix.slice("workspace/".length)}`;
  }
  if (suffix.startsWith("agents/")) {
    return `agent/${suffix.slice("agents/".length)}`;
  }
  if (suffix.startsWith("authoring/")) {
    return `authoring/${suffix.slice("authoring/".length)}`;
  }
  return `user-data/${suffix}`;
}

export function sanitizeVirtualPathsInText(value: string): string {
  return value.replace(VIRTUAL_PATH_PATTERN, (match) => sanitizeVirtualPath(match));
}

function sanitizeReadableValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 8 || value == null) {
    return value;
  }

  if (typeof value === "string") {
    const sanitized = sanitizeVirtualPathsInText(value);
    return sanitized === value ? value : sanitized;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return t("[circular]");
    }
    seen.add(value);
    let changed = false;
    const nextValue = value.map((item) => {
      const sanitizedItem = sanitizeReadableValue(item, depth + 1, seen);
      if (sanitizedItem !== item) {
        changed = true;
      }
      return sanitizedItem;
    });
    return changed ? nextValue : value;
  }

  if (isObject(value)) {
    if (seen.has(value)) {
      return t("[circular]");
    }
    seen.add(value);
    let changed = false;
    const nextEntries = Object.entries(value).map(([key, item]) => {
      const sanitizedItem = sanitizeReadableValue(item, depth + 1, seen);
      if (sanitizedItem !== item) {
        changed = true;
      }
      return [key, sanitizedItem];
    });
    return changed ? Object.fromEntries(nextEntries) : value;
  }

  return value;
}

function normalizeLegacyLeaf(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return parseJsonString(value) ?? value;
}

export function unwrapLegacyValue(value: unknown): {
  value: unknown;
  truncated: boolean;
} {
  if (!isObject(value)) {
    return { value, truncated: false };
  }

  const keys = Object.keys(value);
  if ("preview" in value && keys.every((key) => LEGACY_PREVIEW_KEYS.has(key))) {
    return {
      value: normalizeLegacyLeaf(value.preview),
      truncated: value.truncated === true,
    };
  }

  if ("raw" in value && keys.every((key) => LEGACY_RAW_KEYS.has(key))) {
    return {
      value: normalizeLegacyLeaf(value.raw),
      truncated: false,
    };
  }

  return { value, truncated: false };
}

export function normalizeReadableValue(value: unknown): unknown {
  const { value: unwrappedValue } = unwrapLegacyValue(value);
  if (typeof unwrappedValue === "string") {
    return sanitizeReadableValue(normalizeReadableString(unwrappedValue));
  }
  return sanitizeReadableValue(unwrappedValue);
}

function toPreviewText(value: unknown): string {
  const normalized = normalizeReadableValue(value);
  const markdownSource = extractMarkdownSource(normalized);
  if (markdownSource) {
    return markdownSource;
  }
  if (typeof normalized === "string") {
    return normalized;
  }
  if (isObject(normalized) && typeof normalized.content === "string") {
    return normalized.content;
  }
  return toRawText(normalized);
}

export function extractMarkdownSource(
  value: unknown,
  depth = 0,
): string | null {
  if (depth > 10 || value == null) return null;

  const normalized = normalizeReadableValue(value);
  if (normalized !== value) {
    return extractMarkdownSource(normalized, depth);
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        const block = isObject(item) ? item : null;
        const blockType =
          typeof block?.type === "string" ? block.type.toLowerCase() : "";
        // Message cards render reasoning in a dedicated panel; the markdown
        // body should stay focused on the visible assistant answer.
        if (NON_VISIBLE_CONTENT_TYPES.has(blockType)) {
          return null;
        }
        return extractMarkdownSource(item, depth + 1);
      })
      .filter((item): item is string => !!item && item.trim().length > 0);
    if (parts.length > 0) {
      return parts.join("\n\n");
    }
    return null;
  }

  if (isObject(value)) {
    const blockType =
      typeof value.type === "string" ? value.type.toLowerCase() : "";
    if (NON_VISIBLE_CONTENT_TYPES.has(blockType)) {
      return null;
    }
    if (value.type === "text" && typeof value.text === "string") {
      return value.text;
    }
    for (const key of MARKDOWN_KEYS) {
      if (!(key in value)) continue;
      const extracted = extractMarkdownSource(value[key], depth + 1);
      if (extracted && extracted.trim().length > 0) {
        return extracted;
      }
    }
    if (typeof value.text === "string") {
      return value.text;
    }
  }

  return null;
}

function scorePath(path: string, value: unknown): number {
  if (typeof value !== "string") return -1;
  const normalized = path.toLowerCase();
  for (let index = 0; index < PRIORITY_KEYS.length; index += 1) {
    if (normalized.endsWith(PRIORITY_KEYS[index])) {
      return 100 - index * 10 + Math.min(value.length, 50) * 0.01;
    }
  }
  return Math.min(value.length, 50) * 0.01;
}

export function findBestField(
  value: unknown,
  path = "$",
  depth = 0,
): SelectedField | null {
  if (depth > 8) return null;

  if (typeof value === "string") {
    return { path, value };
  }

  let best: SelectedField | null = null;
  let bestScore = -1;

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = findBestField(value[index], `${path}[${index}]`, depth + 1);
      if (!child) continue;
      const childScore = scorePath(child.path, child.value);
      if (childScore > bestScore) {
        best = child;
        bestScore = childScore;
      }
    }
    return best;
  }

  if (isObject(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      const childPath = path === "$" ? key : `${path}.${key}`;
      const child = findBestField(childValue, childPath, depth + 1);
      if (!child) continue;
      const childScore = scorePath(child.path, child.value);
      if (childScore > bestScore) {
        best = child;
        bestScore = childScore;
      }
    }
  }

  return best;
}
