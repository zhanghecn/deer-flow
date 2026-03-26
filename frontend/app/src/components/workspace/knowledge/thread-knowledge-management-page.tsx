import {
  ArrowRightIcon,
  BookOpenTextIcon,
  ChevronRightIcon,
  Code2Icon,
  type LucideIcon,
  EyeIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  HouseIcon,
  LoaderIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { openArtifactInNewWindow } from "@/core/artifacts/actions";
import { useArtifactObjectUrl } from "@/core/artifacts/hooks";
import { setPdfPreviewPage } from "@/core/artifacts/pdf";
import { useAuth } from "@/core/auth/hooks";
import {
  attachKnowledgeBaseToThread,
  deleteKnowledgeBase,
  detachKnowledgeBaseFromThread,
  updateKnowledgeBaseSettings,
} from "@/core/knowledge/api";
import {
  getKnowledgeDocumentProgress,
  getKnowledgeDocumentStatus,
  isKnowledgeDocumentBuildActive,
} from "@/core/knowledge/documents";
import {
  useKnowledgeDocumentDebug,
  useKnowledgeLibrary,
  useVisibleKnowledgeDocumentObjectUrl,
  useVisibleKnowledgeDocumentBuildEvents,
  useVisibleKnowledgeDocumentTree,
} from "@/core/knowledge/hooks";
import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeTreeNode,
} from "@/core/knowledge/types";
import { useI18n } from "@/core/i18n/hooks";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { cn } from "@/lib/utils";

import { KnowledgeBaseUploadDialog } from "./knowledge-base-upload-dialog";

type LibraryDocumentView = KnowledgeDocument & {
  owner_name: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  knowledge_base_description?: string;
  attached_to_thread: boolean;
  visibility: string;
  preview_enabled: boolean;
};

type KnowledgeOwnerGroup = {
  ownerName: string;
  bases: KnowledgeBase[];
};

type KnowledgePreviewMode = "preview" | "canonical";

type KnowledgePreviewFocus = {
  nodeId?: string;
  title?: string;
  locatorLabel?: string;
  page?: number;
  pageEnd?: number;
  heading?: string;
  line?: number;
  lineEnd?: number;
};

const panelLabelClassName =
  "text-muted-foreground text-[11px] font-medium uppercase tracking-[0.22em]";

