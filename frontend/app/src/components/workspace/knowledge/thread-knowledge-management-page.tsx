import "@react-sigma/core/lib/style.css";
import {
  SigmaContainer,
  useLoadGraph,
  useRegisterEvents,
  useSigma,
} from "@react-sigma/core";
import { useQueryClient } from "@tanstack/react-query";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  ArrowRightIcon,
  AlertTriangleIcon,
  BookOpenIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FileTextIcon,
  FilterIcon,
  FolderIcon,
  HouseIcon,
  LightbulbIcon,
  LayersIcon,
  LoaderIcon,
  MaximizeIcon,
  NetworkIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  TagIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { MessageResponse } from "@/components/ai-elements/message";
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
import { useAuth } from "@/core/auth/hooks";
import { useI18n } from "@/core/i18n/hooks";
import {
  attachKnowledgeBaseToThread,
  clearKnowledgeBases,
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
  useKnowledgeWorkspaceFile,
  useKnowledgeWorkspaceGraph,
  useKnowledgeWorkspaceTree,
  useVisibleKnowledgeDocumentBuildEvents,
  useVisibleKnowledgeDocumentTree,
} from "@/core/knowledge/hooks";
import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeWorkspaceFileNode,
  KnowledgeWorkspaceGraphNode,
  KnowledgeWorkspaceGraphResponse,
  KnowledgeTreeNode,
} from "@/core/knowledge/types";
import { streamdownPlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

import { JsonInspector } from "./json-inspector";
import { KnowledgeBaseUploadDialog } from "./knowledge-base-upload-dialog";
import {
  ExplorerEmptyState,
  KnowledgePreviewPanel,
} from "./knowledge-preview-panel";
import { locatorLabel, TreeNodeView } from "./tree-node-view";

export type LibraryDocumentView = KnowledgeDocument & {
  owner_id: string;
  owner_name: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  knowledge_base_description?: string;
  attached_to_thread: boolean;
  visibility: string;
  preview_enabled: boolean;
};

type KnowledgeOwnerGroup = {
  ownerId: string;
  ownerName: string;
  bases: KnowledgeBase[];
};

type KnowledgeClearTarget = {
  ownerId: string;
  ownerName: string;
  baseCount: number;
};

type BaseWorkbenchTab = "wiki" | "graph";

export type KnowledgePreviewMode = "preview" | "canonical";

export type KnowledgePreviewFocus = {
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
  "text-muted-foreground text-xs font-medium";

type KnowledgeI18n = ReturnType<typeof useI18n>["t"];

// URL query params are a navigation source of truth. During a base/document
// jump, React effects still see the previous selected state for one render, so
// the URL writer must wait until the reader effect has reconciled selection.
export function shouldDeferKnowledgeSelectionUrlSync({
  isLoading,
  knowledgeBases,
  ownerGroups,
  searchParams,
  selectedOwnerId,
  selectedBaseId,
  selectedDocumentId,
  hasLocalSelectionChange = false,
}: {
  isLoading: boolean;
  knowledgeBases: KnowledgeBase[];
  ownerGroups: Pick<KnowledgeOwnerGroup, "ownerId">[];
  searchParams: URLSearchParams;
  selectedOwnerId: string | null;
  selectedBaseId: string | null;
  selectedDocumentId: string | null;
  hasLocalSelectionChange?: boolean;
}) {
  if (hasLocalSelectionChange) {
    return false;
  }

  if (isLoading) {
    return true;
  }

  const requestedDocumentId = searchParams.get("document");
  if (
    requestedDocumentId &&
    requestedDocumentId !== selectedDocumentId &&
    knowledgeBases.some((knowledgeBase) =>
      knowledgeBase.documents.some(
        (document) => document.id === requestedDocumentId,
      ),
    )
  ) {
    return true;
  }

  const requestedBaseId = searchParams.get("base");
  if (
    requestedBaseId &&
    requestedBaseId !== selectedBaseId &&
    knowledgeBases.some((knowledgeBase) => knowledgeBase.id === requestedBaseId)
  ) {
    return true;
  }

  const requestedOwnerId = searchParams.get("owner");
  if (
    requestedOwnerId &&
    requestedOwnerId !== selectedOwnerId &&
    ownerGroups.some((group) => group.ownerId === requestedOwnerId)
  ) {
    return true;
  }

  return false;
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

function statusLabel(status: string, t: KnowledgeI18n) {
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
  t: KnowledgeI18n,
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

function knowledgeBaseContextLabel(knowledgeBase: KnowledgeBase) {
  const primaryDocument = knowledgeBase.documents[0]?.display_name;
  if (!primaryDocument) {
    return null;
  }

  if (knowledgeBase.documents.length === 1) {
    return primaryDocument;
  }

  return `${primaryDocument} +${knowledgeBase.documents.length - 1}`;
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

function toLibraryDocumentView(
  knowledgeBase: KnowledgeBase,
  document: KnowledgeDocument,
): LibraryDocumentView {
  return {
    ...document,
    owner_id: knowledgeBase.owner_id,
    owner_name: knowledgeBase.owner_name,
    knowledge_base_id: knowledgeBase.id,
    knowledge_base_name: knowledgeBase.name,
    knowledge_base_description: knowledgeBase.description,
    attached_to_thread: knowledgeBase.attached_to_thread,
    visibility: knowledgeBase.visibility,
    preview_enabled: knowledgeBase.preview_enabled,
  };
}

function buildPreviewFocusFromNode(
  node: KnowledgeTreeNode,
  t: KnowledgeI18n,
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

function flattenWorkspaceFiles(nodes: KnowledgeWorkspaceFileNode[]) {
  const files: KnowledgeWorkspaceFileNode[] = [];
  const visit = (node: KnowledgeWorkspaceFileNode) => {
    if (!node.is_dir) {
      files.push(node);
      return;
    }
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return files;
}

export function selectDefaultKnowledgeWorkspacePath(
  files: KnowledgeWorkspaceFileNode[],
) {
  const normalizedFiles = files.map((file) => ({
    file,
    path: file.path.replace(/^\.\//, ""),
  }));
  const exactPreferredPath = [
    "wiki/index.md",
    "index.md",
    "purpose.md",
    "schema.md",
  ]
    .map(
      (path) =>
        normalizedFiles.find((candidate) => candidate.path === path)?.file ??
        null,
    )
    .find((file): file is KnowledgeWorkspaceFileNode => file != null);

  if (exactPreferredPath) {
    return exactPreferredPath.path;
  }

  const firstWikiPage =
    normalizedFiles.find(
      ({ path }) => path.startsWith("wiki/") && path.endsWith(".md"),
    )?.file ?? null;
  if (firstWikiPage) {
    return firstWikiPage.path;
  }

  return (
    normalizedFiles.find(({ path }) => path.endsWith(".md"))?.file.path ??
    files[0]?.path ??
    null
  );
}

function workspaceFileLabel(path: string | null | undefined) {
  if (!path) {
    return "";
  }
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

const GRAPH_NODE_TYPE_COLORS: Record<string, string> = {
  entity: "#60a5fa",
  concept: "#c084fc",
  source: "#fb923c",
  query: "#4ade80",
  synthesis: "#f87171",
  overview: "#facc15",
  comparison: "#2dd4bf",
  index: "#a78bfa",
  log: "#38bdf8",
  other: "#94a3b8",
};

const GRAPH_COMMUNITY_COLORS = [
  "#60a5fa",
  "#4ade80",
  "#fb923c",
  "#c084fc",
  "#f87171",
  "#2dd4bf",
  "#facc15",
  "#f472b6",
  "#a78bfa",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
];

const GRAPH_STRUCTURAL_IDS = new Set(["index", "overview", "log", "schema", "purpose"]);
const GRAPH_BASE_NODE_SIZE = 8;
const GRAPH_MAX_NODE_SIZE = 28;

type KnowledgeGraphColorMode = "type" | "community";

type KnowledgeGraphFilterState = {
  hiddenTypes: Set<string>;
  hiddenNodeIds: Set<string>;
  hideStructural: boolean;
  hideIsolated: boolean;
  maxLinks?: number;
};

function graphNodeColorByType(type: string) {
  return GRAPH_NODE_TYPE_COLORS[type] ?? GRAPH_NODE_TYPE_COLORS.other;
}

function graphCommunityColor(community: number) {
  return GRAPH_COMMUNITY_COLORS[
    Math.abs(community) % GRAPH_COMMUNITY_COLORS.length
  ];
}

function graphNodeSize(linkCount: number, maxLinks: number) {
  if (maxLinks <= 0) {
    return GRAPH_BASE_NODE_SIZE;
  }
  const ratio = Math.max(0, linkCount) / maxLinks;
  return GRAPH_BASE_NODE_SIZE + Math.sqrt(ratio) * (GRAPH_MAX_NODE_SIZE - GRAPH_BASE_NODE_SIZE);
}

function mixGraphColor(color1: string, color2: string, ratio: number) {
  const read = (color: string, start: number) => Number.parseInt(color.slice(start, start + 2), 16);
  const r = Math.round(read(color1, 1) + (read(color2, 1) - read(color1, 1)) * ratio);
  const g = Math.round(read(color1, 3) + (read(color2, 3) - read(color1, 3)) * ratio);
  const b = Math.round(read(color1, 5) + (read(color2, 5) - read(color1, 5)) * ratio);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function isStructuralGraphNode(node: KnowledgeWorkspaceGraphNode) {
  if (GRAPH_STRUCTURAL_IDS.has(node.id.toLowerCase())) {
    return true;
  }
  if (node.type === "overview") {
    return true;
  }
  const path = node.path.replaceAll("\\", "/").toLowerCase();
  return (
    path.endsWith("/wiki/index.md") ||
    path.endsWith("/wiki/overview.md") ||
    path.endsWith("/wiki/log.md") ||
    path.endsWith("/purpose.md") ||
    path.endsWith("/schema.md")
  );
}

function defaultKnowledgeGraphFilters(): KnowledgeGraphFilterState {
  return {
    hiddenTypes: new Set(),
    hiddenNodeIds: new Set(),
    hideStructural: true,
    hideIsolated: false,
  };
}

function filterKnowledgeGraph(
  graph: KnowledgeWorkspaceGraphResponse,
  filters: KnowledgeGraphFilterState,
) {
  const hiddenNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (
      filters.hiddenNodeIds.has(node.id) ||
      filters.hiddenTypes.has(node.type) ||
      (filters.hideStructural && isStructuralGraphNode(node)) ||
      (filters.hideIsolated && node.link_count <= 0) ||
      (filters.maxLinks !== undefined && node.link_count > filters.maxLinks)
    ) {
      hiddenNodeIds.add(node.id);
    }
  }
  const nodes = graph.nodes.filter((node) => !hiddenNodeIds.has(node.id));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );
  return { nodes, edges, hiddenNodeIds };
}

function hasActiveKnowledgeGraphFilters(filters: KnowledgeGraphFilterState) {
  return (
    filters.hideStructural ||
    filters.hideIsolated ||
    filters.hiddenTypes.size > 0 ||
    filters.hiddenNodeIds.size > 0 ||
    filters.maxLinks !== undefined
  );
}

function WorkspaceFileTree({
  nodes,
  selectedPath,
  onSelectPath,
  depth = 0,
}: {
  nodes: KnowledgeWorkspaceFileNode[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  depth?: number;
}) {
  return (
    <div className={cn("space-y-0.5", depth > 0 && "mt-0.5")}>
      {nodes.map((node) => (
        <div key={node.path}>
          <button
            type="button"
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              selectedPath === node.path
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onClick={() => {
              if (!node.is_dir) {
                onSelectPath(node.path);
              }
            }}
          >
            {node.is_dir ? (
              <FolderIcon className="size-4 shrink-0" />
            ) : (
              <FileTextIcon className="size-4 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {node.children?.length ? (
            <div className="border-border ml-3 border-l pl-2">
              <WorkspaceFileTree
                nodes={node.children}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
                depth={depth + 1}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function KnowledgeSourceRail({
  documents,
  selectedDocumentId,
  onOpenDocument,
  t,
}: {
  documents: LibraryDocumentView[];
  selectedDocumentId: string | null;
  onOpenDocument: (document: LibraryDocumentView) => void;
  t: KnowledgeI18n;
}) {
  return (
    <aside className="border-border flex min-h-[320px] min-w-0 flex-col border-t bg-background lg:min-h-[520px] lg:w-[320px] lg:border-t-0 lg:border-l">
      <div className="border-border flex h-12 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t.knowledge.sourceDocuments}</div>
          <div className="text-muted-foreground text-xs">
            {t.knowledge.documentCount(documents.length)}
          </div>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-border/70 divide-y">
          {documents.length === 0 ? (
            <div className="text-muted-foreground p-4 text-sm">
              {t.knowledge.noDocumentSelectedDescription}
            </div>
          ) : (
            documents.map((document) => {
              const status = getKnowledgeDocumentStatus(document);
              return (
                <button
                  key={document.id}
                  type="button"
                  className={cn(
                    "hover:bg-muted/40 flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors",
                    selectedDocumentId === document.id && "bg-primary/5",
                  )}
                  onClick={() => onOpenDocument(document)}
                >
                  <FileTextIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm leading-5 font-medium break-words">
                      {document.display_name}
                    </div>
                    <div className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                      {document.doc_description ??
                        `${document.file_kind} · ${visibilityLabel(document.visibility, t)}`}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant={statusTone(status)}>
                        {statusLabel(status, t)}
                      </Badge>
                      {document.page_count ? (
                        <Badge variant="outline">
                          {t.knowledge.pageCount(document.page_count)}
                        </Badge>
                      ) : null}
                    </div>
                    {status !== "ready" ? (
                      <Progress
                        className="mt-3 h-1.5"
                        value={getKnowledgeDocumentProgress(document)}
                      />
                    ) : null}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {t.knowledge.openSourcePreview}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function KnowledgeWorkspaceReader({
  path,
  content,
  isLoading,
  error,
  t,
}: {
  path: string | null;
  content: string | undefined;
  isLoading: boolean;
  error: Error | null;
  t: KnowledgeI18n;
}) {
  const isMarkdown = path?.toLowerCase().endsWith(".md") ?? false;
  const body = content ?? "";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="border-border flex h-12 items-center gap-2 border-b px-4">
        <BookOpenIcon className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0 truncate text-sm font-medium">
          {path ?? t.knowledge.workspaceDefaultTitle}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="text-muted-foreground flex min-h-[480px] items-center justify-center text-sm">
            <LoaderIcon className="mr-2 size-4 animate-spin" />
            {t.knowledge.loadingWorkspaceFile}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-500">{error.message}</div>
        ) : !body.trim() ? (
          <div className="text-muted-foreground p-6 text-sm">
            {t.knowledge.selectWorkspaceFile}
          </div>
        ) : isMarkdown ? (
          <MessageResponse
            className="mx-auto max-w-4xl px-6 py-5 text-sm leading-7 [&_a]:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-0 [&_h1]:text-2xl [&_h2]:mt-8 [&_h2]:text-xl [&_h3]:mt-6 [&_h3]:text-base [&_li]:my-1 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/40 [&_pre]:p-3"
            {...streamdownPlugins}
          >
            {body}
          </MessageResponse>
        ) : (
          <pre className="text-foreground whitespace-pre-wrap break-words p-5 text-sm leading-6">
            {body}
          </pre>
        )}
      </ScrollArea>
    </div>
  );
}

function KnowledgeWikiWorkspace({
  workspaceTreeNodes,
  workspaceTreeLoading,
  workspaceTreeError,
  selectedWorkspacePath,
  onSelectWorkspacePath,
  workspaceFileContent,
  workspaceFileLoading,
  workspaceFileError,
  documents,
  selectedDocumentId,
  onOpenDocument,
  t,
}: {
  workspaceTreeNodes: KnowledgeWorkspaceFileNode[];
  workspaceTreeLoading: boolean;
  workspaceTreeError: Error | null;
  selectedWorkspacePath: string | null;
  onSelectWorkspacePath: (path: string) => void;
  workspaceFileContent: string | undefined;
  workspaceFileLoading: boolean;
  workspaceFileError: Error | null;
  documents: LibraryDocumentView[];
  selectedDocumentId: string | null;
  onOpenDocument: (document: LibraryDocumentView) => void;
  t: KnowledgeI18n;
}) {
  return (
    <div className="grid min-h-[640px] min-w-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
      <aside className="border-border flex min-h-[260px] min-w-0 flex-col border-b bg-muted/20 lg:min-h-[520px] lg:border-r lg:border-b-0">
        <div className="border-border flex h-12 items-center justify-between border-b px-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t.knowledge.workspaceFiles}</div>
            {selectedWorkspacePath ? (
              <div className="text-muted-foreground truncate text-xs">
                {workspaceFileLabel(selectedWorkspacePath)}
              </div>
            ) : null}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {workspaceTreeLoading ? (
              <div className="text-muted-foreground p-3 text-sm">
                {t.knowledge.loadingWorkspace}
              </div>
            ) : workspaceTreeError ? (
              <div className="p-3 text-sm text-red-500">
                {workspaceTreeError.message}
              </div>
            ) : workspaceTreeNodes.length === 0 ? (
              <div className="text-muted-foreground p-3 text-sm">
                {t.knowledge.emptyWorkspace}
              </div>
            ) : (
              <WorkspaceFileTree
                nodes={workspaceTreeNodes}
                selectedPath={selectedWorkspacePath}
                onSelectPath={onSelectWorkspacePath}
              />
            )}
          </div>
        </ScrollArea>
      </aside>

      <KnowledgeWorkspaceReader
        path={selectedWorkspacePath}
        content={workspaceFileContent}
        isLoading={workspaceFileLoading}
        error={workspaceFileError}
        t={t}
      />

      <KnowledgeSourceRail
        documents={documents}
        selectedDocumentId={selectedDocumentId}
        onOpenDocument={onOpenDocument}
        t={t}
      />
    </div>
  );
}

const knowledgeGraphPositionCache = new Map<string, { x: number; y: number }>();
let knowledgeGraphLastLayoutKey = "";

function KnowledgeGraphLoader({
  nodes,
  edges,
  colorMode,
}: {
  nodes: KnowledgeWorkspaceGraphNode[];
  edges: KnowledgeWorkspaceGraphResponse["edges"];
  colorMode: KnowledgeGraphColorMode;
}) {
  const loadGraph = useLoadGraph();

  useEffect(() => {
    const dataKey = `${nodes.map((node) => node.id).sort().join(",")}|${edges.length}`;
    const needsLayout = dataKey !== knowledgeGraphLastLayoutKey;
    const sigmaGraph = new Graph();
    const maxLinks = Math.max(1, ...nodes.map((node) => node.link_count));

    for (const node of nodes) {
      const cached = knowledgeGraphPositionCache.get(node.id);
      sigmaGraph.addNode(node.id, {
        x: cached?.x ?? Math.random() * 100,
        y: cached?.y ?? Math.random() * 100,
        size: graphNodeSize(node.link_count, maxLinks),
        color:
          colorMode === "community"
            ? graphCommunityColor(node.community)
            : graphNodeColorByType(node.type),
        label: node.label,
        nodePath: node.path,
        nodeType: node.type,
        community: node.community,
        linkCount: node.link_count,
      });
    }

    const maxWeight = Math.max(1, ...edges.map((edge) => edge.weight));
    for (const edge of edges) {
      if (!sigmaGraph.hasNode(edge.source) || !sigmaGraph.hasNode(edge.target)) {
        continue;
      }
      const edgeKey = `${edge.source}->${edge.target}`;
      const reverseKey = `${edge.target}->${edge.source}`;
      if (sigmaGraph.hasEdge(edgeKey) || sigmaGraph.hasEdge(reverseKey)) {
        continue;
      }
      const normalizedWeight = edge.weight / maxWeight;
      sigmaGraph.addEdgeWithKey(edgeKey, edge.source, edge.target, {
        color: `rgba(100,116,139,${0.18 + normalizedWeight * 0.62})`,
        size: 0.5 + normalizedWeight * 3.5,
        weight: edge.weight,
      });
    }

    // This mirrors llm-wiki's ForceAtlas2 pass: graph shape, not list order,
    // determines the rendered neighborhood positions.
    if (needsLayout && nodes.length > 1) {
      const settings = forceAtlas2.inferSettings(sigmaGraph);
      forceAtlas2.assign(sigmaGraph, {
        iterations: 150,
        settings: {
          ...settings,
          barnesHutOptimize: nodes.length > 50,
          gravity: 1,
          scalingRatio: 2,
          strongGravityMode: true,
        },
      });
      knowledgeGraphLastLayoutKey = dataKey;
      sigmaGraph.forEachNode((nodeId, attributes) => {
        knowledgeGraphPositionCache.set(nodeId, {
          x: Number(attributes.x),
          y: Number(attributes.y),
        });
      });
    }

    loadGraph(sigmaGraph);
  }, [colorMode, edges, loadGraph, nodes]);

  return null;
}

function KnowledgeGraphHighlightManager({
  highlightedNodes,
}: {
  highlightedNodes: Set<string>;
}) {
  const sigma = useSigma();

  useEffect(() => {
    const sigmaGraph = sigma.getGraph();
    if (highlightedNodes.size === 0) {
      sigmaGraph.forEachNode((nodeId) => {
        sigmaGraph.removeNodeAttribute(nodeId, "insightHighlight");
        sigmaGraph.removeNodeAttribute(nodeId, "dimmed");
      });
      sigmaGraph.forEachEdge((edgeId) => {
        sigmaGraph.removeEdgeAttribute(edgeId, "highlighted");
        sigmaGraph.removeEdgeAttribute(edgeId, "dimmed");
      });
    } else {
      sigmaGraph.forEachNode((nodeId) => {
        if (highlightedNodes.has(nodeId)) {
          sigmaGraph.setNodeAttribute(nodeId, "insightHighlight", true);
          sigmaGraph.removeNodeAttribute(nodeId, "dimmed");
        } else {
          sigmaGraph.setNodeAttribute(nodeId, "dimmed", true);
          sigmaGraph.removeNodeAttribute(nodeId, "insightHighlight");
        }
      });
      sigmaGraph.forEachEdge((edgeId, _attributes, source, target) => {
        if (highlightedNodes.has(source) && highlightedNodes.has(target)) {
          sigmaGraph.setEdgeAttribute(edgeId, "highlighted", true);
          sigmaGraph.removeEdgeAttribute(edgeId, "dimmed");
        } else {
          sigmaGraph.setEdgeAttribute(edgeId, "dimmed", true);
          sigmaGraph.removeEdgeAttribute(edgeId, "highlighted");
        }
      });
    }
    sigma.refresh();
  }, [highlightedNodes, sigma]);

  return null;
}

function KnowledgeGraphEventHandler({
  onNodeClick,
  onNodeMenu,
}: {
  onNodeClick: (nodeId: string) => void;
  onNodeMenu: (nodeId: string, point: { x: number; y: number }) => void;
}) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onNodeClick(node),
      enterNode: ({ node }) => {
        sigma.getContainer().style.cursor = "pointer";
        const sigmaGraph = sigma.getGraph();
        sigmaGraph.setNodeAttribute(node, "hovering", true);
        const neighbors = new Set(sigmaGraph.neighbors(node));
        neighbors.add(node);
        sigmaGraph.forEachNode((nodeId) => {
          if (!neighbors.has(nodeId)) {
            sigmaGraph.setNodeAttribute(nodeId, "dimmed", true);
          }
        });
        sigmaGraph.forEachEdge((edgeId, _attributes, source, target) => {
          if (source === node || target === node) {
            sigmaGraph.setEdgeAttribute(edgeId, "highlighted", true);
          } else {
            sigmaGraph.setEdgeAttribute(edgeId, "dimmed", true);
          }
        });
        sigma.refresh();
      },
      leaveNode: () => {
        sigma.getContainer().style.cursor = "default";
        const sigmaGraph = sigma.getGraph();
        sigmaGraph.forEachNode((nodeId) => {
          sigmaGraph.removeNodeAttribute(nodeId, "hovering");
          sigmaGraph.removeNodeAttribute(nodeId, "dimmed");
        });
        sigmaGraph.forEachEdge((edgeId) => {
          sigmaGraph.removeEdgeAttribute(edgeId, "highlighted");
          sigmaGraph.removeEdgeAttribute(edgeId, "dimmed");
        });
        sigma.refresh();
      },
      rightClickNode: (payload) => {
        payload.preventSigmaDefault();
        const originalEvent = payload.event.original;
        originalEvent.preventDefault();
        onNodeMenu(payload.node, {
          x: "clientX" in originalEvent ? originalEvent.clientX : 0,
          y: "clientY" in originalEvent ? originalEvent.clientY : 0,
        });
      },
      rightClickStage: () => onNodeMenu("", { x: 0, y: 0 }),
    });
  }, [onNodeClick, onNodeMenu, registerEvents, sigma]);

  return null;
}

function KnowledgeGraphZoomControls() {
  const sigma = useSigma();

  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 bg-background/85 backdrop-blur"
        onClick={() => sigma.getCamera().animatedZoom({ duration: 200 })}
      >
        <ZoomInIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 bg-background/85 backdrop-blur"
        onClick={() => sigma.getCamera().animatedUnzoom({ duration: 200 })}
      >
        <ZoomOutIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 bg-background/85 backdrop-blur"
        onClick={() => sigma.getCamera().animatedReset({ duration: 300 })}
      >
        <MaximizeIcon className="size-4" />
      </Button>
    </div>
  );
}

function KnowledgeGraphMap({
  graph,
  isLoading,
  error,
  onOpenWikiPath,
  t,
}: {
  graph: KnowledgeWorkspaceGraphResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onOpenWikiPath: (path: string) => void;
  t: KnowledgeI18n;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<KnowledgeGraphColorMode>("type");
  const [showFilters, setShowFilters] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [dismissedInsightKeys, setDismissedInsightKeys] = useState<Set<string>>(new Set());
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [filters, setFilters] = useState<KnowledgeGraphFilterState>(() =>
    defaultKnowledgeGraphFilters(),
  );
  const graphContainerRef = useRef<HTMLDivElement>(null);

  const filteredGraph = useMemo(
    () => (graph ? filterKnowledgeGraph(graph, filters) : null),
    [filters, graph],
  );
  const selectedNode =
    graph?.nodes.find((node) => node.id === selectedNodeId) ??
    filteredGraph?.nodes[0] ??
    graph?.nodes[0] ??
    null;
  const nodeTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph?.nodes ?? []) {
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    }
    return counts;
  }, [graph]);
  const visibleInsightNodes = graph?.insights?.isolated_nodes.filter(
    (node) => !dismissedInsightKeys.has(`isolated:${node.id}`),
  ) ?? [];
  const visibleSparseCommunities = graph?.insights?.sparse_communities.filter(
    (community) => !dismissedInsightKeys.has(`sparse:${community.id}`),
  ) ?? [];
  const filtersActive = hasActiveKnowledgeGraphFilters(filters);

  const resetFilters = useCallback(() => {
    setFilters(defaultKnowledgeGraphFilters());
    setNodeMenu(null);
  }, []);

  useEffect(() => {
    if (!graph || selectedNodeId == null) {
      return;
    }
    if (!graph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graph, selectedNodeId]);

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-[640px] items-center justify-center text-sm">
        <LoaderIcon className="mr-2 size-4 animate-spin" />
        {t.knowledge.loadingGraph}
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-sm text-red-500">{error.message}</div>;
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-[640px] items-center justify-center text-sm">
        {t.knowledge.emptyGraph}
      </div>
    );
  }

  const contextNode = nodeMenu
    ? graph.nodes.find((node) => node.id === nodeMenu.nodeId)
    : null;
  const visibleNodes = filteredGraph?.nodes ?? [];
  const visibleEdges = filteredGraph?.edges ?? [];

  return (
    <div className="grid min-h-[640px] min-w-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-h-[520px] min-w-0 flex-col bg-slate-50 dark:bg-slate-950">
        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <NetworkIcon className="size-4 text-muted-foreground" />
            <span>{t.knowledge.knowledgeGraphTab}</span>
            <Badge variant="outline">
              {t.knowledge.graphNodeVisibleCount(visibleNodes.length, graph.nodes.length)}
            </Badge>
            <Badge variant="outline">
              {t.knowledge.graphRenderedEdges(visibleEdges.length, graph.edges.length)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant={showFilters ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1 rounded-md text-xs"
              onClick={() => setShowFilters((value) => !value)}
            >
              <FilterIcon className="size-3.5" />
              {t.knowledge.graphFilter}
            </Button>
            {filtersActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 rounded-md text-xs"
                onClick={resetFilters}
              >
                <RotateCcwIcon className="size-3.5" />
                {t.knowledge.graphReset}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={colorMode === "type" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1 rounded-md text-xs"
              onClick={() => setColorMode("type")}
            >
              <TagIcon className="size-3.5" />
              {t.knowledge.graphTypeMode}
            </Button>
            <Button
              type="button"
              variant={colorMode === "community" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1 rounded-md text-xs"
              onClick={() => setColorMode("community")}
            >
              <LayersIcon className="size-3.5" />
              {t.knowledge.graphCommunityMode}
            </Button>
            {(visibleInsightNodes.length > 0 || visibleSparseCommunities.length > 0) ? (
              <Button
                type="button"
                variant={showInsights ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1 rounded-md text-xs"
                onClick={() => {
                  setShowInsights((value) => {
                    if (value) {
                      setHighlightedNodes(new Set());
                    }
                    return !value;
                  });
                }}
              >
                <LightbulbIcon className="size-3.5" />
                {t.knowledge.graphInsights}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={() => {
                knowledgeGraphLastLayoutKey = "";
                knowledgeGraphPositionCache.clear();
                setHighlightedNodes(new Set());
              }}
            >
              <RefreshCwIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div
          ref={graphContainerRef}
          className="relative min-h-[520px] flex-1 overflow-hidden"
          onClick={() => setNodeMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          {visibleNodes.length === 0 ? (
            <div className="text-muted-foreground flex h-full min-h-[520px] items-center justify-center text-sm">
              {t.knowledge.graphNoVisibleNodes}
            </div>
          ) : (
            <SigmaContainer
              style={{ width: "100%", height: "100%", minHeight: "520px", background: "transparent" }}
              settings={{
                defaultEdgeColor: "#cbd5e1",
                defaultNodeColor: "#94a3b8",
                edgeReducer: (_edge, attributes) => {
                  const result = { ...attributes };
                  if (attributes.dimmed) {
                    result.color = "#f1f5f9";
                    result.size = 0.3;
                  }
                  if (attributes.highlighted) {
                    const weight = Number(attributes.weight ?? 1);
                    result.color = "#1e293b";
                    result.forceLabel = true;
                    result.label = `${t.knowledge.graphRelevance}: ${weight.toFixed(1)}`;
                    result.size = Math.max(2, Number(attributes.size ?? 1) * 1.5);
                  }
                  return result;
                },
                labelColor: { color: "#1e293b" },
                labelDensity: 0.4,
                labelRenderedSizeThreshold: 6,
                labelSize: 13,
                labelWeight: "bold",
                nodeReducer: (_node, attributes) => {
                  const result = { ...attributes };
                  if (attributes.insightHighlight) {
                    result.forceLabel = true;
                    result.size = Number(attributes.size ?? GRAPH_BASE_NODE_SIZE) * 1.5;
                    result.zIndex = 10;
                  }
                  if (attributes.hovering) {
                    result.forceLabel = true;
                    result.size = Number(attributes.size ?? GRAPH_BASE_NODE_SIZE) * 1.4;
                    result.zIndex = 10;
                  }
                  if (attributes.dimmed) {
                    result.color = mixGraphColor(String(attributes.color ?? "#94a3b8"), "#e2e8f0", 0.75);
                    result.label = "";
                    result.size = Number(attributes.size ?? GRAPH_BASE_NODE_SIZE) * 0.6;
                  }
                  return result;
                },
                renderEdgeLabels: true,
                stagePadding: 30,
              }}
            >
              <KnowledgeGraphLoader
                nodes={visibleNodes}
                edges={visibleEdges}
                colorMode={colorMode}
              />
              <KnowledgeGraphEventHandler
                onNodeClick={setSelectedNodeId}
                onNodeMenu={(nodeId, point) => {
                  if (!nodeId) {
                    setNodeMenu(null);
                    return;
                  }
                  const rect = graphContainerRef.current?.getBoundingClientRect();
                  setNodeMenu({
                    nodeId,
                    x: rect ? point.x - rect.left : point.x,
                    y: rect ? point.y - rect.top : point.y,
                  });
                }}
              />
              <KnowledgeGraphHighlightManager highlightedNodes={highlightedNodes} />
              <KnowledgeGraphZoomControls />
            </SigmaContainer>
          )}

          {showFilters ? (
            <div className="border-border absolute top-3 left-3 w-72 rounded-md border bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-medium">
                  <FilterIcon className="size-3.5" />
                  {t.knowledge.graphFilters}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md px-2 text-xs"
                  onClick={resetFilters}
                >
                  {t.knowledge.graphReset}
                </Button>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.hideStructural}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        hideStructural: event.target.checked,
                      }))
                    }
                  />
                  <span>{t.knowledge.graphHideStructural}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.hideIsolated}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        hideIsolated: event.target.checked,
                      }))
                    }
                  />
                  <span>{t.knowledge.graphHideIsolated}</span>
                </label>
                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">
                    {t.knowledge.graphMaxLinks}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    className="h-8"
                    value={filters.maxLinks ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      const value = Number(raw);
                      setFilters((current) => ({
                        ...current,
                        maxLinks:
                          raw === "" || !Number.isFinite(value)
                            ? undefined
                            : Math.max(0, value),
                      }));
                    }}
                    placeholder={t.knowledge.graphAnyLinks}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">
                    {t.knowledge.graphNodeTypes}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {Array.from(nodeTypeCounts.entries()).map(([type, count]) => (
                      <label key={type} className="flex min-w-0 items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={!filters.hiddenTypes.has(type)}
                          onChange={(event) =>
                            setFilters((current) => {
                              const hiddenTypes = new Set(current.hiddenTypes);
                              if (event.target.checked) {
                                hiddenTypes.delete(type);
                              } else {
                                hiddenTypes.add(type);
                              }
                              return { ...current, hiddenTypes };
                            })
                          }
                        />
                        <span className="truncate">{type}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {nodeMenu && contextNode ? (
            <div
              className="border-border absolute z-20 w-52 rounded-md border bg-background py-1 text-xs shadow-lg"
              style={{ left: nodeMenu.x, top: nodeMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-border border-b px-3 py-2">
                <div className="truncate font-medium">{contextNode.label}</div>
                <div className="text-muted-foreground">
                  {t.knowledge.graphLinks(contextNode.link_count)}
                </div>
              </div>
              <button
                type="button"
                className="hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => {
                  setFilters((current) => ({
                    ...current,
                    hiddenNodeIds: new Set([...current.hiddenNodeIds, contextNode.id]),
                  }));
                  setNodeMenu(null);
                }}
              >
                <EyeOffIcon className="size-3.5" />
                {t.knowledge.graphHideThisNode}
              </button>
            </div>
          ) : null}

          <div className="border-border absolute bottom-3 left-3 max-w-[280px] rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <div className="mb-2 flex items-center justify-between gap-3 font-medium">
              <span>
                {colorMode === "type"
                  ? t.knowledge.graphNodeTypes
                  : t.knowledge.graphCommunities}
              </span>
              {filters.hiddenTypes.size > 0 ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      hiddenTypes: new Set(),
                    }))
                  }
                >
                  {t.knowledge.graphShowAll}
                </button>
              ) : null}
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {colorMode === "type"
                ? Array.from(nodeTypeCounts.entries()).map(([type, count]) => {
                    const hidden = filters.hiddenTypes.has(type);
                    return (
                      <button
                        type="button"
                        key={type}
                        className={cn(
                          "hover:bg-muted/70 flex w-full items-center gap-2 rounded px-1 py-0.5 text-left",
                          hidden && "opacity-45",
                        )}
                        onDoubleClick={() =>
                          setFilters((current) => {
                            const hiddenTypes = new Set(current.hiddenTypes);
                            if (hiddenTypes.has(type)) {
                              hiddenTypes.delete(type);
                            } else {
                              hiddenTypes.add(type);
                            }
                            return { ...current, hiddenTypes };
                          })
                        }
                      >
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: graphNodeColorByType(type) }}
                        />
                        <span className="min-w-0 flex-1 truncate">{type}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </button>
                    );
                  })
                : (graph.communities ?? []).map((community) => (
                    <div
                      key={community.id}
                      className="flex items-center gap-2 rounded px-1 py-0.5"
                    >
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: graphCommunityColor(community.id) }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {community.top_nodes[0] ??
                          t.knowledge.graphCommunity(community.id)}
                      </span>
                      <span className="text-muted-foreground">
                        {community.node_count}
                      </span>
                    </div>
                  ))}
            </div>
          </div>
        </div>
      </div>

      <aside className="border-border flex min-h-[320px] min-w-0 flex-col border-t bg-background lg:min-h-[520px] lg:border-t-0 lg:border-l">
        <div className="border-border border-b p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <NetworkIcon className="size-4" />
            {t.knowledge.graphSelectedNode}
          </div>
          {selectedNode ? (
            <div className="mt-3 min-w-0">
              <div className="line-clamp-2 text-sm font-semibold">
                {selectedNode.label}
              </div>
              <div className="text-muted-foreground mt-2 break-all text-xs leading-5">
                {selectedNode.path}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline">{selectedNode.type}</Badge>
                <Badge variant="outline">
                  {t.knowledge.graphCommunity(selectedNode.community)}
                </Badge>
                <Badge variant="outline">
                  {t.knowledge.graphLinks(selectedNode.link_count)}
                </Badge>
              </div>
              <Button
                type="button"
                size="sm"
                className="mt-4 w-full rounded-md"
                onClick={() => onOpenWikiPath(selectedNode.path)}
              >
                <BookOpenIcon className="size-4" />
                {t.knowledge.graphOpenInWiki}
              </Button>
            </div>
          ) : (
            <div className="text-muted-foreground mt-3 text-sm">
              {t.knowledge.graphNoNodeSelected}
            </div>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 p-4">
            {showInsights ? (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <LightbulbIcon className="size-4 text-amber-500" />
                    {t.knowledge.graphInsights}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-md"
                    onClick={() => {
                      setShowInsights(false);
                      setHighlightedNodes(new Set());
                    }}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </div>
                <div className="space-y-3">
                  {visibleInsightNodes.map((node) => {
                    const isActive =
                      highlightedNodes.size === 1 && highlightedNodes.has(node.id);
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className={cn(
                          "border-border hover:bg-muted/50 w-full rounded-md border p-3 text-left text-xs transition-colors",
                          isActive && "border-amber-500/50 bg-amber-500/10",
                        )}
                        onClick={() =>
                          setHighlightedNodes(isActive ? new Set() : new Set([node.id]))
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">{node.label}</span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDismissedInsightKeys((current) =>
                                new Set([...current, `isolated:${node.id}`]),
                              );
                            }}
                          >
                            <XIcon className="size-3.5" />
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1">
                          {t.knowledge.graphIsolatedInsight}
                        </div>
                      </button>
                    );
                  })}
                  {visibleSparseCommunities.map((community) => {
                    const ids = new Set(
                      graph.nodes
                        .filter((node) => node.community === community.id)
                        .map((node) => node.id),
                    );
                    const isActive =
                      highlightedNodes.size === ids.size &&
                      Array.from(ids).every((id) => highlightedNodes.has(id));
                    return (
                      <button
                        key={community.id}
                        type="button"
                        className={cn(
                          "border-border hover:bg-muted/50 w-full rounded-md border p-3 text-left text-xs transition-colors",
                          isActive && "border-amber-500/50 bg-amber-500/10",
                        )}
                        onClick={() => setHighlightedNodes(isActive ? new Set() : ids)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">
                            {t.knowledge.graphSparseCommunityTitle(
                              community.top_nodes[0] ??
                                t.knowledge.graphCommunity(community.id),
                            )}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDismissedInsightKeys((current) =>
                                new Set([...current, `sparse:${community.id}`]),
                              );
                            }}
                          >
                            <XIcon className="size-3.5" />
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1">
                          {t.knowledge.graphSparseCommunityDescription(
                            community.node_count,
                            community.cohesion,
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {visibleInsightNodes.length === 0 &&
                  visibleSparseCommunities.length === 0 ? (
                    <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
                      {t.knowledge.graphNoInsights}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <LayersIcon className="size-4" />
                    {t.knowledge.graphCommunities}
                  </div>
                  <div className="mt-3 space-y-2">
                    {(graph.communities ?? []).map((community) => (
                      <button
                        key={community.id}
                        type="button"
                        className="border-border hover:bg-muted/50 w-full rounded-md border px-3 py-2 text-left text-xs transition-colors"
                        onClick={() =>
                          setHighlightedNodes(
                            new Set(
                              graph.nodes
                                .filter((node) => node.community === community.id)
                                .map((node) => node.id),
                            ),
                          )
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>{t.knowledge.graphCommunity(community.id)}</span>
                          <span className="text-muted-foreground">
                            {t.knowledge.nodeCount(community.node_count)}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1 line-clamp-2">
                          {community.top_nodes.slice(0, 3).join(", ")}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangleIcon className="size-4" />
                    {t.knowledge.graphInsights}
                  </div>
                  <div className="text-muted-foreground mt-3 space-y-2 text-xs leading-5">
                    <div>{t.knowledge.graphIsolatedNodes(graph.insights?.isolated_nodes.length ?? 0)}</div>
                    <div>{t.knowledge.graphSparseCommunities(graph.insights?.sparse_communities.length ?? 0)}</div>
                    <div>{t.knowledge.graphRenderedEdges(visibleEdges.length, graph.edges.length)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium">{t.knowledge.graphEdges}</div>
                  <div className="mt-3 space-y-2">
                    {visibleEdges.slice(0, 40).map((edge) => (
                      <button
                        key={`${edge.source}-${edge.target}`}
                        type="button"
                        className="border-border hover:bg-muted/50 w-full rounded-md border px-3 py-2 text-left text-xs transition-colors"
                        onClick={() => setSelectedNodeId(edge.source)}
                      >
                        <div className="truncate">{edge.source}</div>
                        <div className="text-muted-foreground truncate">
                          {edge.target} · {edge.weight.toFixed(1)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}

function KnowledgeBaseWorkbench({
  activeTab,
  onActiveTabChange,
  workspaceTreeNodes,
  workspaceTreeLoading,
  workspaceTreeError,
  selectedWorkspacePath,
  onSelectWorkspacePath,
  workspaceFileContent,
  workspaceFileLoading,
  workspaceFileError,
  graph,
  graphLoading,
  graphError,
  documents,
  selectedDocumentId,
  onOpenDocument,
  t,
}: {
  activeTab: BaseWorkbenchTab;
  onActiveTabChange: (tab: BaseWorkbenchTab) => void;
  workspaceTreeNodes: KnowledgeWorkspaceFileNode[];
  workspaceTreeLoading: boolean;
  workspaceTreeError: Error | null;
  selectedWorkspacePath: string | null;
  onSelectWorkspacePath: (path: string) => void;
  workspaceFileContent: string | undefined;
  workspaceFileLoading: boolean;
  workspaceFileError: Error | null;
  graph: KnowledgeWorkspaceGraphResponse | undefined;
  graphLoading: boolean;
  graphError: Error | null;
  documents: LibraryDocumentView[];
  selectedDocumentId: string | null;
  onOpenDocument: (document: LibraryDocumentView) => void;
  t: KnowledgeI18n;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-border sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3">
        <div className="border-border inline-flex h-9 overflow-hidden rounded-md border">
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 px-3 text-sm transition-colors",
              activeTab === "wiki"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            onClick={() => onActiveTabChange("wiki")}
          >
            <BookOpenIcon className="size-4" />
            {t.knowledge.wikiWorkspaceTab}
          </button>
          <button
            type="button"
            className={cn(
              "border-border flex items-center gap-2 border-l px-3 text-sm transition-colors",
              activeTab === "graph"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            onClick={() => onActiveTabChange("graph")}
          >
            <NetworkIcon className="size-4" />
            {t.knowledge.knowledgeGraphTab}
          </button>
        </div>
        <div className="text-muted-foreground min-w-0 truncate text-sm">
          {activeTab === "wiki"
            ? (selectedWorkspacePath ?? t.knowledge.workspaceDefaultTitle)
            : t.knowledge.graphNodeCount(graph?.nodes.length ?? 0)}
        </div>
      </div>

      {activeTab === "wiki" ? (
        <KnowledgeWikiWorkspace
          workspaceTreeNodes={workspaceTreeNodes}
          workspaceTreeLoading={workspaceTreeLoading}
          workspaceTreeError={workspaceTreeError}
          selectedWorkspacePath={selectedWorkspacePath}
          onSelectWorkspacePath={onSelectWorkspacePath}
          workspaceFileContent={workspaceFileContent}
          workspaceFileLoading={workspaceFileLoading}
          workspaceFileError={workspaceFileError}
          documents={documents}
          selectedDocumentId={selectedDocumentId}
          onOpenDocument={onOpenDocument}
          t={t}
        />
      ) : (
        <KnowledgeGraphMap
          graph={graph}
          isLoading={graphLoading}
          error={graphError}
          onOpenWikiPath={(path) => {
            onSelectWorkspacePath(path);
            onActiveTabChange("wiki");
          }}
          t={t}
        />
      )}
    </div>
  );
}

export function ThreadKnowledgeManagementPage() {
  const { thread_id: threadId, agent_name: agentName } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { knowledgeBases, isLoading } = useKnowledgeLibrary(threadId);
  const [search, setSearch] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
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
  const [baseWorkbenchTab, setBaseWorkbenchTab] =
    useState<BaseWorkbenchTab>("wiki");
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<
    string | null
  >(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [pendingUploadedBaseId, setPendingUploadedBaseId] = useState<
    string | null
  >(null);
  const [deleteBaseTarget, setDeleteBaseTarget] =
    useState<KnowledgeBase | null>(null);
  const [deletingBaseId, setDeletingBaseId] = useState<string | null>(null);
  const [clearAllTarget, setClearAllTarget] =
    useState<KnowledgeClearTarget | null>(null);
  const [clearingOwnerId, setClearingOwnerId] = useState<string | null>(null);
  const localSelectionChangeRef = useRef(false);

  const markLocalSelectionChange = useCallback(() => {
    // User-driven selection changes must update the query instead of being
    // pulled back by an already-consumed URL from the previous selection.
    localSelectionChangeRef.current = true;
  }, []);

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
    const groups = new Map<string, KnowledgeOwnerGroup>();
    filteredKnowledgeBases.forEach((knowledgeBase) => {
      const existing = groups.get(knowledgeBase.owner_id);
      if (existing) {
        existing.bases.push(knowledgeBase);
        return;
      }
      groups.set(knowledgeBase.owner_id, {
        ownerId: knowledgeBase.owner_id,
        ownerName: knowledgeBase.owner_name,
        bases: [knowledgeBase],
      });
    });
    return Array.from(groups.values())
      .sort((leftGroup, rightGroup) =>
        leftGroup.ownerName.localeCompare(rightGroup.ownerName),
      )
      .map((group) => ({
        ...group,
        bases: [...group.bases].sort((leftBase, rightBase) =>
          leftBase.name.localeCompare(rightBase.name),
        ),
      }));
  }, [filteredKnowledgeBases]);

  useEffect(() => {
    if (localSelectionChangeRef.current) {
      return;
    }

    const requestedOwnerId = searchParams.get("owner");
    const requestedBaseId = searchParams.get("base");
    const requestedDocumentId = searchParams.get("document");

    // Knowledge links can jump straight into an active/error document so users
    // do not need to manually hunt through the library after uploading.
    if (requestedDocumentId) {
      const matchedDocument = knowledgeBases
        .flatMap((knowledgeBase) =>
          knowledgeBase.documents.map((document) => ({
            document,
            knowledgeBase,
          })),
        )
        .find(({ document }) => document.id === requestedDocumentId);
      if (matchedDocument) {
        if (selectedOwnerId !== matchedDocument.knowledgeBase.owner_id) {
          setSelectedOwnerId(matchedDocument.knowledgeBase.owner_id);
        }
        if (selectedBaseId !== matchedDocument.knowledgeBase.id) {
          setSelectedBaseId(matchedDocument.knowledgeBase.id);
        }
        if (selectedDocumentId !== matchedDocument.document.id) {
          setSelectedDocumentId(matchedDocument.document.id);
        }
        setDetailOpen(true);
        return;
      }
    }

    if (requestedBaseId) {
      const matchedBase =
        knowledgeBases.find(
          (knowledgeBase) => knowledgeBase.id === requestedBaseId,
        ) ?? null;
      if (matchedBase) {
        if (selectedOwnerId !== matchedBase.owner_id) {
          setSelectedOwnerId(matchedBase.owner_id);
        }
        if (selectedBaseId !== matchedBase.id) {
          setSelectedBaseId(matchedBase.id);
        }
        return;
      }
    }

    if (requestedOwnerId) {
      const matchedOwner =
        groupedBases.find((group) => group.ownerId === requestedOwnerId) ??
        null;
      if (matchedOwner && selectedOwnerId !== matchedOwner.ownerId) {
        setSelectedOwnerId(matchedOwner.ownerId);
      }
    }
  }, [
    groupedBases,
    knowledgeBases,
    searchParams,
    selectedBaseId,
    selectedDocumentId,
    selectedOwnerId,
  ]);

  useEffect(() => {
    if (!pendingUploadedBaseId) {
      return;
    }

    const uploadedBase =
      knowledgeBases.find(
        (knowledgeBase) => knowledgeBase.id === pendingUploadedBaseId,
      ) ?? null;
    if (!uploadedBase) {
      return;
    }

    markLocalSelectionChange();
    setSelectedOwnerId(uploadedBase.owner_id);
    setSelectedBaseId(uploadedBase.id);
    setSelectedDocumentId(uploadedBase.documents[0]?.id ?? null);
    setPendingUploadedBaseId(null);
  }, [knowledgeBases, markLocalSelectionChange, pendingUploadedBaseId]);

  useEffect(() => {
    if (
      shouldDeferKnowledgeSelectionUrlSync({
        isLoading,
        knowledgeBases,
        ownerGroups: groupedBases,
        searchParams,
        selectedOwnerId,
        selectedBaseId,
        selectedDocumentId,
        hasLocalSelectionChange: localSelectionChangeRef.current,
      })
    ) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);

    if (selectedOwnerId) {
      nextParams.set("owner", selectedOwnerId);
    } else {
      nextParams.delete("owner");
    }

    if (selectedBaseId) {
      nextParams.set("base", selectedBaseId);
    } else {
      nextParams.delete("base");
    }

    if (detailOpen && selectedDocumentId) {
      nextParams.set("document", selectedDocumentId);
    } else {
      nextParams.delete("document");
    }

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
    localSelectionChangeRef.current = false;
  }, [
    detailOpen,
    groupedBases,
    isLoading,
    knowledgeBases,
    searchParams,
    selectedBaseId,
    selectedDocumentId,
    selectedOwnerId,
    setSearchParams,
  ]);

  useEffect(() => {
    if (selectedOwnerId == null) {
      return;
    }
    if (!groupedBases.some((group) => group.ownerId === selectedOwnerId)) {
      setSelectedOwnerId(null);
      setSelectedBaseId(null);
    }
  }, [groupedBases, selectedOwnerId]);

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
    selectedOwnerId == null
      ? null
      : (groupedBases.find((group) => group.ownerId === selectedOwnerId) ??
        null);

  const selectedOwnerBases = selectedOwnerGroup?.bases ?? [];
  const ownOwnerGroup =
    user?.id == null
      ? null
      : (groupedBases.find((group) => group.ownerId === user.id) ?? null);

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
    setBaseWorkbenchTab("wiki");
    setSelectedWorkspacePath(null);
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
  const workspaceTreeQuery = useKnowledgeWorkspaceTree(
    selectedBase?.id,
    Boolean(selectedBase),
  );
  const workspaceFiles = useMemo(
    () => flattenWorkspaceFiles(workspaceTreeQuery.data?.tree ?? []),
    [workspaceTreeQuery.data?.tree],
  );
  const workspaceFileQuery = useKnowledgeWorkspaceFile(
    selectedBase?.id,
    selectedWorkspacePath ?? undefined,
    Boolean(selectedBase && selectedWorkspacePath),
  );
  const workspaceGraphQuery = useKnowledgeWorkspaceGraph(
    selectedBase?.id,
    Boolean(selectedBase && baseWorkbenchTab === "graph"),
  );

  useEffect(() => {
    if (!selectedBase) {
      setSelectedWorkspacePath(null);
      return;
    }
    const currentStillExists =
      selectedWorkspacePath != null &&
      workspaceFiles.some((file) => file.path === selectedWorkspacePath);
    if (currentStillExists) {
      return;
    }
    setSelectedWorkspacePath(selectDefaultKnowledgeWorkspacePath(workspaceFiles));
  }, [selectedBase, selectedWorkspacePath, workspaceFiles]);

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
    ownerId: group.ownerId,
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

  const derivedClearAllTarget = useMemo<KnowledgeClearTarget | null>(() => {
    const canManageOwner = (ownerId: string) =>
      ownerId === user?.id || user?.role === "admin";

    if (selectedBase && canManageOwner(selectedBase.owner_id)) {
      const ownerGroup =
        groupedBases.find((group) => group.ownerId === selectedBase.owner_id) ??
        null;
      return {
        ownerId: selectedBase.owner_id,
        ownerName: selectedBase.owner_name,
        baseCount: ownerGroup?.bases.length ?? 1,
      };
    }
    if (selectedOwnerGroup && canManageOwner(selectedOwnerGroup.ownerId)) {
      return {
        ownerId: selectedOwnerGroup.ownerId,
        ownerName: selectedOwnerGroup.ownerName,
        baseCount: selectedOwnerGroup.bases.length,
      };
    }
    if (user?.role === "admin") {
      return null;
    }
    if (ownOwnerGroup && canManageOwner(ownOwnerGroup.ownerId)) {
      return {
        ownerId: ownOwnerGroup.ownerId,
        ownerName: ownOwnerGroup.ownerName,
        baseCount: ownOwnerGroup.bases.length,
      };
    }
    return null;
  }, [
    groupedBases,
    ownOwnerGroup,
    selectedBase,
    selectedOwnerGroup,
    user?.id,
    user?.role,
  ]);

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

  const openOwner = (owner: KnowledgeOwnerGroup) => {
    markLocalSelectionChange();
    setSelectedOwnerId(owner.ownerId);
    setSelectedBaseId(null);
    setSelectedDocumentId(null);
  };

  const openBase = (knowledgeBase: KnowledgeBase) => {
    markLocalSelectionChange();
    setSelectedOwnerId(knowledgeBase.owner_id);
    setSelectedBaseId(knowledgeBase.id);
    setSelectedDocumentId(knowledgeBase.documents[0]?.id ?? null);
  };

  const openDocument = (document: LibraryDocumentView) => {
    markLocalSelectionChange();
    setSelectedOwnerId(document.owner_id);
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
        markLocalSelectionChange();
        setSelectedBaseId(null);
        setSelectedDocumentId(null);
        setDetailOpen(false);
        setSelectedOwnerId(deleteBaseTarget.owner_id);
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

  const handleClearAll = async () => {
    if (!clearAllTarget) {
      return;
    }

    setClearingOwnerId(clearAllTarget.ownerId);
    try {
      const response = await clearKnowledgeBases({
        ownerId: clearAllTarget.ownerId,
      });
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

      if (
        selectedBase?.owner_id === clearAllTarget.ownerId ||
        selectedOwnerGroup?.ownerId === clearAllTarget.ownerId
      ) {
        markLocalSelectionChange();
        setSelectedOwnerId(null);
        setSelectedBaseId(null);
        setSelectedDocumentId(null);
        setDetailOpen(false);
      }

      if (clearAllTarget.ownerId === user?.id) {
        toast.success(t.knowledge.clearAllSuccess(response.deleted_count));
      } else {
        toast.success(
          t.knowledge.clearAllOwnerSuccess(
            clearAllTarget.ownerName,
            response.deleted_count,
          ),
        );
      }
      setClearAllTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.knowledge.clearAllError,
      );
    } finally {
      setClearingOwnerId(null);
    }
  };

  return (
    <WorkspaceContainer>
      <KnowledgeBaseUploadDialog
        threadId={threadId}
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUploaded={({ knowledgeBaseId }) => {
          setPendingUploadedBaseId(knowledgeBaseId);
        }}
      />
      <WorkspaceHeader />
      <WorkspaceBody>
        <div className="bg-background flex size-full min-h-0 flex-col overflow-hidden lg:flex-row">
          <aside className="border-border bg-muted/20 flex max-h-[38svh] min-h-0 w-full shrink-0 flex-col overflow-hidden border-b lg:max-h-none lg:w-[288px] lg:border-r lg:border-b-0">
            <div className="border-border border-b px-4 py-4">
              <h1 className="text-sm font-semibold">{t.knowledge.libraryTitle}</h1>
              <p className="text-muted-foreground mt-1 line-clamp-3 text-xs leading-5">
                {activeLibraryDescription}
              </p>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-6 p-4">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                    selectedOwnerGroup == null && selectedBase == null
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                  onClick={() => {
                    markLocalSelectionChange();
                    setSelectedOwnerId(null);
                    setSelectedBaseId(null);
                    setSelectedDocumentId(null);
                  }}
                >
                  <div className="bg-background text-foreground flex size-8 items-center justify-center rounded-md border">
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
                          "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                          selectedOwnerId === group.ownerId &&
                            selectedBase == null
                            ? "bg-accent text-foreground"
                            : "hover:bg-accent/60",
                        )}
                        onClick={() => openOwner(group)}
                      >
                        <div className="bg-background text-foreground flex size-8 items-center justify-center rounded-md border">
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

                      {selectedOwnerId === group.ownerId ? (
                        <div className="border-border ml-4 min-w-0 space-y-1 border-l pr-1 pl-3">
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
                                  "flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                                  selectedBase?.id === knowledgeBase.id
                                    ? "bg-primary/5 text-foreground"
                                    : "hover:bg-accent/50",
                                )}
                                onClick={() => openBase(knowledgeBase)}
                              >
                                <FileTextIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="line-clamp-2 text-sm leading-5 font-medium break-words">
                                    {knowledgeBase.name}
                                  </div>
                                  <div className="text-muted-foreground line-clamp-2 text-[11px] leading-4 break-all">
                                    {knowledgeBaseContextLabel(knowledgeBase) ??
                                      t.knowledge.documentCount(
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

          <section className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="border-border border-b px-4 py-4">
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                    <button
                      type="button"
                      className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
                      onClick={() => {
                        markLocalSelectionChange();
                        setSelectedOwnerId(null);
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
                            markLocalSelectionChange();
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

                  <h2 className="mt-2 text-xl font-semibold tracking-tight">
                    {selectedBase
                      ? selectedBase.name
                      : selectedOwnerGroup
                        ? selectedOwnerGroup.ownerName
                        : managerTitle}
                  </h2>
                  <p className="text-muted-foreground mt-1 line-clamp-2 max-w-3xl text-sm leading-6">
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
                      className="h-11 w-full min-w-[260px] rounded-md pl-10 sm:w-[320px]"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                    <Button
                      type="button"
                      className="rounded-md px-4"
                      onClick={() => setUploadDialogOpen(true)}
                    >
                      <UploadIcon className="size-4" />
                      {t.knowledge.uploadButton}
                    </Button>
                    {derivedClearAllTarget &&
                    derivedClearAllTarget.baseCount > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-md px-4 text-red-600 hover:text-red-700"
                        disabled={
                          clearingOwnerId === derivedClearAllTarget.ownerId
                        }
                        onClick={() => setClearAllTarget(derivedClearAllTarget)}
                      >
                        {clearingOwnerId === derivedClearAllTarget.ownerId ? (
                          <LoaderIcon className="size-4 animate-spin" />
                        ) : (
                          <Trash2Icon className="size-4" />
                        )}
                        {t.common.clearAll}
                      </Button>
                    ) : null}
                    {selectedBase && canDeleteSelectedBase ? (
                      <Button
                        type="button"
                        variant="destructive"
                        className="rounded-md px-4"
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
                      className="rounded-md px-4"
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
                        className="rounded-md"
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
                      <div className="border-border bg-muted/40 flex items-center gap-3 rounded-md border px-3 py-1.5">
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
                      key={owner.ownerId}
                      className="hover:bg-muted/40 flex items-center gap-4 px-6 py-5 transition-colors"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-4 text-left"
                        onClick={() => {
                          const ownerGroup =
                            groupedBases.find(
                              (group) => group.ownerId === owner.ownerId,
                            ) ?? null;
                          if (ownerGroup) {
                            openOwner(ownerGroup);
                          }
                        }}
                      >
                        <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
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
                        className="hover:bg-muted/40 flex items-center gap-4 px-6 py-5 transition-colors"
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-4 text-left"
                          onClick={() => openBase(knowledgeBase)}
                        >
                          <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
                            <FolderIcon className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold md:text-base">
                              {knowledgeBase.name}
                            </div>
                            <div className="text-muted-foreground mt-1 text-sm">
                              {knowledgeBase.description ??
                                knowledgeBaseContextLabel(knowledgeBase) ??
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
                ) : selectedBase ? (
                  <KnowledgeBaseWorkbench
                    activeTab={baseWorkbenchTab}
                    onActiveTabChange={setBaseWorkbenchTab}
                    workspaceTreeNodes={workspaceTreeQuery.data?.tree ?? []}
                    workspaceTreeLoading={workspaceTreeQuery.isLoading}
                    workspaceTreeError={
                      workspaceTreeQuery.error instanceof Error
                        ? workspaceTreeQuery.error
                        : null
                    }
                    selectedWorkspacePath={selectedWorkspacePath}
                    onSelectWorkspacePath={setSelectedWorkspacePath}
                    workspaceFileContent={workspaceFileQuery.data?.content}
                    workspaceFileLoading={workspaceFileQuery.isLoading}
                    workspaceFileError={
                      workspaceFileQuery.error instanceof Error
                        ? workspaceFileQuery.error
                        : null
                    }
                    graph={workspaceGraphQuery.data}
                    graphLoading={workspaceGraphQuery.isLoading}
                    graphError={
                      workspaceGraphQuery.error instanceof Error
                        ? workspaceGraphQuery.error
                        : null
                    }
                    documents={selectedBaseDocuments}
                    selectedDocumentId={selectedDocumentId}
                    onOpenDocument={openDocument}
                    t={t}
                  />
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
                          "hover:bg-muted/40 flex items-center gap-4 px-6 py-5 transition-colors",
                          selectedDocumentId === document.id && "bg-primary/5",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-4 text-left"
                          onClick={() => openDocument(document)}
                        >
                          <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
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
                          className="rounded-md"
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
                className="w-[min(97vw,1480px)] gap-0 p-0 sm:max-w-none"
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
                <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1.08fr)_480px]">
                  <div className="bg-muted/30 min-h-0 border-b p-4 lg:border-r lg:border-b-0">
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
                    <div className="border-border border-b px-5 py-5 pr-12">
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
                      <TabsList className="bg-muted/60 mx-4 mt-4 grid h-auto grid-cols-4 rounded-lg p-1">
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
                        <ScrollArea className="h-full rounded-xl border">
                          <div className="space-y-4 p-4">
                            <div className="grid gap-3">
                              <div className="border-border bg-muted/40 rounded-lg border p-4">
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
                                <div className="border-border rounded-lg border p-4">
                                  <div className={panelLabelClassName}>
                                    {t.knowledge.stageLabel}
                                  </div>
                                  <div className="mt-2 text-sm font-medium">
                                    {selectedDocument.latest_build_job?.stage ??
                                      selectedDocument.status}
                                  </div>
                                </div>
                                <div className="border-border rounded-lg border p-4">
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

                              <div className="border-border rounded-lg border p-4">
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
                                  className="w-full rounded-md"
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
                                <div className="border-border bg-muted/40 flex items-center justify-between rounded-lg border p-4">
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
                        <div className="border-border bg-muted/40 h-full overflow-hidden rounded-xl border">
                          <ScrollArea className="h-full">
                            <div className="w-full min-w-0 space-y-4 p-4">
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
                        <div className="border-border bg-muted/40 h-full overflow-hidden rounded-xl border">
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
                                    className="border-border bg-background rounded-lg border p-4"
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
                        <div className="border-border bg-muted/40 h-full overflow-hidden rounded-xl border">
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
      <Dialog
        open={clearAllTarget != null}
        onOpenChange={(open) => {
          if (!open && clearingOwnerId == null) {
            setClearAllTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.knowledge.clearAllTitle}</DialogTitle>
            <DialogDescription>
              {clearAllTarget
                ? clearAllTarget.ownerId === user?.id
                  ? t.knowledge.clearAllSelfDescription(
                      clearAllTarget.baseCount,
                    )
                  : t.knowledge.clearAllOwnerDescription(
                      clearAllTarget.ownerName,
                      clearAllTarget.baseCount,
                    )
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearAllTarget(null)}
              disabled={clearingOwnerId != null}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleClearAll()}
              disabled={clearingOwnerId != null}
            >
              {clearingOwnerId != null ? (
                <LoaderIcon className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2Icon className="mr-2 size-4" />
              )}
              {t.common.clearAll}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceContainer>
  );
}
