import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface JsonMarkdownInspectorProps {
  value: unknown;
}

type SelectedField = {
  path: string;
  value: unknown;
};

interface JsonNodeProps {
  label: string;
  value: unknown;
  path: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (field: SelectedField) => void;
}

const PRIORITY_KEYS = [
  "content",
  "markdown",
  "text",
  "message",
  "output",
  "response",
  "body",
  "final",
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
];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildFieldPath(parent: string, label: string): string {
  if (parent === "$") {
    return label;
  }
  if (label.startsWith("[")) {
    return `${parent}${label}`;
  }
  return `${parent}.${label}`;
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (isObject(value)) return `object(${Object.keys(value).length})`;
  if (value === null) return "null";
  return typeof value;
}

function toRawText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toSingleLine(value: unknown, max = 120): string {
  const text = toRawText(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function parseJsonString(text: string): unknown | null {
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

function extractMarkdownSource(value: unknown, depth = 0): string | null {
  if (depth > 10 || value == null) return null;

  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed !== null) {
      const nested = extractMarkdownSource(parsed, depth + 1);
      return nested ?? value;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractMarkdownSource(item, depth + 1))
      .filter((item): item is string => !!item && item.trim().length > 0);
    if (parts.length > 0) {
      return parts.join("\n\n");
    }
    return null;
  }

  if (isObject(value)) {
    const maybeType = value.type;
    if (maybeType === "text" && typeof value.text === "string") {
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
  for (let i = 0; i < PRIORITY_KEYS.length; i += 1) {
    if (normalized.endsWith(PRIORITY_KEYS[i])) {
      return 100 - i * 10 + Math.min(value.length, 50) * 0.01;
    }
  }
  return Math.min(value.length, 50) * 0.01;
}

function findBestField(value: unknown, path = "$", depth = 0): SelectedField | null {
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

function JsonNode({
  label,
  value,
  path,
  depth,
  selectedPath,
  onSelect,
}: JsonNodeProps) {
  const currentPath = buildFieldPath(path, label);

  if (Array.isArray(value)) {
    return (
      <details open={depth < 1} className="space-y-1">
        <summary
          className="cursor-pointer text-xs text-foreground"
          onClick={() => onSelect({ path: currentPath, value })}
        >
          <span className="font-mono">{label}</span>
          <span className="ml-1 text-muted-foreground">{describeType(value)}</span>
        </summary>
        <div className="ml-3 border-l border-border pl-2 space-y-1">
          {value.map((item, index) => (
            <JsonNode
              key={`${currentPath}[${index}]`}
              label={`[${index}]`}
              value={item}
              path={currentPath}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      </details>
    );
  }

  if (isObject(value)) {
    return (
      <details open={depth < 1} className="space-y-1">
        <summary
          className="cursor-pointer text-xs text-foreground"
          onClick={() => onSelect({ path: currentPath, value })}
        >
          <span className="font-mono">{label}</span>
          <span className="ml-1 text-muted-foreground">{describeType(value)}</span>
        </summary>
        <div className="ml-3 border-l border-border pl-2 space-y-1">
          {Object.entries(value).map(([key, item]) => (
            <JsonNode
              key={`${currentPath}.${key}`}
              label={key}
              value={item}
              path={currentPath}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      </details>
    );
  }

  const isSelected = selectedPath === currentPath;
  const isMarkdownCandidate = typeof value === "string";

  return (
    <button
      type="button"
      onClick={() => onSelect({ path: currentPath, value })}
      className={cn(
        "w-full rounded-md border px-2 py-1 text-left transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        isSelected && "border-primary bg-accent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] break-all">{label}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {isMarkdownCandidate ? "string/md" : describeType(value)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground break-all">
        {toSingleLine(value)}
      </p>
    </button>
  );
}

export function JsonMarkdownInspector({ value }: JsonMarkdownInspectorProps) {
  const initialSelection = useMemo(() => findBestField(value), [value]);
  const [selected, setSelected] = useState<SelectedField | null>(initialSelection);

  useEffect(() => {
    setSelected(initialSelection);
  }, [initialSelection]);

  const markdownSource = useMemo(
    () => (selected ? extractMarkdownSource(selected.value) : null),
    [selected],
  );
  const hasMarkdown = !!markdownSource && markdownSource.trim().length > 0;
  const rawText = useMemo(
    () => (selected ? toRawText(selected.value) : ""),
    [selected],
  );

  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="space-y-2 rounded-md border bg-background/70 p-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          JSON Fields
        </p>
        <JsonNode
          label="$"
          value={value}
          path="$"
          depth={0}
          selectedPath={selected?.path ?? null}
          onSelect={setSelected}
        />
      </div>

      <div className="space-y-2 rounded-md border bg-background/70 p-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Markdown Preview
        </p>
        {!selected && (
          <p className="text-xs text-muted-foreground">
            Click any JSON field to preview it as Markdown.
          </p>
        )}
        {selected && (
          <div className="space-y-2">
            <p className="font-mono text-[11px] text-muted-foreground break-all">
              {selected.path}
            </p>
            <div className="max-h-56 overflow-auto rounded-md border bg-background p-2 text-xs">
              {hasMarkdown ? (
                <div
                  className={cn(
                    "space-y-2 break-words",
                    "[&_h1]:text-base [&_h1]:font-semibold",
                    "[&_h2]:text-sm [&_h2]:font-semibold",
                    "[&_h3]:text-sm [&_h3]:font-medium",
                    "[&_p]:leading-relaxed",
                    "[&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2",
                    "[&_code]:rounded [&_code]:bg-muted/80 [&_code]:px-1 [&_code]:py-0.5",
                    "[&_ul]:list-disc [&_ul]:pl-4",
                    "[&_ol]:list-decimal [&_ol]:pl-4",
                    "[&_a]:text-blue-600 [&_a]:underline",
                  )}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {markdownSource as string}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No markdown-like text extracted. Showing raw value below.
                </p>
              )}
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                raw
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap break-all">
                {rawText}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