function statusTone(status: string): "default" | "secondary" | "destructive" {
  switch (status) {
    case "ready":
      return "default";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>["t"]) {
  switch (status) {
    case "queued":
      return t.knowledge.status.queued;
    case "ready":
      return t.knowledge.status.ready;
    case "processing":
      return t.knowledge.status.processing;
    case "error":
      return t.knowledge.status.error;
    default:
      return status;
  }
}

function visibilityLabel(
  visibility: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (visibility) {
    case "shared":
      return t.knowledge.visibilityShared;
    case "private":
      return t.knowledge.visibilityPrivate;
    default:
      return visibility;
  }
}

function formatTimestamp(value: string | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatElapsed(startedAt?: string, finishedAt?: string) {
  if (!startedAt) {
    return "";
  }
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "";
  }
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function locatorLabel(
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

function toLibraryDocumentView(
  knowledgeBase: KnowledgeBase,
  document: KnowledgeDocument,
): LibraryDocumentView {
  return {
    ...document,
    owner_name: knowledgeBase.owner_name,
    knowledge_base_id: knowledgeBase.id,
    knowledge_base_name: knowledgeBase.name,
    knowledge_base_description: knowledgeBase.description,
    attached_to_thread: knowledgeBase.attached_to_thread,
    visibility: knowledgeBase.visibility,
    preview_enabled: knowledgeBase.preview_enabled,
  };
}

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function basenameOfPath(filepath: string) {
  const segments = filepath.split("/");
  return segments[segments.length - 1] ?? filepath;
}

function isRuntimeArtifactPath(filepath: string | null | undefined) {
  return typeof filepath === "string" && filepath.startsWith("/mnt/user-data/");
}

function toKnowledgeRuntimeArtifactPath(
  document: KnowledgeDocument | null,
  filepath: string | null | undefined,
) {
  if (!document || !filepath) {
    return null;
  }
  if (isRuntimeArtifactPath(filepath)) {
    return filepath;
  }
  return `/mnt/user-data/outputs/.knowledge/${document.id}/${basenameOfPath(filepath)}`;
}

function stripMarkdownPrefix(line: string) {
  return line
    .replace(/^\s{0,3}(#{1,6}\s*|>\s*|\d+\.\s+|[-*+]\s+)/, "")
    .replace(/[`*_~[\]()]/g, " ")
    .trim();
}

function documentBinaryPreviewPath(document: KnowledgeDocument | null) {
  if (document == null) {
    return null;
  }
  if (document.locator_type !== "page") {
    return null;
  }
  return toKnowledgeRuntimeArtifactPath(
    document,
    document.preview_storage_path ?? document.source_storage_path ?? null,
  );
}

function documentTextPreviewPath(document: KnowledgeDocument | null) {
  if (document == null) {
    return null;
  }
  const candidate =
    document.markdown_storage_path ??
    document.canonical_storage_path ??
    document.source_storage_path ??
    null;
  return (isRuntimeArtifactPath(candidate) ? candidate : null) ?? null;
}

function isPdfPreviewDocument(document: KnowledgeDocument | null) {
  const filepath = documentBinaryPreviewPath(document)?.toLowerCase();
  if (!filepath) {
    return false;
  }
  return filepath.endsWith(".pdf");
}

function buildPreviewFocusFromNode(
  node: KnowledgeTreeNode,
  t: ReturnType<typeof useI18n>["t"],
): KnowledgePreviewFocus {
  return {
    nodeId: node.node_id,
    title: node.title,
    locatorLabel: `${node.title} · ${locatorLabel(node, t)}`,
    page: node.page_start,
    pageEnd: node.page_end,
    heading: node.heading_slug,
    line: node.line_start,
    lineEnd: node.line_end,
  };
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
  return <span className="text-muted-foreground">{String(value)}</span>;
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
          <span className="bg-border size-1.5 rounded-full" />
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

function JsonInspector({ value }: { value: unknown }) {
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
      <div className="rounded-[20px] border p-4 font-mono text-xs">
        <JsonPrimitiveValue value={value} />
      </div>
    );
  }

  const entries = isJsonArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);

  return (
    <div className="border-border/60 bg-background overflow-hidden rounded-[20px] border">
      <div className="border-border/60 bg-muted/20 flex items-center justify-between border-b px-4 py-3">
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

function ExplorerEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <div className="border-border/60 bg-muted/35 text-primary flex size-14 items-center justify-center rounded-[20px] border">
        <Icon className="size-7" />
      </div>
      <h2 className="mt-6 text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-3 max-w-md text-sm leading-6">
        {description}
      </p>
    </div>
  );
}

function TreeNodeView({
  node,
  activeNodeId,
  onSelectNode,
}: {
  node: KnowledgeTreeNode;
  activeNodeId?: string;
  onSelectNode?: (node: KnowledgeTreeNode) => void;
}) {
  const { t } = useI18n();
  const summary = node.prefix_summary ?? node.summary;
  const active = activeNodeId === node.node_id;

  return (
    <div className="space-y-3">
      <button
        type="button"
        className={cn(
          "w-full rounded-[22px] border p-4 text-left shadow-sm transition-all duration-200",
          active
            ? "border-primary/40 bg-primary/8 shadow-[0_18px_48px_-34px_rgba(59,130,246,0.7)]"
            : "border-border/60 bg-background/70 hover:bg-background/85 hover:-translate-y-0.5",
        )}
        onClick={() => onSelectNode?.(node)}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-2xl">
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
        <div className="border-border/50 ml-4 space-y-3 border-l border-dashed pl-4">
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

function KnowledgeCanonicalPreview({
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
      <div className="border-border/60 bg-muted/25 rounded-[22px] border p-3 font-mono text-xs leading-6 shadow-inner">
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
              <pre className="overflow-x-auto text-xs leading-6 break-words whitespace-pre-wrap">
                {line || " "}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KnowledgePreviewPanel({
  document,
  threadId,
  canonicalMarkdown,
  focus,
  mode,
  onModeChange,
}: {
  document: LibraryDocumentView;
  threadId: string | undefined;
  canonicalMarkdown?: string;
  focus: KnowledgePreviewFocus | null;
  mode: KnowledgePreviewMode;
  onModeChange: (mode: KnowledgePreviewMode) => void;
}) {
  const { t } = useI18n();
  const [opening, setOpening] = useState(false);
  const binaryPath = documentBinaryPreviewPath(document);
  const textPath = documentTextPreviewPath(document);
  const hasBinaryPreview =
    document.file_kind.toLowerCase() === "pdf" &&
    (threadId == null || isPdfPreviewDocument(document));
  const canCompareCanonical = Boolean(canonicalMarkdown?.trim().length);
  const effectiveMode =
    mode === "preview" && hasBinaryPreview
      ? "preview"
      : canCompareCanonical
        ? "canonical"
        : "preview";

  const {
    objectUrl,
    isLoading: previewLoading,
    error: previewError,
  } = useArtifactObjectUrl({
    filepath: binaryPath ?? "",
    threadId: threadId ?? "",
    enabled: Boolean(threadId && binaryPath && hasBinaryPreview),
  });
  const {
    objectUrl: visibleObjectUrl,
    isLoading: visiblePreviewLoading,
    error: visiblePreviewError,
  } = useVisibleKnowledgeDocumentObjectUrl({
    documentId: document.id,
    enabled: Boolean(!threadId && hasBinaryPreview),
    variant: "preview",
  });
  const activePreviewObjectUrl = threadId ? objectUrl : visibleObjectUrl;
  const activePreviewLoading = threadId
    ? previewLoading
    : visiblePreviewLoading;
  const activePreviewError = threadId ? previewError : visiblePreviewError;

  const compareContent = canonicalMarkdown ?? "";

  const handleOpen = async () => {
    try {
      setOpening(true);
      if (effectiveMode === "preview" && activePreviewObjectUrl) {
        window.open(
          setPdfPreviewPage(activePreviewObjectUrl, focus?.page),
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }
      if (
        !threadId &&
        effectiveMode === "canonical" &&
        compareContent.trim().length > 0
      ) {
        const textObjectUrl = URL.createObjectURL(
          new Blob([compareContent], { type: "text/markdown;charset=utf-8" }),
        );
        const openedWindow = window.open(
          textObjectUrl,
          "_blank",
          "noopener,noreferrer",
        );
        if (!openedWindow) {
          URL.revokeObjectURL(textObjectUrl);
          throw new Error(t.common.previewUnavailable);
        }
        window.setTimeout(() => URL.revokeObjectURL(textObjectUrl), 60_000);
        return;
      }
      if (!threadId) {
        return;
      }
      const filepath =
        effectiveMode === "canonical"
          ? (textPath ?? binaryPath)
          : (binaryPath ?? textPath);
      if (!filepath) {
        return;
      }
      await openArtifactInNewWindow({
        filepath,
        threadId,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.common.previewUnavailable,
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="border-border/60 bg-background/55 flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border">
      <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4">
        <div className="space-y-2">
          <div className={panelLabelClassName}>{t.common.preview}</div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">{document.display_name}</div>
            {focus?.locatorLabel ? (
              <Badge variant="secondary">{focus.locatorLabel}</Badge>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasBinaryPreview ? (
            <Button
              size="sm"
              variant={effectiveMode === "preview" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => onModeChange("preview")}
            >
              {t.common.preview}
            </Button>
          ) : null}
          {canCompareCanonical ? (
            <Button
              size="sm"
              variant={effectiveMode === "canonical" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => onModeChange("canonical")}
            >
              {t.knowledge.canonicalTab}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={
              opening ||
              (effectiveMode === "preview"
                ? !activePreviewObjectUrl
                : threadId
                  ? !textPath && !binaryPath
                  : compareContent.trim().length === 0)
            }
            onClick={() => void handleOpen()}
          >
            {opening ? (
              <LoaderIcon className="mr-2 size-4 animate-spin" />
            ) : (
              <ExternalLinkIcon className="mr-2 size-4" />
            )}
            {t.common.openInNewWindow}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {effectiveMode === "preview" && hasBinaryPreview ? (
          activePreviewError instanceof Error ? (
            <ExplorerEmptyState
              icon={EyeIcon}
              title={t.common.previewUnavailable}
              description={activePreviewError.message}
            />
          ) : activePreviewLoading || !activePreviewObjectUrl ? (
            <div className="flex h-full items-center justify-center">
              <LoaderIcon className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : (
            <iframe
              key={`${activePreviewObjectUrl}:${focus?.page ?? 0}`}
              className="size-full"
              src={setPdfPreviewPage(activePreviewObjectUrl, focus?.page)}
              title={`${document.display_name} preview`}
            />
          )
        ) : canCompareCanonical ? (
          compareContent.trim().length === 0 ? (
            <ExplorerEmptyState
              icon={Code2Icon}
              title={t.knowledge.canonicalTab}
              description={t.knowledge.emptyCanonical}
            />
          ) : (
            <KnowledgeCanonicalPreview content={compareContent} focus={focus} />
          )
        ) : (
          <ExplorerEmptyState
            icon={EyeIcon}
            title={t.common.previewUnavailable}
            description={t.common.inlinePreviewUnsupported}
          />
        )}
      </div>
    </div>
  );
}

export function ThreadKnowledgeManagementPage() {
  const { thread_id: threadId, agent_name: agentName } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { knowledgeBases, isLoading } = useKnowledgeLibrary(threadId);
  const [search, setSearch] = useState("");
  const [selectedOwnerName, setSelectedOwnerName] = useState<string | null>(
    null,
  );
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [bindingBusyBaseId, setBindingBusyBaseId] = useState<string | null>(
    null,
  );
  const [settingsBusyBaseId, setSettingsBusyBaseId] = useState<string | null>(
    null,
  );
  const [previewMode, setPreviewMode] =
    useState<KnowledgePreviewMode>("preview");
  const [previewFocus, setPreviewFocus] =
    useState<KnowledgePreviewFocus | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteBaseTarget, setDeleteBaseTarget] =
    useState<KnowledgeBase | null>(null);
  const [deletingBaseId, setDeletingBaseId] = useState<string | null>(null);

  const filteredKnowledgeBases = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return knowledgeBases;
    }
    return knowledgeBases
      .map((knowledgeBase) => {
        const matchesBase =
          knowledgeBase.name.toLowerCase().includes(query) ||
          knowledgeBase.owner_name.toLowerCase().includes(query) ||
          (knowledgeBase.description ?? "").toLowerCase().includes(query);
        const documents = knowledgeBase.documents.filter((document) => {
          const text =
            `${document.display_name} ${document.doc_description ?? ""} ${document.file_kind} ${document.locator_type}`.toLowerCase();
          return text.includes(query);
        });
        if (matchesBase) {
          return knowledgeBase;
        }
        return documents.length > 0 ? { ...knowledgeBase, documents } : null;
      })
      .filter(
        (knowledgeBase): knowledgeBase is KnowledgeBase =>
          knowledgeBase !== null,
      );
  }, [knowledgeBases, search]);

  const groupedBases = useMemo<KnowledgeOwnerGroup[]>(() => {
    const groups = new Map<string, KnowledgeBase[]>();
    filteredKnowledgeBases.forEach((knowledgeBase) => {
      const existing = groups.get(knowledgeBase.owner_name) ?? [];
      existing.push(knowledgeBase);
      groups.set(knowledgeBase.owner_name, existing);
    });
    return Array.from(groups.entries())
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([ownerName, bases]) => ({
        ownerName,
        bases: [...bases].sort((leftBase, rightBase) =>
          leftBase.name.localeCompare(rightBase.name),
        ),
      }));
  }, [filteredKnowledgeBases]);

  useEffect(() => {
    if (selectedOwnerName == null) {
      return;
    }
    if (!groupedBases.some((group) => group.ownerName === selectedOwnerName)) {
      setSelectedOwnerName(null);
      setSelectedBaseId(null);
    }
  }, [groupedBases, selectedOwnerName]);

  useEffect(() => {
    if (selectedBaseId == null) {
      return;
    }
    if (
      !filteredKnowledgeBases.some(
        (knowledgeBase) => knowledgeBase.id === selectedBaseId,
      )
    ) {
      setSelectedBaseId(null);
      setSelectedDocumentId(null);
      setDetailOpen(false);
    }
  }, [filteredKnowledgeBases, selectedBaseId]);

  const selectedBase =
    filteredKnowledgeBases.find(
      (knowledgeBase) => knowledgeBase.id === selectedBaseId,
    ) ?? null;
  const canDeleteSelectedBase =
    selectedBase != null &&
    (selectedBase.owner_id === user?.id || user?.role === "admin");

  const selectedOwnerGroup =
    selectedOwnerName == null
      ? null
      : (groupedBases.find((group) => group.ownerName === selectedOwnerName) ??
        null);

  const selectedOwnerBases = selectedOwnerGroup?.bases ?? [];

  const selectedBaseDocuments = useMemo<LibraryDocumentView[]>(
    () =>
      selectedBase
        ? selectedBase.documents.map((document) =>
            toLibraryDocumentView(selectedBase, document),
          )
        : [],
    [selectedBase],
  );

  useEffect(() => {
    if (selectedBaseDocuments.length === 0) {
      setSelectedDocumentId(null);
      setDetailOpen(false);
      return;
    }
    if (
      selectedDocumentId == null ||
      !selectedBaseDocuments.some(
        (document) => document.id === selectedDocumentId,
      )
    ) {
      setSelectedDocumentId(selectedBaseDocuments[0]?.id ?? null);
    }
  }, [selectedBaseDocuments, selectedDocumentId]);

  useEffect(() => {
    setDetailOpen(false);
  }, [selectedBaseId]);

  const documents = useMemo<LibraryDocumentView[]>(
    () =>
      filteredKnowledgeBases.flatMap((knowledgeBase) =>
        knowledgeBase.documents.map((document) =>
          toLibraryDocumentView(knowledgeBase, document),
        ),
      ),
    [filteredKnowledgeBases],
  );

  const selectedDocument =
    selectedBaseDocuments.find(
      (document) => document.id === selectedDocumentId,
    ) ?? null;
  const selectedDocumentReady =
    selectedDocument != null &&
    getKnowledgeDocumentStatus(selectedDocument) === "ready";

  useEffect(() => {
    if (!selectedDocument) {
      setPreviewFocus(null);
      return;
    }
    setPreviewFocus(null);
    setDetailTab("overview");
    setPreviewMode(
      selectedDocument.locator_type === "heading" ? "canonical" : "preview",
    );
  }, [selectedDocument?.id, selectedDocument?.locator_type]);

  const treeQuery = useVisibleKnowledgeDocumentTree(
    selectedDocument?.id,
    detailOpen && selectedDocumentReady,
  );
  const eventsQuery = useVisibleKnowledgeDocumentBuildEvents(
    detailOpen ? selectedDocument : null,
  );
  const debugQuery = useKnowledgeDocumentDebug(
    selectedDocument?.id,
    detailOpen && Boolean(selectedDocument),
  );

  const effectivePreviewFocus = useMemo<KnowledgePreviewFocus | null>(() => {
    if (previewFocus) {
      return previewFocus;
    }
    if (!selectedDocument) {
      return null;
    }
    const firstNode = treeQuery.data?.[0];
    if (selectedDocument.locator_type === "heading") {
      if (firstNode) {
        return buildPreviewFocusFromNode(firstNode, t);
      }
      return {
        locatorLabel: `${t.knowledge.lineLabel} 1`,
        line: 1,
      };
    }
    if (selectedDocument.page_count && selectedDocument.page_count > 0) {
      return {
        locatorLabel: `${t.knowledge.pageLabel} 1`,
        page: 1,
      };
    }
    if (firstNode) {
      return buildPreviewFocusFromNode(firstNode, t);
    }
    return null;
  }, [previewFocus, selectedDocument, t, treeQuery.data]);

  const totalDocumentCount = documents.length;
  const readyCount = documents.filter(
    (document) => getKnowledgeDocumentStatus(document) === "ready",
  ).length;
  const activeCount = documents.filter((document) =>
    isKnowledgeDocumentBuildActive(document),
  ).length;
  const attachedBaseCount = filteredKnowledgeBases.filter(
    (knowledgeBase) => knowledgeBase.attached_to_thread,
  ).length;
  const isThreadScoped = threadId != null;
  const managerTitle = isThreadScoped
    ? t.knowledge.managerTitle
    : t.knowledge.managerTitleGlobal;
  const managerDescription = isThreadScoped
    ? t.knowledge.managerDescription
    : t.knowledge.managerDescriptionGlobal;
  const activeLibraryDescription = isThreadScoped
    ? t.knowledge.libraryDescription
    : t.knowledge.libraryDescriptionGlobal;

  const chatPath =
    threadId == null
      ? "/workspace/agents"
      : agentName
        ? `/workspace/agents/${agentName}/chats/${threadId}`
        : `/workspace/chats/${threadId}`;

  const ownerRows = groupedBases.map((group) => ({
    ownerName: group.ownerName,
    baseCount: group.bases.length,
    documentCount: group.bases.reduce(
      (total, knowledgeBase) => total + knowledgeBase.documents.length,
      0,
    ),
    readyCount: group.bases.reduce(
      (total, knowledgeBase) =>
        total +
        knowledgeBase.documents.filter(
          (document) => getKnowledgeDocumentStatus(document) === "ready",
        ).length,
      0,
    ),
  }));

  const listMode = selectedBase
    ? "documents"
    : selectedOwnerGroup
      ? "bases"
      : "owners";

  const handleBinding = async (
    knowledgeBase: KnowledgeBase,
    nextAttached: boolean,
  ) => {
    if (!threadId) {
      return;
    }
    setBindingBusyBaseId(knowledgeBase.id);
    try {
      if (nextAttached) {
        await attachKnowledgeBaseToThread(threadId, knowledgeBase.id);
        toast.success(t.knowledge.attachedSuccess(knowledgeBase.name));
      } else {
        await detachKnowledgeBaseFromThread(threadId, knowledgeBase.id);
        toast.success(t.knowledge.detachedSuccess(knowledgeBase.name));
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["thread-knowledge-bases", threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["knowledge-library", threadId],
        }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.knowledge.bindingError,
      );
    } finally {
      setBindingBusyBaseId(null);
    }
  };

  const handlePreviewSetting = async (
    knowledgeBase: KnowledgeBase,
    nextPreviewEnabled: boolean,
  ) => {
    setSettingsBusyBaseId(knowledgeBase.id);
    try {
      await updateKnowledgeBaseSettings(knowledgeBase.id, {
        previewEnabled: nextPreviewEnabled,
      });
      toast.success(
        nextPreviewEnabled
          ? t.knowledge.previewUpdateEnabled(knowledgeBase.name)
          : t.knowledge.previewUpdateDisabled(knowledgeBase.name),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["knowledge-library", threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["thread-knowledge-bases", threadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["knowledge-document-debug", selectedDocumentId],
        }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.knowledge.previewUpdateError,
      );
    } finally {
      setSettingsBusyBaseId(null);
    }
  };

  const handleNodeFocus = (node: KnowledgeTreeNode) => {
    const nextFocus = buildPreviewFocusFromNode(node, t);
    setPreviewFocus(nextFocus);
    if (nextFocus.page == null) {
      setPreviewMode("canonical");
    }
  };

  const openOwner = (ownerName: string) => {
    setSelectedOwnerName(ownerName);
    setSelectedBaseId(null);
    setSelectedDocumentId(null);
  };

  const openBase = (knowledgeBase: KnowledgeBase) => {
    setSelectedOwnerName(knowledgeBase.owner_name);
    setSelectedBaseId(knowledgeBase.id);
    setSelectedDocumentId(knowledgeBase.documents[0]?.id ?? null);
  };

  const openDocument = (document: LibraryDocumentView) => {
    setSelectedOwnerName(document.owner_name);
    setSelectedBaseId(document.knowledge_base_id);
    setSelectedDocumentId(document.id);
    setDetailOpen(true);
  };

  const handleDeleteBase = async () => {
    if (!deleteBaseTarget) {
      return;
    }

    setDeletingBaseId(deleteBaseTarget.id);
    try {
      await deleteKnowledgeBase(deleteBaseTarget.id);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["knowledge-library"],
        }),
        ...(threadId
          ? [
              queryClient.invalidateQueries({
                queryKey: ["thread-knowledge-bases", threadId],
              }),
            ]
          : []),
      ]);

      if (selectedBaseId === deleteBaseTarget.id) {
        setSelectedBaseId(null);
        setSelectedDocumentId(null);
        setDetailOpen(false);
        setSelectedOwnerName(deleteBaseTarget.owner_name);
      }

      toast.success(t.knowledge.deleteSuccess(deleteBaseTarget.name));
      setDeleteBaseTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.knowledge.deleteError,
      );
    } finally {
      setDeletingBaseId(null);
    }
  };

  return (
    <WorkspaceContainer>
      <KnowledgeBaseUploadDialog
        threadId={threadId}
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />
      <WorkspaceHeader />
      <WorkspaceBody>
        <div className="bg-muted/30 flex size-full min-h-0 gap-4 overflow-hidden p-4 md:p-6">
          <aside className="border-border/70 bg-background flex min-h-0 w-[280px] shrink-0 flex-col overflow-hidden rounded-[28px] border">
            <div className="border-border/60 border-b px-5 py-5">
              <div className={panelLabelClassName}>
                {t.knowledge.libraryTitle}
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight">
                {managerTitle}
              </h1>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {activeLibraryDescription}
              </p>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-6 p-4">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors",
                    selectedOwnerGroup == null && selectedBase == null
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                  onClick={() => {
                    setSelectedOwnerName(null);
                    setSelectedBaseId(null);
                    setSelectedDocumentId(null);
                  }}
                >
                  <div className="bg-muted text-foreground flex size-8 items-center justify-center rounded-xl">
                    <HouseIcon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{managerTitle}</div>
                    <div className="text-muted-foreground text-xs">
                      {t.knowledge.baseCount(filteredKnowledgeBases.length)}
                    </div>
                  </div>
                </button>

                {isLoading ? (
                  <div className="text-muted-foreground px-3 text-sm">
                    {t.knowledge.loadingLibrary}
                  </div>
                ) : groupedBases.length === 0 ? (
                  <div className="px-3">
                    <ExplorerEmptyState
                      icon={FolderIcon}
                      title={t.knowledge.emptyLibrary}
                      description={managerDescription}
                    />
                  </div>
                ) : (
                  groupedBases.map((group) => (
                    <div key={group.ownerName} className="space-y-2">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors",
                          selectedOwnerName === group.ownerName &&
                            selectedBase == null
                            ? "bg-accent text-foreground"
                            : "hover:bg-accent/60",
                        )}
                        onClick={() => openOwner(group.ownerName)}
                      >
                        <div className="bg-muted text-foreground flex size-8 items-center justify-center rounded-xl">
                          <FolderIcon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">
                            {group.ownerName}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {t.knowledge.baseCount(group.bases.length)}
                          </div>
                        </div>
                        <ChevronRightIcon className="text-muted-foreground size-4" />
                      </button>

                      {selectedOwnerName === group.ownerName ? (
                        <div className="border-border/40 ml-4 space-y-1 border-l pl-3">
                          {group.bases.map((knowledgeBase) => {
                            const readyDocuments =
                              knowledgeBase.documents.filter(
                                (document) =>
                                  getKnowledgeDocumentStatus(document) ===
                                  "ready",
                              ).length;

                            return (
                              <button
                                key={knowledgeBase.id}
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                                  selectedBase?.id === knowledgeBase.id
                                    ? "bg-primary/8 text-foreground"
                                    : "hover:bg-accent/50",
                                )}
                                onClick={() => openBase(knowledgeBase)}
                              >
                                <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {knowledgeBase.name}
                                  </div>
                                  <div className="text-muted-foreground text-[11px]">
                                    {t.knowledge.documentCount(
                                      knowledgeBase.documents.length,
                                    )}{" "}
                                    · {t.knowledge.readyCount(readyDocuments)}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </aside>

          <section className="border-border/70 bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border">
            <div className="border-border/60 border-b px-6 py-5">
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                    <button
                      type="button"
                      className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
                      onClick={() => {
                        setSelectedOwnerName(null);
                        setSelectedBaseId(null);
                        setSelectedDocumentId(null);
                      }}
                    >
                      <HouseIcon className="size-4" />
                      <span>{managerTitle}</span>
                    </button>
                    {selectedOwnerGroup ? (
                      <>
                        <ChevronRightIcon className="size-4" />
                        <button
                          type="button"
                          className="hover:text-foreground transition-colors"
                          onClick={() => {
                            setSelectedBaseId(null);
                            setSelectedDocumentId(null);
                          }}
                        >
                          {selectedOwnerGroup.ownerName}
                        </button>
                      </>
                    ) : null}
                    {selectedBase ? (
                      <>
                        <ChevronRightIcon className="size-4" />
                        <span className="text-foreground">
                          {selectedBase.name}
                        </span>
                      </>
                    ) : null}
                  </div>

                  <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                    {selectedBase
                      ? selectedBase.name
                      : selectedOwnerGroup
                        ? selectedOwnerGroup.ownerName
                        : managerTitle}
                  </h2>
                  <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6">
                    {selectedBase
                      ? (selectedBase.description ?? activeLibraryDescription)
                      : selectedOwnerGroup
                        ? t.knowledge.baseCount(selectedOwnerBases.length)
                        : managerDescription}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative">
                    <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t.knowledge.searchPlaceholder}
                      className="h-11 w-full min-w-[260px] rounded-2xl pl-10 sm:w-[320px]"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                    <Button
                      type="button"
                      className="rounded-2xl px-4"
                      onClick={() => setUploadDialogOpen(true)}
                    >
                      <UploadIcon className="size-4" />
                      {t.knowledge.uploadButton}
                    </Button>
                    {selectedBase && canDeleteSelectedBase ? (
                      <Button
                        type="button"
                        variant="destructive"
                        className="rounded-2xl px-4"
                        disabled={deletingBaseId === selectedBase.id}
                        onClick={() => setDeleteBaseTarget(selectedBase)}
                      >
                        {deletingBaseId === selectedBase.id ? (
                          <LoaderIcon className="size-4 animate-spin" />
                        ) : (
                          <Trash2Icon className="size-4" />
                        )}
                        {t.common.delete}
                      </Button>
                    ) : null}
                    <Button
                      asChild
                      variant="outline"
                      className="rounded-2xl px-4"
                    >
                      <Link to={chatPath}>
                        {isThreadScoped
                          ? t.knowledge.backToChat
                          : t.knowledge.backToAgents}
                        <ArrowRightIcon className="size-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {selectedBase ? (
                  <>
                    <Badge variant="outline">
                      {t.knowledge.documentCount(selectedBaseDocuments.length)}
                    </Badge>
                    <Badge variant="outline">
                      {t.knowledge.readyCount(
                        selectedBaseDocuments.filter(
                          (document) =>
                            getKnowledgeDocumentStatus(document) === "ready",
                        ).length,
                      )}
                    </Badge>
                    {threadId ? (
                      <Button
                        size="sm"
                        variant={
                          selectedBase.attached_to_thread
                            ? "secondary"
                            : "outline"
                        }
                        disabled={bindingBusyBaseId === selectedBase.id}
                        className="rounded-full"
                        onClick={() =>
                          void handleBinding(
                            selectedBase,
                            !selectedBase.attached_to_thread,
                          )
                        }
                      >
                        {bindingBusyBaseId === selectedBase.id ? (
                          <LoaderIcon className="size-4 animate-spin" />
                        ) : selectedBase.attached_to_thread ? (
                          t.knowledge.detach
                        ) : (
                          t.knowledge.attach
                        )}
                      </Button>
                    ) : null}
                    {selectedBase.owner_id === user?.id ? (
                      <div className="border-border/60 bg-muted/20 flex items-center gap-3 rounded-full border px-3 py-1.5">
                        <span className="text-sm">
                          {t.knowledge.previewSetting}
                        </span>
                        <Switch
                          checked={selectedBase.preview_enabled}
                          disabled={settingsBusyBaseId === selectedBase.id}
                          onCheckedChange={(checked) =>
                            void handlePreviewSetting(selectedBase, checked)
                          }
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Badge variant="outline">
                      {t.knowledge.documentCount(totalDocumentCount)}
                    </Badge>
                    <Badge variant="outline">
                      {t.knowledge.readyCount(readyCount)}
                    </Badge>
                    {activeCount > 0 ? (
                      <Badge variant="secondary">
                        {t.knowledge.activeCount(activeCount)}
                      </Badge>
                    ) : null}
                    {isThreadScoped ? (
                      <Badge variant="outline">
                        {t.knowledge.attachedBaseCount(attachedBaseCount)}
                      </Badge>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="divide-border/60 min-h-full divide-y">
                {isLoading ? (
                  <div className="text-muted-foreground px-6 py-8 text-sm">
                    {t.knowledge.loadingLibrary}
                  </div>
                ) : listMode === "owners" ? (
                  ownerRows.map((owner) => (
                    <div
                      key={owner.ownerName}
                      className="hover:bg-muted/20 flex items-center gap-4 px-6 py-5 transition-colors"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-4 text-left"
                        onClick={() => openOwner(owner.ownerName)}
                      >
                        <div className="bg-muted flex size-10 items-center justify-center rounded-2xl">
                          <FolderIcon className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold md:text-base">
                            {owner.ownerName}
                          </div>
                          <div className="text-muted-foreground mt-1 text-sm">
                            {t.knowledge.baseCount(owner.baseCount)} ·{" "}
                            {t.knowledge.documentCount(owner.documentCount)}
                          </div>
                        </div>
                      </button>
                      <div className="text-muted-foreground hidden text-sm lg:block">
                        {t.knowledge.readyCount(owner.readyCount)}
                      </div>
                      <ChevronRightIcon className="text-muted-foreground size-4" />
                    </div>
                  ))
                ) : listMode === "bases" ? (
                  selectedOwnerBases.map((knowledgeBase) => {
                    const readyDocuments = knowledgeBase.documents.filter(
                      (document) =>
                        getKnowledgeDocumentStatus(document) === "ready",
                    ).length;
                    const activeDocuments = knowledgeBase.documents.filter(
                      (document) => isKnowledgeDocumentBuildActive(document),
                    ).length;

                    return (
                      <div
                        key={knowledgeBase.id}
                        className="hover:bg-muted/20 flex items-center gap-4 px-6 py-5 transition-colors"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-4 text-left"
                          onClick={() => openBase(knowledgeBase)}
                        >
                          <div className="bg-muted flex size-10 items-center justify-center rounded-2xl">
                            <FolderIcon className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold md:text-base">
                              {knowledgeBase.name}
                            </div>
                            <div className="text-muted-foreground mt-1 text-sm">
                              {knowledgeBase.description ??
                                `${visibilityLabel(knowledgeBase.visibility, t)} · ${knowledgeBase.preview_enabled ? t.knowledge.previewEnabled : t.knowledge.previewDisabled}`}
                            </div>
                          </div>
                        </button>
                        <div className="hidden items-center gap-2 lg:flex">
                          <Badge variant="outline">
                            {t.knowledge.documentCount(
                              knowledgeBase.documents.length,
                            )}
                          </Badge>
                          <Badge variant="outline">
                            {t.knowledge.readyCount(readyDocuments)}
                          </Badge>
                          {activeDocuments > 0 ? (
                            <Badge variant="secondary">
                              {t.knowledge.activeCount(activeDocuments)}
                            </Badge>
                          ) : null}
                        </div>
                        <ChevronRightIcon className="text-muted-foreground size-4" />
                      </div>
                    );
                  })
                ) : selectedBaseDocuments.length === 0 ? (
                  <div className="px-6 py-8">
                    <ExplorerEmptyState
                      icon={FileTextIcon}
                      title={t.knowledge.noDocumentSelectedTitle}
                      description={t.knowledge.noDocumentSelectedDescription}
                    />
                  </div>
                ) : (
                  selectedBaseDocuments.map((document) => {
                    const status = getKnowledgeDocumentStatus(document);

                    return (
                      <div
                        key={document.id}
                        className={cn(
                          "hover:bg-muted/20 flex items-center gap-4 px-6 py-5 transition-colors",
                          selectedDocumentId === document.id && "bg-primary/4",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-4 text-left"
                          onClick={() => openDocument(document)}
                        >
                          <div className="bg-muted flex size-10 items-center justify-center rounded-2xl">
                            <FileTextIcon className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold md:text-base">
                              {document.display_name}
                            </div>
                            <div className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                              {document.doc_description ??
                                `${document.file_kind} · ${visibilityLabel(document.visibility, t)}`}
                            </div>
                            {status !== "ready" ? (
                              <div className="mt-3 max-w-sm">
                                <Progress
                                  value={getKnowledgeDocumentProgress(document)}
                                />
                              </div>
                            ) : null}
                          </div>
                        </button>
                        <div className="hidden items-center gap-2 lg:flex">
                          {document.page_count ? (
                            <Badge variant="outline">
                              {t.knowledge.pageCount(document.page_count)}
                            </Badge>
                          ) : null}
                          <Badge variant={statusTone(status)}>
                            {statusLabel(status, t)}
                          </Badge>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={() => openDocument(document)}
                        >
                          {t.common.preview}
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </section>

          <Sheet
            open={detailOpen && selectedDocument != null}
            onOpenChange={setDetailOpen}
          >
            {selectedDocument ? (
              <SheetContent
                side="right"
                className="w-[min(94vw,1320px)] gap-0 p-0 sm:max-w-none"
              >
                <SheetTitle className="sr-only">
                  {selectedDocument.display_name}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  {selectedBase
                    ? `${selectedBase.owner_name}/${selectedBase.name}`
                    : (selectedDocument.doc_description ??
                      selectedDocument.display_name)}
                </SheetDescription>
                <div className="grid h-full min-h-0 md:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="bg-muted/30 min-h-0 border-r p-4">
                    <KnowledgePreviewPanel
                      document={selectedDocument}
                      threadId={threadId}
                      canonicalMarkdown={debugQuery.data?.canonical_markdown}
                      focus={effectivePreviewFocus}
                      mode={previewMode}
                      onModeChange={setPreviewMode}
                    />
                  </div>

                  <div className="bg-background flex min-h-0 flex-col">
                    <div className="border-border/60 border-b px-5 py-5 pr-12">
                      <div className={panelLabelClassName}>
                        {selectedBase?.owner_name}/{selectedBase?.name}
                      </div>
                      <h3 className="mt-2 text-2xl font-semibold tracking-tight">
                        {selectedDocument.display_name}
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge
                          variant={statusTone(
                            getKnowledgeDocumentStatus(selectedDocument),
                          )}
                        >
                          {statusLabel(
                            getKnowledgeDocumentStatus(selectedDocument),
                            t,
                          )}
                        </Badge>
                        <Badge variant="outline">
                          {selectedDocument.file_kind}
                        </Badge>
                        {selectedDocument.page_count ? (
                          <Badge variant="outline">
                            {t.knowledge.pageCount(selectedDocument.page_count)}
                          </Badge>
                        ) : null}
                        <Badge variant="outline">
                          {t.knowledge.nodeCount(selectedDocument.node_count)}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-3 text-sm leading-6">
                        {selectedDocument.doc_description ??
                          selectedBase?.description ??
                          activeLibraryDescription}
                      </p>
                    </div>

                    <Tabs
                      value={detailTab}
                      onValueChange={setDetailTab}
                      className="flex min-h-0 flex-1 flex-col"
                    >
                      <TabsList className="bg-muted/60 mx-4 mt-4 grid h-auto grid-cols-4 rounded-2xl p-1">
                        <TabsTrigger value="overview" className="rounded-xl">
                          {t.knowledge.overviewTab}
                        </TabsTrigger>
                        <TabsTrigger value="tree" className="rounded-xl">
                          {t.knowledge.treeTab}
                        </TabsTrigger>
                        <TabsTrigger value="events" className="rounded-xl">
                          {t.knowledge.eventsTab}
                        </TabsTrigger>
                        <TabsTrigger value="index" className="rounded-xl">
                          {t.knowledge.indexTab}
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent
                        value="overview"
                        className="mt-4 min-h-0 flex-1 px-4 pb-4"
                      >
                        <ScrollArea className="h-full rounded-[24px] border">
                          <div className="space-y-4 p-4">
                            <div className="grid gap-3">
                              <div className="border-border/60 bg-muted/20 rounded-[18px] border p-4">
                                <div className={panelLabelClassName}>
                                  {t.knowledge.progressLabel}
                                </div>
                                <div className="mt-3 flex items-center gap-3">
                                  <Progress
                                    className="flex-1"
                                    value={getKnowledgeDocumentProgress(
                                      selectedDocument,
                                    )}
                                  />
                                  <div className="text-sm font-medium">
                                    {getKnowledgeDocumentProgress(
                                      selectedDocument,
                                    )}
                                    %
                                  </div>
                                </div>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="border-border/60 rounded-[18px] border p-4">
                                  <div className={panelLabelClassName}>
                                    {t.knowledge.stageLabel}
                                  </div>
                                  <div className="mt-2 text-sm font-medium">
                                    {selectedDocument.latest_build_job?.stage ??
                                      selectedDocument.status}
                                  </div>
                                </div>
                                <div className="border-border/60 rounded-[18px] border p-4">
                                  <div className={panelLabelClassName}>
                                    {t.knowledge.updatedAtLabel}
                                  </div>
                                  <div className="mt-2 text-sm font-medium">
                                    {formatTimestamp(
                                      selectedDocument.latest_build_job
                                        ?.updated_at ??
                                        selectedDocument.updated_at,
                                    ) || t.knowledge.notAvailable}
                                  </div>
                                </div>
                              </div>

                              <div className="border-border/60 rounded-[18px] border p-4">
                                <div className={panelLabelClassName}>
                                  {t.knowledge.messageLabel}
                                </div>
                                <p className="mt-2 text-sm leading-6">
                                  {selectedDocument.latest_build_job?.message ??
                                    selectedDocument.error ??
                                    t.knowledge.noBuildMessage}
                                </p>
                              </div>

                              {threadId && selectedBase ? (
                                <Button
                                  variant={
                                    selectedBase.attached_to_thread
                                      ? "secondary"
                                      : "outline"
                                  }
                                  className="w-full rounded-2xl"
                                  disabled={
                                    bindingBusyBaseId === selectedBase.id
                                  }
                                  onClick={() =>
                                    void handleBinding(
                                      selectedBase,
                                      !selectedBase.attached_to_thread,
                                    )
                                  }
                                >
                                  {selectedBase.attached_to_thread
                                    ? t.knowledge.detach
                                    : t.knowledge.attach}
                                </Button>
                              ) : null}

                              {selectedBase != null &&
                              selectedBase.owner_id === user?.id ? (
                                <div className="border-border/60 bg-muted/20 flex items-center justify-between rounded-[18px] border p-4">
                                  <div>
                                    <div className="text-sm font-medium">
                                      {t.knowledge.previewSetting}
                                    </div>
                                    <div className="text-muted-foreground mt-1 text-xs leading-5">
                                      {t.knowledge.previewSettingHint}
                                    </div>
                                  </div>
                                  <Switch
                                    checked={selectedBase.preview_enabled}
                                    disabled={
                                      settingsBusyBaseId === selectedBase.id
                                    }
                                    onCheckedChange={(checked) =>
                                      void handlePreviewSetting(
                                        selectedBase,
                                        checked,
                                      )
                                    }
                                  />
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      <TabsContent
                        value="tree"
                        className="mt-4 min-h-0 flex-1 px-4 pb-4"
                      >
                        <div className="border-border/60 bg-muted/20 h-full overflow-hidden rounded-[24px] border">
                          <ScrollArea className="h-full">
                            <div className="space-y-4 p-4">
                              {getKnowledgeDocumentStatus(selectedDocument) !==
                              "ready" ? (
                                <div className="text-muted-foreground text-sm">
                                  {t.knowledge.treePending}
                                </div>
                              ) : treeQuery.isLoading ? (
                                <div className="text-muted-foreground text-sm">
                                  {t.knowledge.loadingTree}
                                </div>
                              ) : treeQuery.error instanceof Error ? (
                                <div className="text-sm text-red-500">
                                  {treeQuery.error.message}
                                </div>
                              ) : (treeQuery.data?.length ?? 0) === 0 ? (
                                <div className="text-muted-foreground text-sm">
                                  {t.knowledge.emptyTree}
                                </div>
                              ) : (
                                treeQuery.data?.map((node) => (
                                  <TreeNodeView
                                    key={node.node_id}
                                    node={node}
                                    activeNodeId={effectivePreviewFocus?.nodeId}
                                    onSelectNode={handleNodeFocus}
                                  />
                                ))
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </TabsContent>

                      <TabsContent
                        value="events"
                        className="mt-4 min-h-0 flex-1 px-4 pb-4"
                      >
                        <div className="border-border/60 bg-muted/20 h-full overflow-hidden rounded-[24px] border">
                          <ScrollArea className="h-full">
                            <div className="space-y-4 p-4">
                              {eventsQuery.isLoading ? (
                                <div className="text-muted-foreground text-sm">
                                  {t.knowledge.loadingEvents}
                                </div>
                              ) : eventsQuery.error instanceof Error ? (
                                <div className="text-sm text-red-500">
                                  {eventsQuery.error.message}
                                </div>
                              ) : (eventsQuery.data?.events.length ?? 0) ===
                                0 ? (
                                <div className="text-muted-foreground text-sm">
                                  {t.knowledge.emptyEvents}
                                </div>
                              ) : (
                                eventsQuery.data?.events.map((event) => (
                                  <div
                                    key={event.id}
                                    className="border-border/60 bg-background rounded-[18px] border p-4"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="outline">
                                        {event.stage}
                                      </Badge>
                                      <Badge variant={statusTone(event.status)}>
                                        {event.status}
                                      </Badge>
                                      <div className="text-sm font-semibold">
                                        {event.step_name}
                                      </div>
                                    </div>
                                    {event.message ? (
                                      <div className="mt-3 text-sm leading-6">
                                        {event.message}
                                      </div>
                                    ) : null}
                                    <div className="text-muted-foreground mt-3 flex flex-wrap gap-3 text-xs">
                                      {event.elapsed_ms != null ? (
                                        <span>{event.elapsed_ms} ms</span>
                                      ) : null}
                                      {event.input_tokens != null ? (
                                        <span>in {event.input_tokens}</span>
                                      ) : null}
                                      {event.output_tokens != null ? (
                                        <span>out {event.output_tokens}</span>
                                      ) : null}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </TabsContent>

                      <TabsContent
                        value="index"
                        className="mt-4 min-h-0 flex-1 px-4 pb-4"
                      >
                        <div className="border-border/60 bg-muted/20 h-full overflow-hidden rounded-[24px] border">
                          <ScrollArea className="h-full">
                            <div className="p-4">
                              {debugQuery.isLoading ? (
                                <div className="text-muted-foreground text-sm">
                                  {t.knowledge.loadingDebug}
                                </div>
                              ) : debugQuery.error instanceof Error ? (
                                <div className="text-sm text-red-500">
                                  {debugQuery.error.message}
                                </div>
                              ) : (
                                <JsonInspector
                                  value={
                                    debugQuery.data?.document_index_json ?? {}
                                  }
                                />
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>
              </SheetContent>
            ) : null}
          </Sheet>
        </div>
      </WorkspaceBody>
      <Dialog
        open={deleteBaseTarget != null}
        onOpenChange={(open) => {
          if (!open && deletingBaseId == null) {
            setDeleteBaseTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.knowledge.deleteTitle}</DialogTitle>
            <DialogDescription>
              {deleteBaseTarget
                ? t.knowledge.deleteDescription(deleteBaseTarget.name)
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteBaseTarget(null)}
              disabled={deletingBaseId != null}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteBase()}
              disabled={deletingBaseId != null}
            >
              {deletingBaseId != null ? (
                <LoaderIcon className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2Icon className="mr-2 size-4" />
              )}
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceContainer>
  );
}
