import { BookOpenTextIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/core/i18n/hooks";
import type { KnowledgeTreeNode } from "@/core/knowledge/types";
import { cn } from "@/lib/utils";

export function locatorLabel(
  node: Pick<
    KnowledgeTreeNode,
    "locator_type" | "page_start" | "page_end" | "line_start" | "line_end"
  >,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (node.locator_type === "page") {
    if (node.page_start && node.page_end && node.page_end !== node.page_start) {
      return `${t.knowledge.pageLabel} ${node.page_start}-${node.page_end}`;
    }
    if (node.page_start) {
      return `${t.knowledge.pageLabel} ${node.page_start}`;
    }
  }
  if (node.line_start && node.line_end && node.line_end !== node.line_start) {
    return `${t.knowledge.lineLabel} ${node.line_start}-${node.line_end}`;
  }
  if (node.line_start) {
    return `${t.knowledge.lineLabel} ${node.line_start}`;
  }
  return node.locator_type;
}

export function TreeNodeView({
  node,
  activeNodeId,
  onSelectNode,
}: {
  node: KnowledgeTreeNode;
  activeNodeId?: string;
  onSelectNode?: (node: KnowledgeTreeNode) => void;
}) {
  const { t } = useI18n();
  const summary = node.summary ?? node.visual_summary;
  const active = activeNodeId === node.node_id;

  return (
    <div className="space-y-3">
      <button
        type="button"
        className={cn(
          "w-full rounded-lg border p-4 text-left transition-all duration-200",
          active
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-background hover:bg-background ",
        )}
        onClick={() => onSelectNode?.(node)}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <BookOpenTextIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-sm font-semibold md:text-base">
                {node.title}
              </div>
              <Badge variant="outline">{locatorLabel(node, t)}</Badge>
              {typeof node.child_count === "number" && node.child_count > 0 ? (
                <Badge variant="secondary">
                  {t.knowledge.childCount(node.child_count)}
                </Badge>
              ) : null}
            </div>
            {summary ? (
              <p className="text-muted-foreground text-sm leading-6">
                {summary}
              </p>
            ) : null}
          </div>
          <ChevronRightIcon
            className={cn(
              "text-muted-foreground mt-1 size-4 shrink-0 transition-transform",
              active && "text-primary translate-x-0.5",
            )}
          />
        </div>
      </button>
      {node.nodes?.length ? (
        <div className="border-border ml-4 space-y-3 border-l border-dashed pl-4">
          {node.nodes.map((child) => (
            <TreeNodeView
              key={child.node_id}
              node={child}
              activeNodeId={activeNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
