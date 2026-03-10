import { useEffect, useMemo, useState } from "react";
import {
  buildFieldPath,
  describeType,
  findBestField,
  isObject,
  toSingleLine,
  type SelectedField,
} from "./json-inspector-utils";
import { RawJsonDetails, ReadableJsonContent } from "./readable-json-content";

interface JsonMarkdownInspectorProps {
  value: unknown;
}

interface JsonNodeProps {
  label: string;
  value: unknown;
  path: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (field: SelectedField) => void;
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
          <span className="ml-1 text-muted-foreground">
            {describeType(value)}
          </span>
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
          <span className="ml-1 text-muted-foreground">
            {describeType(value)}
          </span>
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
  const buttonClass = isSelected
    ? "w-full rounded-md border border-primary bg-accent px-2 py-1 text-left transition-colors"
    : "w-full rounded-md border px-2 py-1 text-left transition-colors hover:bg-accent hover:text-accent-foreground";

  return (
    <button
      type="button"
      onClick={() => onSelect({ path: currentPath, value })}
      className={buttonClass}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] break-all">{label}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {describeType(value)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground break-all">
        {toSingleLine(value)}
      </p>
    </button>
  );
}

function FieldExplorer({
  value,
  selected,
  onSelect,
}: {
  value: unknown;
  selected: SelectedField | null;
  onSelect: (field: SelectedField) => void;
}) {
  return (
    <details className="rounded-md border bg-background/40">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
        Inspect JSON Fields
      </summary>
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
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
            onSelect={onSelect}
          />
        </div>

        <div className="space-y-2 rounded-md border bg-background/70 p-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Selected Field
          </p>
          {!selected ? (
            <p className="text-xs text-muted-foreground">
              Click any field to inspect it.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="font-mono text-[11px] text-muted-foreground break-all">
                {selected.path}
              </p>
              <ReadableJsonContent value={selected.value} />
              <RawJsonDetails value={selected.value} title="Raw JSON" />
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

export function JsonMarkdownInspector({ value }: JsonMarkdownInspectorProps) {
  const initialSelection = useMemo(() => findBestField(value), [value]);
  const [selectedField, setSelectedField] = useState<SelectedField | null>(
    initialSelection,
  );
  const canInspect = Array.isArray(value) || isObject(value);

  useEffect(() => {
    setSelectedField(initialSelection);
  }, [initialSelection]);

  return (
    <div className="space-y-3">
      <ReadableJsonContent value={value} />
      {canInspect && (
        <FieldExplorer
          value={value}
          selected={selectedField}
          onSelect={setSelectedField}
        />
      )}
    </div>
  );
}
