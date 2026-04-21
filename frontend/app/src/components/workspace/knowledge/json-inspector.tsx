import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

function isJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function escapeJsonPathSegment(segment: string) {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function buildJsonPath(parentPath: string, segment: string) {
  return `${parentPath}/${escapeJsonPathSegment(segment)}`;
}

function buildDefaultJsonExpandedPaths(
  value: unknown,
  maxDepth: number,
  path = "$",
  depth = 0,
  expanded = new Set<string>(),
): Set<string> {
  if (!isJsonObject(value) && !isJsonArray(value)) {
    return expanded;
  }

  if (depth >= maxDepth) {
    return expanded;
  }

  expanded.add(path);

  const entries = isJsonArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);

  entries.forEach(([key, child]) => {
    if (isJsonObject(child) || isJsonArray(child)) {
      buildDefaultJsonExpandedPaths(
        child,
        maxDepth,
        buildJsonPath(path, key),
        depth + 1,
        expanded,
      );
    }
  });

  return expanded;
}

function JsonPrimitiveValue({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return (
      <span className="break-all text-emerald-700 dark:text-emerald-300">
        "{value}"
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-sky-700 dark:text-sky-300">{value}</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="text-violet-700 dark:text-violet-300">{`${value}`}</span>
    );
  }
  if (value === null) {
    return <span className="text-muted-foreground">null</span>;
  }
  return (
    <span className="text-muted-foreground">
      {Object.prototype.toString.call(value)}
    </span>
  );
}

function JsonContainerMeta({ value }: { value: unknown }) {
  if (isJsonArray(value)) {
    return (
      <span className="text-muted-foreground font-mono text-xs">
        [{value.length}]
      </span>
    );
  }
  if (isJsonObject(value)) {
    return (
      <span className="text-muted-foreground font-mono text-xs">
        {`{${Object.keys(value).length}}`}
      </span>
    );
  }
  return null;
}

function JsonInspectorNode({
  path,
  label,
  value,
  depth,
  expandedPaths,
  onToggle,
}: {
  path: string;
  label: string;
  value: unknown;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isContainer = isJsonArray(value) || isJsonObject(value);
  const isExpanded = expandedPaths.has(path);
  const entries = isJsonArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : isJsonObject(value)
      ? Object.entries(value)
      : [];

  const rowClassName =
    "flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors";

  const content = (
    <>
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center"
        style={{ marginLeft: depth * 14 }}
      >
        {isContainer ? (
          <ChevronRightIcon
            className={cn(
              "text-muted-foreground size-4 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        ) : (
          <span className="bg-border size-1.5 rounded-md" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
            {label}
          </span>
          {isContainer ? (
            <JsonContainerMeta value={value} />
          ) : (
            <span className="font-mono text-xs">
              <JsonPrimitiveValue value={value} />
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-1">
      {isContainer ? (
        <button
          type="button"
          data-json-row=""
          data-json-toggle=""
          data-json-path={path}
          className={cn(
            rowClassName,
            "hover:bg-accent/60",
            isExpanded && "bg-accent/35",
          )}
          onClick={() => onToggle(path)}
        >
          {content}
        </button>
      ) : (
        <div
          data-json-row=""
          data-json-path={path}
          className={cn(rowClassName, "hover:bg-transparent")}
        >
          {content}
        </div>
      )}

      {isContainer && isExpanded ? (
        <div className="space-y-1">
          {entries.map(([childLabel, childValue]) => (
            <JsonInspectorNode
              key={buildJsonPath(path, childLabel)}
              path={buildJsonPath(path, childLabel)}
              label={childLabel}
              value={childValue}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function JsonInspector({ value }: { value: unknown }) {
  const initialExpandedPaths = useMemo(
    () => buildDefaultJsonExpandedPaths(value, 2),
    [value],
  );
  const [expandedPaths, setExpandedPaths] = useState(initialExpandedPaths);

  useEffect(() => {
    setExpandedPaths(initialExpandedPaths);
  }, [initialExpandedPaths]);

  const togglePath = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (!isJsonObject(value) && !isJsonArray(value)) {
    return (
      <div className="rounded-lg border p-4 font-mono text-xs">
        <JsonPrimitiveValue value={value} />
      </div>
    );
  }

  const entries = isJsonArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);

  return (
    <div className="border-border bg-background overflow-hidden rounded-lg border">
      <div className="border-border bg-muted/40 flex items-center justify-between border-b px-4 py-3">
        <div className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
          document_index_json
        </div>
        <JsonContainerMeta value={value} />
      </div>
      <div className="space-y-1 p-3 font-mono text-xs">
        {entries.map(([label, childValue]) => (
          <JsonInspectorNode
            key={buildJsonPath("$", label)}
            path={buildJsonPath("$", label)}
            label={label}
            value={childValue}
            depth={0}
            expandedPaths={expandedPaths}
            onToggle={togglePath}
          />
        ))}
      </div>
    </div>
  );
}
