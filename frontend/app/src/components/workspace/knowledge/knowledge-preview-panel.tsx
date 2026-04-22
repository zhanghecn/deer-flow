import {
  Code2Icon,
  EyeIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LoaderIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openArtifactInNewWindow } from "@/core/artifacts/actions";
import { useArtifactObjectUrl } from "@/core/artifacts/hooks";
import { setPdfPreviewPage } from "@/core/artifacts/pdf";
import { useI18n } from "@/core/i18n/hooks";
import { useVisibleKnowledgeDocumentObjectUrl } from "@/core/knowledge/hooks";
import type { KnowledgeDocument } from "@/core/knowledge/types";

import { KnowledgeCanonicalPreview } from "./knowledge-canonical-preview";
import type {
  LibraryDocumentView,
  KnowledgePreviewMode,
  KnowledgePreviewFocus,
} from "./thread-knowledge-management-page";

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

function documentBinaryPreviewPath(document: KnowledgeDocument | null) {
  if (document?.locator_type !== "page") {
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

export function ExplorerEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <div className="border-border bg-muted/35 text-primary flex size-14 items-center justify-center rounded-lg border">
        <Icon className="size-7" />
      </div>
      <h2 className="mt-6 text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-3 max-w-md text-sm leading-6">
        {description}
      </p>
    </div>
  );
}

const panelLabelClassName =
  "text-muted-foreground text-[11px] font-medium uppercase tracking-[0.22em]";

export function KnowledgePreviewPanel({
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
  const previewFrameSrc = activePreviewObjectUrl
    ? setPdfPreviewPage(activePreviewObjectUrl, focus?.page)
    : null;
  const previewFrameKey = [
    document.id,
    effectiveMode,
    focus?.nodeId ?? "root",
    focus?.page ?? "page",
    focus?.line ?? "line",
    focus?.heading ?? "heading",
  ].join(":");

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
        canonicalMarkdown?.trim().length
      ) {
        const textObjectUrl = URL.createObjectURL(
          new Blob([canonicalMarkdown], { type: "text/markdown;charset=utf-8" }),
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
    <div className="border-border bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4">
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
              className="rounded-md"
              onClick={() => onModeChange("preview")}
            >
              <EyeIcon className="size-4" />
              {t.common.preview}
            </Button>
          ) : null}
          {canCompareCanonical ? (
            <Button
              size="sm"
              variant={effectiveMode === "canonical" ? "default" : "outline"}
              className="rounded-md"
              onClick={() => onModeChange("canonical")}
            >
              <Code2Icon className="size-4" />
              {t.knowledge.canonicalTab}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="rounded-md"
            disabled={
              opening ||
              (effectiveMode === "preview" && !activePreviewObjectUrl) ||
              (effectiveMode === "canonical" &&
                !canonicalMarkdown?.trim().length &&
                !textPath)
            }
            onClick={() => void handleOpen()}
          >
            <ExternalLinkIcon className="size-4" />
            {t.common.openInNewWindow}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {effectiveMode === "canonical" && canonicalMarkdown?.trim().length ? (
          <KnowledgeCanonicalPreview content={canonicalMarkdown} focus={focus} />
        ) : activePreviewLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <LoaderIcon className="size-4 animate-spin" />
              {t.common.loading}
            </div>
          </div>
        ) : previewFrameSrc ? (
          <iframe
            // Chromium's built-in PDF viewer does not consistently seek to a
            // new hash target when only `#page=` changes on an existing blob
            // URL. Re-mount the frame for each focus target so tree clicks
            // always open the requested page in the live preview.
            key={previewFrameKey}
            title={document.display_name}
            src={previewFrameSrc}
            className="h-full w-full border-0"
          />
        ) : (
            <ExplorerEmptyState
              icon={FileTextIcon}
              title={t.common.previewUnavailable}
              description={
                activePreviewError instanceof Error
                  ? activePreviewError.message
                  : t.common.previewUnavailable
              }
            />
          )}
      </div>
    </div>
  );
}
