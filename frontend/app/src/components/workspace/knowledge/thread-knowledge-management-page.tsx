import {
  ArrowRightIcon,
  BookOpenTextIcon,
  ChevronRightIcon,
  Code2Icon,
  type LucideIcon,
  EyeIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilesIcon,
  FolderIcon,
  LoaderIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { openArtifactInNewWindow } from "@/core/artifacts/actions";
import { useArtifactObjectUrl } from "@/core/artifacts/hooks";
import { setPdfPreviewPage } from "@/core/artifacts/pdf";
import { useAuth } from "@/core/auth/hooks";
import {
  attachKnowledgeBaseToThread,
  detachKnowledgeBaseFromThread,
  updateKnowledgeBaseSettings,
} from "@/core/knowledge/api";
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { cn } from "@/lib/utils";

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

function documentStatus(document: KnowledgeDocument) {
  return document.latest_build_job?.status ?? document.status;
}

function documentProgress(document: KnowledgeDocument) {
  const status = documentStatus(document);
  if (status === "ready") {
    return 100;
  }
  return document.latest_build_job?.progress_percent ?? 0;
}

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

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  return (
    (isRuntimeArtifactPath(candidate)
      ? candidate
      : null) ??
    null
  );
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

function normalizeOutlineNode(value: unknown): KnowledgeTreeNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title =
    typeof record.title === "string" && record.title.trim().length > 0
      ? record.title
      : null;
  if (!title) {
    return null;
  }
  const nestedNodes = normalizeOutlineNodes(record.nodes);
  const childCount =
    numberOrUndefined(record.child_count) ??
    (nestedNodes.length > 0 ? nestedNodes.length : undefined);
  return {
    node_id:
      typeof record.node_id === "string" && record.node_id.trim().length > 0
        ? record.node_id
        : `${title}-${numberOrUndefined(record.page_start) ?? numberOrUndefined(record.line_start) ?? 0}`,
    title,
    depth: numberOrUndefined(record.depth),
    child_count: childCount,
    locator_type:
      record.locator_type === "heading" || record.heading_slug != null
        ? "heading"
        : "page",
    page_start: numberOrUndefined(record.page_start),
    page_end: numberOrUndefined(record.page_end),
    line_start: numberOrUndefined(record.line_start),
    line_end: numberOrUndefined(record.line_end),
    heading_slug:
      typeof record.heading_slug === "string"
        ? record.heading_slug
        : undefined,
    summary:
      typeof record.summary === "string" ? record.summary : undefined,
    prefix_summary:
      typeof record.prefix_summary === "string"
        ? record.prefix_summary
        : undefined,
    nodes: nestedNodes.length > 0 ? nestedNodes : undefined,
  };
}

function normalizeOutlineNodes(value: unknown): KnowledgeTreeNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeOutlineNode(item))
    .filter((item): item is KnowledgeTreeNode => item !== null);
}

function extractIndexOutlineNodes(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  return normalizeOutlineNodes(record.structure ?? record.nodes);
}

function findFocusLineIndex(lines: string[], focus: KnowledgePreviewFocus | null) {
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

function ExplorerPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[28px] border border-border/70 bg-background/85 shadow-[0_28px_90px_-52px_rgba(15,23,42,0.5)] backdrop-blur",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.1),transparent_36%)]" />
      <div className="relative">{children}</div>
    </section>
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
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-8 py-16 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_34%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.07),transparent_28%)]" />
      <div className="relative">
        <div className="absolute -top-4 -left-10 rounded-full border border-border/60 bg-background/75 px-4 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {t.knowledge.treeTab}
        </div>
        <div className="absolute -right-12 -bottom-5 rounded-full border border-border/60 bg-background/75 px-4 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {t.common.preview}
        </div>
        <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-[22px] shadow-[0_18px_48px_-28px_rgba(59,130,246,0.7)]">
          <Icon className="size-7" />
        </div>
      </div>
      <h2 className="mt-6 text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-3 max-w-md text-sm leading-7">
        {description}
      </p>
    </div>
  );
}

