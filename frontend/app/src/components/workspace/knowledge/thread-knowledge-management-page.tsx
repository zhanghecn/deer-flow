import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  HouseIcon,
  LoaderIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

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
  useVisibleKnowledgeDocumentBuildEvents,
  useVisibleKnowledgeDocumentTree,
} from "@/core/knowledge/hooks";
import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeTreeNode,
} from "@/core/knowledge/types";
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
  "text-muted-foreground text-[11px] font-medium uppercase tracking-[0.22em]";

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
        <div className="bg-muted/30 flex size-full min-h-0 gap-4 overflow-hidden p-4 md:p-6">
          <aside className="border-border bg-background flex min-h-0 w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border">
            <div className="border-border border-b px-5 py-5">
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
                          "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                          selectedOwnerId === group.ownerId &&
                            selectedBase == null
                            ? "bg-accent text-foreground"
                            : "hover:bg-accent/60",
                        )}
                        onClick={() => openOwner(group)}
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
                                  "flex w-full min-w-0 items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
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

          <section className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border">
            <div className="border-border border-b px-6 py-5">
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
