import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { KnowledgePreviewFocus } from "./thread-knowledge-management-page";

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^0-9a-z一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripMarkdownPrefix(line: string) {
  return line
    .replace(/^\s{0,3}(#{1,6}\s*|>\s*|\d+\.\s+|[-*+]\s+)/, "")
    .replace(/[`\*_~[\]()]/g, " ")
    .trim();
}

function findFocusLineIndex(
  lines: string[],
  focus: KnowledgePreviewFocus | null,
) {
  if (lines.length === 0) {
    return 0;
  }
  if (focus?.line && focus.line > 0) {
    return Math.min(lines.length - 1, Math.max(0, focus.line - 1));
  }
  if (focus?.heading) {
    const index = lines.findIndex(
      (line) => slugifyHeading(stripMarkdownPrefix(line)) === focus.heading,
    );
    if (index >= 0) {
      return index;
    }
  }
  if (focus?.page && focus.page > 0) {
    const patterns = [
      new RegExp(`OA_PAGE\\s+${focus.page}\\b`, "i"),
      new RegExp(`^#{1,6}\\s*Page\\s+${focus.page}\\b`, "i"),
      new RegExp(`^Page\\s+${focus.page}\\b`, "i"),
    ];
    const index = lines.findIndex((line) =>
      patterns.some((pattern) => pattern.test(line)),
    );
    if (index >= 0) {
      return index;
    }
  }
  return 0;
}

export function KnowledgeCanonicalPreview({
  content,
  focus,
}: {
  content: string;
  focus: KnowledgePreviewFocus | null;
}) {
  const lines = useMemo(() => content.split(/\r?\n/), [content]);
  const focusIndex = useMemo(
    () => findFocusLineIndex(lines, focus),
    [focus, lines],
  );
  const start = Math.max(0, focusIndex - 48);
  const end = Math.min(lines.length, focusIndex + 88);

  return (
    <div className="h-full overflow-auto px-4 py-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge variant="outline">{`${start + 1}-${end}`}</Badge>
        <Badge variant="outline">{`${lines.length} lines`}</Badge>
        {focus?.locatorLabel ? (
          <Badge variant="secondary">{focus.locatorLabel}</Badge>
        ) : null}
      </div>
      <div className="border-border bg-muted/40 rounded-lg border p-3 font-mono text-xs leading-6">
        {lines.slice(start, end).map((line, index) => {
          const lineNumber = start + index + 1;
          const active =
            (focus?.line != null &&
              lineNumber >= focus.line &&
              lineNumber <= (focus.lineEnd ?? focus.line)) ||
            (focus?.line == null && lineNumber === focusIndex + 1);

          return (
            <div
              key={`${lineNumber}:${line}`}
              className={cn(
                "grid grid-cols-[4rem_minmax(0,1fr)] gap-3 rounded-xl px-2 py-0.5 transition-colors",
                active && "bg-primary/10 text-foreground",
              )}
            >
              <div className="text-muted-foreground text-right text-[11px]">
                {lineNumber}
              </div>
              <pre className="overflow-x-auto break-words whitespace-pre-wrap text-xs leading-6">
                {line || " "}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