function LibraryStat({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="border-border/70 bg-background/70 flex items-center gap-3 rounded-[20px] border px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_20px_45px_-35px_rgba(59,130,246,0.8)]">
      <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 hover:scale-105">
        <Icon className="size-4" />
      </div>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function DetailMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="border-border/60 bg-background/65 rounded-[20px] border px-4 py-3">
      <div className={panelLabelClassName}>{label}</div>
      <div className="mt-2 text-sm font-medium leading-6">{value}</div>
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
            : "border-border/60 bg-background/70 hover:-translate-y-0.5 hover:bg-background/85",
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
      <div className="rounded-[22px] border border-border/60 bg-muted/25 p-3 font-mono text-xs leading-6 shadow-inner">
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
              <div className="text-right text-[11px] text-muted-foreground">
                {lineNumber}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">
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
  const hasBinaryPreview = Boolean(document && isPdfPreviewDocument(document));
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
  const activePreviewLoading = threadId ? previewLoading : visiblePreviewLoading;
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
      if (!threadId && effectiveMode === "canonical" && compareContent.trim().length > 0) {
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
          ? textPath ?? binaryPath
          : binaryPath ?? textPath;
      if (!filepath) {
        return;
      }
      await openArtifactInNewWindow({
        filepath,
        threadId,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.previewUnavailable);
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
                  ? (!textPath && !binaryPath)
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
              <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
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
  const [previewFocus, setPreviewFocus] = useState<KnowledgePreviewFocus | null>(
    null,
  );

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
    if (filteredKnowledgeBases.length === 0) {
      setSelectedBaseId(null);
      return;
    }
    if (
      selectedBaseId == null ||
      !filteredKnowledgeBases.some(
        (knowledgeBase) => knowledgeBase.id === selectedBaseId,
      )
    ) {
      setSelectedBaseId(filteredKnowledgeBases[0]?.id ?? null);
    }
  }, [filteredKnowledgeBases, selectedBaseId]);

  const selectedBase =
    filteredKnowledgeBases.find(
      (knowledgeBase) => knowledgeBase.id === selectedBaseId,
    ) ?? null;

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
    selectedBaseDocuments.find((document) => document.id === selectedDocumentId) ??
    null;
  const selectedDocumentReady =
    selectedDocument != null && documentStatus(selectedDocument) === "ready";

  useEffect(() => {
    if (!selectedDocument) {
      setPreviewFocus(null);
      return;
    }
    setPreviewFocus(null);
    setPreviewMode(
      selectedDocument.locator_type === "heading" ? "canonical" : "preview",
    );
  }, [selectedDocument?.id, selectedDocument?.locator_type]);

  const treeQuery = useVisibleKnowledgeDocumentTree(
    selectedDocument?.id,
    selectedDocumentReady,
  );
  const eventsQuery = useVisibleKnowledgeDocumentBuildEvents(selectedDocument);
  const debugQuery = useKnowledgeDocumentDebug(
    selectedDocument?.id,
    Boolean(selectedDocument),
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

  const indexOutlineNodes = useMemo(
    () => extractIndexOutlineNodes(debugQuery.data?.document_index_json),
    [debugQuery.data?.document_index_json],
  );

  const totalDocumentCount = documents.length;
  const readyCount = documents.filter(
    (document) => documentStatus(document) === "ready",
  ).length;
  const activeCount = documents.filter((document) => {
    const status = documentStatus(document);
    return status === "queued" || status === "processing";
  }).length;
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

  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody>
        <div className="relative flex size-full flex-col overflow-hidden p-4 md:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_30%)]" />

          <div className="relative flex min-h-0 flex-1 flex-col gap-4">
            <ExplorerPanel>
              <div className="flex flex-col gap-6 px-6 py-6 md:px-8">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-3xl space-y-3">
                    <div className={panelLabelClassName}>
                      {t.knowledge.sectionTitle}
                    </div>
                    <div className="space-y-2">
                      <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">
                        {managerTitle}
                      </h1>
                      <p className="text-muted-foreground max-w-2xl text-sm leading-7 md:text-base">
                        {managerDescription}
                      </p>
                    </div>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    className="rounded-full px-5"
                  >
                    <Link to={chatPath}>
                      {isThreadScoped
                        ? t.knowledge.backToChat
                        : t.knowledge.backToAgents}
                      <ArrowRightIcon className="size-4" />
                    </Link>
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <LibraryStat
                    icon={FilesIcon}
                    label={t.knowledge.documentCount(totalDocumentCount)}
                  />
                  <LibraryStat
                    icon={SparklesIcon}
                    label={t.knowledge.readyCount(readyCount)}
                  />
                  <LibraryStat
                    icon={LoaderIcon}
                    label={t.knowledge.activeCount(activeCount)}
                  />
                  <LibraryStat
                    icon={BookOpenTextIcon}
                    label={
                      isThreadScoped
                        ? t.knowledge.attachedBaseCount(attachedBaseCount)
                        : t.knowledge.baseCount(filteredKnowledgeBases.length)
                    }
                  />
                </div>
              </div>
            </ExplorerPanel>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[300px_360px_minmax(0,1fr)]">
              <ExplorerPanel className="min-h-0">
                <div className="border-border/60 border-b px-5 py-5">
                  <div className={panelLabelClassName}>
                    {t.knowledge.libraryTitle}
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm leading-6">
                    {activeLibraryDescription}
                  </p>
                  <div className="relative mt-4">
                    <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t.knowledge.searchPlaceholder}
                      className="h-11 rounded-full border-border/70 bg-background/80 pl-10"
                    />
                  </div>
                </div>

                <ScrollArea className="h-[calc(100vh-21rem)]">
                  <div className="space-y-5 p-4">
                    {isLoading ? (
                      <div className="text-muted-foreground text-sm">
                        {t.knowledge.loadingLibrary}
                      </div>
                    ) : groupedBases.length === 0 ? (
                      <ExplorerEmptyState
                        icon={FolderIcon}
                        title={t.knowledge.emptyLibrary}
                        description={activeLibraryDescription}
                      />
                    ) : (
                      groupedBases.map((group) => (
                        <section key={group.ownerName} className="space-y-3">
                          <div className="border-border/50 bg-muted/25 flex items-center gap-3 rounded-[18px] border px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                            <div className="bg-background/85 text-primary flex size-8 items-center justify-center rounded-xl border border-border/60 shadow-sm">
                              <FolderIcon className="size-4" />
                            </div>
                              <div className="min-w-0">
                              <div className="font-mono text-[12px] font-semibold tracking-[0.2em] text-foreground/85">
                                {group.ownerName}/
                              </div>
                              <div className="text-muted-foreground text-[11px]">
                                {t.knowledge.baseCount(group.bases.length)}
                              </div>
                            </div>
                          </div>

                          <div className="border-border/40 ml-5 space-y-2 border-l border-dashed pl-4">
                            {group.bases.map((knowledgeBase) => {
                              const isSelected =
                                knowledgeBase.id === selectedBase?.id;
                              const readyDocuments = knowledgeBase.documents.filter(
                                (document) =>
                                  documentStatus(document) === "ready",
                              ).length;
                              const activeDocuments = knowledgeBase.documents.filter(
                                (document) => {
                                  const status = documentStatus(document);
                                  return (
                                    status === "queued" ||
                                    status === "processing"
                                  );
                                },
                              ).length;

                              return (
                                <div
                                  key={knowledgeBase.id}
                                  className={cn(
                                    "relative rounded-[22px] border p-3 transition-all duration-200 before:absolute before:-left-[1.05rem] before:top-8 before:size-2.5 before:rounded-full before:border before:border-border/70 before:bg-background before:shadow-sm",
                                    isSelected
                                      ? "border-primary/40 bg-primary/6 shadow-[0_18px_48px_-34px_rgba(59,130,246,0.7)] before:border-primary/40 before:bg-primary/15"
                                      : "border-border/60 bg-background/60 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-background/85",
                                  )}
                                >
                                  <button
                                    type="button"
                                    className="w-full text-left"
                                    onClick={() => {
                                      setSelectedBaseId(knowledgeBase.id);
                                      setSelectedDocumentId(
                                        knowledgeBase.documents[0]?.id ?? null,
                                      );
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-3">
                                          <div className="bg-amber-500/10 text-amber-600 dark:text-amber-400 flex size-9 shrink-0 items-center justify-center rounded-2xl border border-amber-500/15">
                                            <FolderIcon className="size-4" />
                                          </div>
                                          <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold">
                                              {knowledgeBase.name}
                                            </div>
                                            <div className="text-muted-foreground mt-1 font-mono text-[11px] tracking-[0.14em]">
                                              {group.ownerName}/{knowledgeBase.name}
                                            </div>
                                          </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                          <span
                                            className={cn(
                                              "size-2 rounded-full",
                                              knowledgeBase.attached_to_thread
                                                ? "bg-emerald-500"
                                                : "bg-muted-foreground/30",
                                            )}
                                          />
                                          <span className="text-muted-foreground">
                                            {visibilityLabel(
                                              knowledgeBase.visibility,
                                              t,
                                            )}{" "}
                                            ·{" "}
                                            {knowledgeBase.preview_enabled
                                              ? t.knowledge.previewEnabled
                                              : t.knowledge.previewDisabled}
                                          </span>
                                        </div>
                                        {knowledgeBase.description ? (
                                          <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-5">
                                            {knowledgeBase.description}
                                          </p>
                                        ) : null}
                                      </div>
                                      <ChevronRightIcon
                                        className={cn(
                                          "text-muted-foreground mt-1 size-4 shrink-0 transition-transform",
                                          isSelected && "text-primary translate-x-0.5",
                                        )}
                                      />
                                    </div>
                                  </button>

                                  <div className="mt-4 flex flex-wrap gap-2">
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
                                        {t.knowledge.activeCount(
                                          activeDocuments,
                                        )}
                                      </Badge>
                                    ) : null}
                                  </div>

                                  <div className="border-border/40 mt-4 space-y-2 border-l border-dashed pl-3">
                                    {knowledgeBase.documents.slice(0, 3).map((document) => (
                                      <div
                                        key={document.id}
                                        className="bg-background/65 flex items-center gap-2 rounded-xl border border-border/50 px-2.5 py-2 text-xs text-muted-foreground"
                                      >
                                        <FileTextIcon className="size-3.5 shrink-0" />
                                        <span className="truncate font-mono text-[11px]">
                                          {document.display_name}
                                        </span>
                                      </div>
                                    ))}
                                  </div>

                                  {threadId ? (
                                    <div className="mt-4 flex items-center justify-end gap-3">
                                      <Button
                                        size="sm"
                                        variant={
                                          knowledgeBase.attached_to_thread
                                            ? "secondary"
                                            : "outline"
                                        }
                                        disabled={
                                          bindingBusyBaseId === knowledgeBase.id
                                        }
                                        className="rounded-full"
                                        onClick={() =>
                                          void handleBinding(
                                            knowledgeBase,
                                            !knowledgeBase.attached_to_thread,
                                          )
                                        }
                                      >
                                        {bindingBusyBaseId ===
                                        knowledgeBase.id ? (
                                          <LoaderIcon className="size-4 animate-spin" />
                                        ) : knowledgeBase.attached_to_thread ? (
                                          t.knowledge.detach
                                        ) : (
                                          t.knowledge.attach
                                        )}
                                      </Button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </ExplorerPanel>

              <ExplorerPanel className="min-h-0">
                <div className="border-border/60 border-b px-5 py-5">
                  <div className={panelLabelClassName}>
                    {t.knowledge.manageButton}
                  </div>
                  {selectedBase == null ? (
                    <div className="mt-3 space-y-2">
                      <div className="text-lg font-semibold">
                        {t.knowledge.noDocumentSelectedTitle}
                      </div>
                      <p className="text-muted-foreground text-sm leading-6">
                        {t.knowledge.noDocumentSelectedDescription}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-4">
                      <div className="space-y-2">
                        <div className="text-muted-foreground font-mono text-[11px] tracking-[0.2em]">
                          {selectedBase.owner_name}/{selectedBase.name}
                        </div>
                        <h2 className="font-serif text-2xl font-semibold tracking-tight">
                          {selectedBase.name}
                        </h2>
                        <p className="text-muted-foreground text-sm leading-6">
                          {selectedBase.description ||
                            activeLibraryDescription}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {visibilityLabel(selectedBase.visibility, t)}
                        </Badge>
                        <Badge variant="outline">
                          {selectedBase.preview_enabled
                            ? t.knowledge.previewEnabled
                            : t.knowledge.previewDisabled}
                        </Badge>
                        <Badge variant="outline">
                          {t.knowledge.documentCount(
                            selectedBase.documents.length,
                          )}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>

                <ScrollArea className="h-[calc(100vh-21rem)]">
                  <div className="space-y-3 p-4">
                    {selectedBaseDocuments.length === 0 ? (
                      <ExplorerEmptyState
                        icon={FileTextIcon}
                        title={t.knowledge.noDocumentSelectedTitle}
                        description={t.knowledge.noDocumentSelectedDescription}
                      />
                    ) : (
                      selectedBaseDocuments.map((document) => {
                        const active = document.id === selectedDocumentId;
                        const status = documentStatus(document);

                        return (
                          <button
                            key={document.id}
                            type="button"
                            className={cn(
                              "group w-full rounded-[24px] border p-4 text-left transition-all duration-200",
                              active
                                ? "border-primary/40 bg-primary/6 shadow-[0_20px_56px_-36px_rgba(59,130,246,0.7)]"
                                : "border-border/60 bg-background/60 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-background/85",
                            )}
                            onClick={() => setSelectedDocumentId(document.id)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-2xl border border-primary/10 transition-transform duration-200 group-hover:scale-105">
                                    <FileTextIcon className="size-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold md:text-base">
                                      {document.display_name}
                                    </div>
                                    <div className="text-muted-foreground mt-1 font-mono text-[11px] tracking-[0.14em]">
                                      {document.owner_name}/{document.knowledge_base_name}/{document.display_name}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Badge variant="outline">
                                    {document.file_kind}
                                  </Badge>
                                  <Badge variant="outline">
                                    {document.locator_type}
                                  </Badge>
                                </div>
                                {document.doc_description ? (
                                  <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-6">
                                    {document.doc_description}
                                  </p>
                                ) : null}
                              </div>
                              <Badge variant={statusTone(status)}>
                                {statusLabel(status, t)}
                              </Badge>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {document.page_count ? (
                                <Badge variant="outline">
                                  {t.knowledge.pageCount(document.page_count)}
                                </Badge>
                              ) : null}
                              <Badge variant="outline">
                                {t.knowledge.nodeCount(document.node_count)}
                              </Badge>
                              {document.attached_to_thread ? (
                                <Badge variant="secondary">
                                  {t.knowledge.attached}
                                </Badge>
                              ) : null}
                            </div>

                            {status !== "ready" ? (
                              <div className="mt-4 space-y-2">
                                <Progress value={documentProgress(document)} />
                                <div className="text-muted-foreground text-xs">
                                  {document.latest_build_job?.stage ?? status}
                                </div>
                              </div>
                            ) : (
                              <div className="text-muted-foreground mt-4 text-xs">
                                {formatTimestamp(document.updated_at) ||
                                  t.knowledge.notAvailable}
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </ExplorerPanel>

              <div className="flex min-h-0 flex-col gap-4">
                {selectedDocument == null || selectedBase == null ? (
                  <ExplorerPanel className="flex-1">
                    <ExplorerEmptyState
                      icon={BookOpenTextIcon}
                      title={t.knowledge.noDocumentSelectedTitle}
                      description={t.knowledge.noDocumentSelectedDescription}
                    />
                  </ExplorerPanel>
                ) : (
                  <>
                    <ExplorerPanel>
                      <div className="space-y-5 px-5 py-5">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-3">
                            <div className={panelLabelClassName}>
                              {t.knowledge.buildProgressTitle}
                            </div>
                            <div className="space-y-2">
                              <h2 className="font-serif text-2xl font-semibold tracking-tight md:text-3xl">
                                {selectedDocument.display_name}
                              </h2>
                              <p className="text-muted-foreground text-sm leading-6">
                                {selectedDocument.owner_name} /{" "}
                                {selectedDocument.knowledge_base_name} /{" "}
                                {visibilityLabel(selectedDocument.visibility, t)}
                                {selectedDocument.doc_description
                                  ? ` / ${selectedDocument.doc_description}`
                                  : ""}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge
                                variant={statusTone(
                                  documentStatus(selectedDocument),
                                )}
                              >
                                {statusLabel(documentStatus(selectedDocument), t)}
                              </Badge>
                              <Badge variant="outline">
                                {selectedDocument.file_kind}
                              </Badge>
                              {selectedDocument.page_count ? (
                                <Badge variant="outline">
                                  {t.knowledge.pageCount(
                                    selectedDocument.page_count,
                                  )}
                                </Badge>
                              ) : null}
                              <Badge variant="outline">
                                {t.knowledge.nodeCount(
                                  selectedDocument.node_count,
                                )}
                              </Badge>
                              {effectivePreviewFocus?.locatorLabel ? (
                                <Badge variant="secondary">
                                  {effectivePreviewFocus.locatorLabel}
                                </Badge>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-col gap-3 lg:items-end">
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
                              <div className="border-border/60 bg-background/65 flex items-center gap-3 rounded-[18px] border px-3 py-2">
                                <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-2xl">
                                  <EyeIcon className="size-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">
                                    {t.knowledge.previewSetting}
                                  </div>
                                  <div className="text-muted-foreground max-w-64 text-xs leading-5">
                                    {t.knowledge.previewSettingHint}
                                  </div>
                                </div>
                                <Switch
                                  checked={selectedBase.preview_enabled}
                                  disabled={settingsBusyBaseId === selectedBase.id}
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

                        <div className="space-y-3">
                          <Progress value={documentProgress(selectedDocument)} />
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <DetailMetric
                              label={t.knowledge.stageLabel}
                              value={
                                selectedDocument.latest_build_job?.stage ??
                                selectedDocument.status
                              }
                            />
                            <DetailMetric
                              label={t.knowledge.progressLabel}
                              value={`${documentProgress(selectedDocument)}%`}
                            />
                            <DetailMetric
                              label={t.knowledge.elapsedLabel}
                              value={
                                formatElapsed(
                                  selectedDocument.latest_build_job?.started_at,
                                  selectedDocument.latest_build_job?.finished_at,
                                ) || t.knowledge.notAvailable
                              }
                            />
                            <DetailMetric
                              label={t.knowledge.updatedAtLabel}
                              value={
                                formatTimestamp(
                                  selectedDocument.latest_build_job
                                    ?.updated_at ?? selectedDocument.updated_at,
                                ) || t.knowledge.notAvailable
                              }
                            />
                          </div>
                          <DetailMetric
                            label={t.knowledge.messageLabel}
                            value={
                              selectedDocument.latest_build_job?.message ??
                              selectedDocument.error ??
                              t.knowledge.noBuildMessage
                            }
                          />
                        </div>
                      </div>
                    </ExplorerPanel>

                    <ExplorerPanel className="min-h-0 flex-1 overflow-hidden">
                      <div className="grid h-full min-h-0 gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
                        <Tabs
                          key={selectedDocument.id}
                          defaultValue="tree"
                          className="flex h-full min-h-0 flex-col"
                        >
                          <TabsList className="grid h-auto grid-cols-4 rounded-[20px] bg-muted/70 p-1">
                            <TabsTrigger
                              value="tree"
                              className="rounded-2xl data-[state=active]:shadow-sm"
                            >
                              {t.knowledge.treeTab}
                            </TabsTrigger>
                            <TabsTrigger
                              value="events"
                              className="rounded-2xl data-[state=active]:shadow-sm"
                            >
                              {t.knowledge.eventsTab}
                            </TabsTrigger>
                            <TabsTrigger
                              value="index"
                              className="rounded-2xl data-[state=active]:shadow-sm"
                            >
                              {t.knowledge.indexTab}
                            </TabsTrigger>
                            <TabsTrigger
                              value="canonical"
                              className="rounded-2xl data-[state=active]:shadow-sm"
                            >
                              {t.knowledge.canonicalTab}
                            </TabsTrigger>
                          </TabsList>

                          <TabsContent value="tree" className="mt-4 min-h-0 flex-1">
                            <div className="border-border/60 bg-background/55 h-full overflow-hidden rounded-[24px] border">
                              <ScrollArea className="h-[calc(100vh-36rem)]">
                                <div className="space-y-4 p-4">
                                  {documentStatus(selectedDocument) !== "ready" ? (
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
                            className="mt-4 min-h-0 flex-1"
                          >
                            <div className="border-border/60 bg-background/55 h-full overflow-hidden rounded-[24px] border">
                              <ScrollArea className="h-[calc(100vh-36rem)]">
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
                                        className="border-border/60 bg-background/75 rounded-[22px] border p-4 shadow-sm"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="outline">
                                            {event.stage}
                                          </Badge>
                                          <Badge
                                            variant={statusTone(event.status)}
                                          >
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
                                          {event.retry_count != null ? (
                                            <span>retry {event.retry_count}</span>
                                          ) : null}
                                        </div>
                                        {event.created_at ? (
                                          <div className="text-muted-foreground mt-2 text-xs">
                                            {formatTimestamp(event.created_at)}
                                          </div>
                                        ) : null}
                                      </div>
                                    ))
                                  )}
                                </div>
                              </ScrollArea>
                            </div>
                          </TabsContent>

                          <TabsContent value="index" className="mt-4 min-h-0 flex-1">
                            <div className="border-border/60 bg-muted/30 h-full overflow-hidden rounded-[24px] border">
                              <ScrollArea className="h-[calc(100vh-36rem)]">
                                <div className="space-y-4 p-4">
                                  {indexOutlineNodes.length > 0 ? (
                                    <div className="space-y-4">
                                      {indexOutlineNodes.map((node) => (
                                        <TreeNodeView
                                          key={node.node_id}
                                          node={node}
                                          activeNodeId={effectivePreviewFocus?.nodeId}
                                          onSelectNode={handleNodeFocus}
                                        />
                                      ))}
                                    </div>
                                  ) : null}
                                  <pre className="overflow-x-auto rounded-[20px] border border-border/60 bg-background/65 p-4 text-xs leading-6 whitespace-pre-wrap">
                                    {debugQuery.isLoading
                                      ? t.knowledge.loadingDebug
                                      : debugQuery.error instanceof Error
                                        ? debugQuery.error.message
                                        : JSON.stringify(
                                            debugQuery.data?.document_index_json ??
                                              {},
                                            null,
                                            2,
                                          )}
                                  </pre>
                                </div>
                              </ScrollArea>
                            </div>
                          </TabsContent>

                          <TabsContent
                            value="canonical"
                            className="mt-4 min-h-0 flex-1"
                          >
                            <div className="border-border/60 bg-muted/30 h-full overflow-hidden rounded-[24px] border">
                              <ScrollArea className="h-[calc(100vh-36rem)]">
                                <pre className="overflow-x-auto p-4 text-xs leading-6 whitespace-pre-wrap">
                                  {debugQuery.isLoading
                                    ? t.knowledge.loadingDebug
                                    : debugQuery.error instanceof Error
                                      ? debugQuery.error.message
                                      : (debugQuery.data?.canonical_markdown ??
                                        t.knowledge.emptyCanonical)}
                                </pre>
                              </ScrollArea>
                            </div>
                          </TabsContent>
                        </Tabs>

                        <KnowledgePreviewPanel
                          document={selectedDocument}
                          threadId={threadId}
                          canonicalMarkdown={debugQuery.data?.canonical_markdown}
                          focus={effectivePreviewFocus}
                          mode={previewMode}
                          onModeChange={setPreviewMode}
                        />
                      </div>
                    </ExplorerPanel>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
