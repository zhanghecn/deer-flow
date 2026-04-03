import { useQuery } from "@tanstack/react-query";
import { Children, isValidElement } from "react";
import {
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  LoaderIcon,
  PackageIcon,
  SquareArrowOutUpRightIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { Select, SelectItem } from "@/components/ui/select";
import {
  SelectContent,
  SelectGroup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CodeEditor } from "@/components/workspace/code-editor";
import {
  downloadArtifactFile,
  openArtifactInNewWindow,
} from "@/core/artifacts/actions";
import { loadHtmlPreviewDocument } from "@/core/artifacts/html-preview";
import { setPdfPreviewPage } from "@/core/artifacts/pdf";
import { resolveThreadScopedPath } from "@/core/artifacts/preview-resolver";
import {
  useArtifactContent,
  useArtifactObjectUrl,
} from "@/core/artifacts/hooks";
import {
  getOnlyOfficeDocumentDescriptor,
  loadOnlyOfficeConfig,
  type OnlyOfficeDocumentDescriptor,
  type OnlyOfficeMode,
} from "@/core/artifacts/onlyoffice";
import { urlOfArtifact } from "@/core/artifacts/utils";
import { useI18n } from "@/core/i18n/hooks";
import { installSkill } from "@/core/skills/api";
import { streamdownPlugins } from "@/core/streamdown";
import {
  checkCodeFile,
  getFileExtensionDisplayName,
  getFileIcon,
  getFileName,
} from "@/core/utils/files";
import { env } from "@/env";
import { cn } from "@/lib/utils";
import { parseKnowledgeCitationHref } from "@/core/knowledge/citations";

import { CitationLink } from "../citations/citation-link";
import { useThread } from "../messages/context";
import { Tooltip } from "../tooltip";

import { useArtifacts } from "./context";
import type { OnlyOfficeDocumentEditor as OnlyOfficeDocumentEditorValue } from "./onlyoffice-document-editor";

type OnlyOfficeDocumentEditorComponent = typeof OnlyOfficeDocumentEditorValue;
type ArtifactViewMode = "code" | "preview";

function getArtifactPreviewErrorMessage(error: unknown, previewError: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (previewError instanceof Error) {
    return previewError.message;
  }
  return "Failed to render artifact preview";
}

export function ArtifactFileDetail({
  className,
  filepath: filepathFromProps,
  threadId,
}: {
  className?: string;
  filepath: string;
  threadId: string;
}) {
  const { t } = useI18n();
  const { artifacts, setOpen, select, previewTarget } = useArtifacts();
  const isWriteFile = useMemo(() => {
    return filepathFromProps.startsWith("write-file:");
  }, [filepathFromProps]);
  const filepath = useMemo(() => {
    if (isWriteFile) {
      const url = new URL(filepathFromProps);
      return decodeURIComponent(url.pathname);
    }
    return filepathFromProps;
  }, [filepathFromProps, isWriteFile]);
  const isSkillFile = useMemo(() => {
    return filepath.endsWith(".skill");
  }, [filepath]);
  const officeDescriptor = useMemo(
    () => getOnlyOfficeDocumentDescriptor(filepath),
    [filepath],
  );
  const isOfficeFile = officeDescriptor !== null;
  const { isCodeFile, language } = useMemo(() => {
    if (isWriteFile) {
      let language = checkCodeFile(filepath).language;
      language ??= "text";
      return { isCodeFile: true, language };
    }
    // Treat .skill files as markdown (they contain SKILL.md)
    if (isSkillFile) {
      return { isCodeFile: true, language: "markdown" };
    }
    return checkCodeFile(filepath);
  }, [filepath, isWriteFile, isSkillFile]);
  const previewFilepath = filepath;
  const previewLanguage = language;
  const { isMock } = useThread();
  const officePreviewUrl = useMemo(() => {
    if (!isOfficeFile || isMock) {
      return null;
    }
    return urlOfArtifact({ filepath, threadId, isMock, preview: "pdf" });
  }, [filepath, isMock, isOfficeFile, threadId]);
  const isSupportPreview = useMemo(() => {
    return (
      Boolean(officePreviewUrl) ||
      (previewLanguage === "html" && !isWriteFile) ||
      previewLanguage === "markdown"
    );
  }, [isWriteFile, officePreviewUrl, previewLanguage]);
  const showPreviewToggle = isSupportPreview && isCodeFile;
  const isBinaryPreview = !isCodeFile && !isOfficeFile;
  const activePreviewTarget = useMemo(() => {
    if (!previewTarget || previewTarget.filepath !== filepath) {
      return null;
    }
    return previewTarget;
  }, [filepath, previewTarget]);
  const {
    content,
    isLoading: isContentLoading,
    error: contentError,
  } = useArtifactContent({
    threadId,
    filepath: filepathFromProps,
    enabled: isCodeFile && !isWriteFile,
  });

  const displayContent = content ?? "";

  const [viewMode, setViewMode] = useState<ArtifactViewMode>("code");
  const [isInstalling, setIsInstalling] = useState(false);
  const [isOpeningArtifact, setIsOpeningArtifact] = useState(false);
  const [isDownloadingArtifact, setIsDownloadingArtifact] = useState(false);
  useEffect(() => {
    if (isOfficeFile) {
      setViewMode("preview");
    } else if (isSupportPreview) {
      setViewMode("preview");
    } else {
      setViewMode("code");
    }
  }, [isOfficeFile, isSupportPreview]);

  const handleInstallSkill = useCallback(async () => {
    if (isInstalling) return;

    setIsInstalling(true);
    try {
      const result = await installSkill({
        thread_id: threadId,
        path: filepath,
      });
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message ?? "Failed to install skill");
      }
    } catch (error) {
      console.error("Failed to install skill:", error);
      toast.error("Failed to install skill");
    } finally {
      setIsInstalling(false);
    }
  }, [threadId, filepath, isInstalling]);

  const handleOpenArtifact = useCallback(async () => {
    if (isOpeningArtifact || isWriteFile) {
      return;
    }

    setIsOpeningArtifact(true);
    try {
      try {
        await openArtifactInNewWindow({
          filepath,
          threadId,
          isMock,
          preview: officePreviewUrl ? "pdf" : undefined,
        });
      } catch (error) {
        if (!officePreviewUrl) {
          throw error;
        }
        await openArtifactInNewWindow({
          filepath,
          threadId,
          isMock,
        });
      }
    } catch (error) {
      console.error("Failed to open artifact:", error);
      toast.error("Failed to open artifact");
    } finally {
      setIsOpeningArtifact(false);
    }
  }, [
    filepath,
    isMock,
    isOpeningArtifact,
    isWriteFile,
    officePreviewUrl,
    threadId,
  ]);

  const handleDownloadArtifact = useCallback(async () => {
    if (isDownloadingArtifact || isWriteFile) {
      return;
    }

    setIsDownloadingArtifact(true);
    try {
      await downloadArtifactFile({
        filepath,
        threadId,
        isMock,
      });
    } catch (error) {
      console.error("Failed to download artifact:", error);
      toast.error("Failed to download artifact");
    } finally {
      setIsDownloadingArtifact(false);
    }
  }, [filepath, isDownloadingArtifact, isMock, isWriteFile, threadId]);
  return (
    <Artifact className={cn(className)}>
      <ArtifactHeader className="px-2">
        <div className="flex items-center gap-2">
          <ArtifactTitle>
            {isWriteFile ? (
              <div className="px-2">{getFileName(filepath)}</div>
            ) : (
              <Select value={filepath} onValueChange={select}>
                <SelectTrigger className="border-none bg-transparent! shadow-none select-none focus:outline-0 active:outline-0">
                  <SelectValue placeholder="Select a file" />
                </SelectTrigger>
                <SelectContent className="select-none">
                  <SelectGroup>
                    {(artifacts ?? []).map((filepath) => (
                      <SelectItem key={filepath} value={filepath}>
                        {getFileName(filepath)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </ArtifactTitle>
        </div>
        <div className="flex min-w-0 grow items-center justify-center">
          {isOfficeFile && officeDescriptor && (
            <div className="text-muted-foreground text-xs">
              {officeDescriptor.editorLabel}
            </div>
          )}
          {!isOfficeFile && showPreviewToggle && (
            <ToggleGroup
              className="mx-auto"
              type="single"
              variant="outline"
              size="sm"
              value={viewMode}
              onValueChange={(value) => {
                if (value) {
                  setViewMode(value as ArtifactViewMode);
                }
              }}
            >
              <ToggleGroupItem value="code">
                <Code2Icon />
              </ToggleGroupItem>
              <ToggleGroupItem value="preview">
                <EyeIcon />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ArtifactActions>
            {!isWriteFile && filepath.endsWith(".skill") && (
              <Tooltip content={t.toolCalls.skillInstallTooltip}>
                <ArtifactAction
                  icon={isInstalling ? LoaderIcon : PackageIcon}
                  label={t.common.install}
                  tooltip={t.common.install}
                  disabled={
                    isInstalling || env.VITE_STATIC_WEBSITE_ONLY === "true"
                  }
                  onClick={handleInstallSkill}
                />
              </Tooltip>
            )}
            {!isWriteFile && (
              <ArtifactAction
                icon={
                  isOpeningArtifact ? LoaderIcon : SquareArrowOutUpRightIcon
                }
                label={t.common.openInNewWindow}
                tooltip={t.common.openInNewWindow}
                disabled={isOpeningArtifact}
                onClick={() => {
                  void handleOpenArtifact();
                }}
              />
            )}
            {isCodeFile && (
              <ArtifactAction
                icon={CopyIcon}
                label={t.clipboard.copyToClipboard}
                disabled={!content}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(displayContent ?? "");
                    toast.success(t.clipboard.copiedToClipboard);
                  } catch (error) {
                    toast.error("Failed to copy to clipboard");
                    console.error(error);
                  }
                }}
                tooltip={t.clipboard.copyToClipboard}
              />
            )}
            {!isWriteFile && (
              <ArtifactAction
                icon={isDownloadingArtifact ? LoaderIcon : DownloadIcon}
                label={t.common.download}
                tooltip={t.common.download}
                disabled={isDownloadingArtifact}
                onClick={() => {
                  void handleDownloadArtifact();
                }}
              />
            )}
            <ArtifactAction
              icon={XIcon}
              label={t.common.close}
              onClick={() => setOpen(false)}
              tooltip={t.common.close}
            />
          </ArtifactActions>
        </div>
      </ArtifactHeader>
      <ArtifactContent className="p-0">
        {isSupportPreview &&
          (viewMode === "preview" || !isCodeFile) &&
          (previewLanguage === "markdown" || previewLanguage === "html") && (
            <ArtifactFilePreview
              filepath={previewFilepath}
              threadId={threadId}
              content={displayContent}
              isLoading={isContentLoading}
              error={contentError}
              language={previewLanguage ?? "text"}
              activeHeading={activePreviewTarget?.heading ?? null}
              activeLine={activePreviewTarget?.line ?? null}
              revealSequence={activePreviewTarget?.revealSequence ?? null}
            />
          )}
        {isCodeFile && viewMode === "code" && (
          <CodeEditor
            className="size-full resize-none rounded-none border-none"
            value={displayContent ?? ""}
            readonly
          />
        )}
        {isOfficeFile && officeDescriptor && (
          <OfficeArtifactView
            descriptor={officeDescriptor}
            filepath={filepath}
            threadId={threadId}
            officePreviewUrl={officePreviewUrl}
            isMock={Boolean(isMock)}
            focusPage={activePreviewTarget?.page}
            revealSequence={activePreviewTarget?.revealSequence}
          />
        )}
        {isBinaryPreview && (
          <ArtifactBinaryPreview
            filepath={filepath}
            threadId={threadId}
            isMock={Boolean(isMock)}
            pageNumber={activePreviewTarget?.page}
            revealSequence={activePreviewTarget?.revealSequence}
          />
        )}
      </ArtifactContent>
    </Artifact>
  );
}

export function ArtifactFilePreview({
  filepath,
  threadId,
  content,
  isLoading,
  error,
  language,
  activeHeading = null,
  activeLine = null,
  revealSequence = null,
}: {
  filepath: string;
  threadId: string;
  content: string;
  isLoading: boolean;
  error: unknown;
  language: string;
  activeHeading?: string | null;
  activeLine?: number | null;
  revealSequence?: number | null;
}) {
  const { isMock } = useThread();
  const [previewDocument, setPreviewDocument] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);

  useEffect(() => {
    if (language !== "html" || isLoading) {
      setPreviewDocument("");
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    let objectUrls: string[] = [];
    setPreviewLoading(true);
    setPreviewError(null);

    void loadHtmlPreviewDocument({
      html: content,
      filepath,
      threadId,
      isMock,
    })
      .then((result) => {
        if (cancelled) {
          result.objectUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }

        objectUrls = result.objectUrls;
        setPreviewDocument(result.html);
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setPreviewError(loadError);
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [content, filepath, isLoading, isMock, language, threadId]);

  if (language === "markdown") {
    return (
      <ArtifactMarkdownPreview
        filepath={filepath}
        threadId={threadId}
        content={content}
        isMock={Boolean(isMock)}
        activeHeading={activeHeading}
        activeLine={activeLine}
        revealSequence={revealSequence}
      />
    );
  }
  if (language === "html") {
    if (error instanceof Error || previewError instanceof Error) {
      return (
        <ArtifactUnavailableCard
          filepath={filepath}
          label="Preview unavailable"
          description={getArtifactPreviewErrorMessage(error, previewError)}
        />
      );
    }
    if (isLoading || previewLoading || !previewDocument) {
      return (
        <div className="flex size-full items-center justify-center">
          <LoaderIcon className="text-muted-foreground size-5 animate-spin" />
        </div>
      );
    }
    return <iframe className="size-full" srcDoc={previewDocument} />;
  }
  return null;
}

function ArtifactMarkdownPreview({
  filepath,
  threadId,
  content,
  isMock,
  activeHeading,
  activeLine,
  revealSequence,
}: {
  filepath: string;
  threadId: string;
  content: string;
  isMock: boolean;
  activeHeading: string | null;
  activeLine: number | null;
  revealSequence: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const totalLines = useMemo(
    () => Math.max(content.split(/\r?\n/).length, 1),
    [content],
  );
  const components = useMemo(() => {
    const createHeadingComponent =
      (tagName: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      ({ children, ...props }: ComponentProps<"h1">) => {
        const headingText = extractText(children);
        const headingSlug = slugifyHeading(headingText);
        const Tag = tagName;
        return (
          <Tag {...props} data-heading-slug={headingSlug}>
            {children}
          </Tag>
        );
      };
    return {
      a: (props: ComponentProps<"a">) => (
        <ArtifactMarkdownLink
          {...props}
          filepath={filepath}
          threadId={threadId}
          isMock={isMock}
        />
      ),
      img: (props: ComponentProps<"img">) => (
        <ArtifactMarkdownImage
          {...props}
          filepath={filepath}
          threadId={threadId}
          isMock={isMock}
        />
      ),
      h1: createHeadingComponent("h1"),
      h2: createHeadingComponent("h2"),
      h3: createHeadingComponent("h3"),
      h4: createHeadingComponent("h4"),
      h5: createHeadingComponent("h5"),
      h6: createHeadingComponent("h6"),
    };
  }, [filepath, isMock, threadId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    let cancelled = false;
    let timeoutId: number | null = null;
    let attempts = 0;

    const tryReveal = () => {
      if (cancelled || !containerRef.current) {
        return;
      }

      attempts += 1;
      const shouldAllowLineFallback = !activeHeading || attempts >= 4;
      const didReveal = scrollArtifactMarkdownPreview(containerRef.current, {
        activeHeading,
        activeLine,
        totalLines,
        allowLineFallback: shouldAllowLineFallback,
      });

      if (didReveal || attempts >= 6) {
        return;
      }

      timeoutId = window.setTimeout(tryReveal, 60);
    };

    timeoutId = window.setTimeout(tryReveal, 0);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeHeading, activeLine, content, revealSequence, totalLines]);

  return (
    <div ref={containerRef} className="size-full overflow-auto px-4">
      <Streamdown
        className="size-full"
        {...streamdownPlugins}
        components={components}
      >
        {content ?? ""}
      </Streamdown>
    </div>
  );
}

function ArtifactMarkdownLink({
  filepath,
  threadId,
  isMock,
  children,
  href,
  onClick,
  rel,
  target,
  ...props
}: ComponentProps<"a"> & {
  filepath: string;
  threadId: string;
  isMock: boolean;
}) {
  const knowledgeCitation = parseKnowledgeCitationHref(href);
  const internalFilepath = useMemo(() => {
    if (typeof href !== "string") {
      return null;
    }
    return resolveThreadScopedPath(href, filepath);
  }, [filepath, href]);

  if (knowledgeCitation) {
    return (
      <CitationLink
        {...props}
        href={href}
        onClick={onClick}
        rel={rel}
        target={target}
      >
        {children}
      </CitationLink>
    );
  }

  return (
    <a
      {...props}
      href={href}
      rel={internalFilepath ? rel : (rel ?? "noreferrer")}
      target={internalFilepath ? target : (target ?? "_blank")}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !internalFilepath) {
          return;
        }

        event.preventDefault();
        void openArtifactInNewWindow({
          filepath: internalFilepath,
          threadId,
          isMock,
        }).catch((error) => {
          console.error("Failed to open linked artifact:", error);
          toast.error("Failed to open artifact");
        });
      }}
    >
      {children}
    </a>
  );
}

function ArtifactMarkdownImage({
  filepath,
  threadId,
  isMock,
  src,
  alt,
  ...props
}: ComponentProps<"img"> & {
  filepath: string;
  threadId: string;
  isMock: boolean;
}) {
  const { reveal } = useArtifacts();
  const knowledgeTarget = useMemo(
    () => (typeof src === "string" ? parseKnowledgeCitationHref(src) : null),
    [src],
  );
  const internalFilepath = useMemo(() => {
    if (typeof src !== "string" || knowledgeTarget?.kind === "asset") {
      return null;
    }
    return resolveThreadScopedPath(src, filepath);
  }, [filepath, knowledgeTarget?.kind, src]);
  const imageFilepath =
    knowledgeTarget?.kind === "asset"
      ? (knowledgeTarget.assetPath ?? null)
      : internalFilepath;
  const { objectUrl, isLoading, error } = useArtifactObjectUrl({
    filepath: imageFilepath ?? "",
    threadId,
    enabled: Boolean(imageFilepath),
    isMock,
  });

  if (!imageFilepath) {
    return <img {...props} src={src} alt={alt} />;
  }

  if (error instanceof Error) {
    return (
      <span className="text-muted-foreground inline-flex min-h-20 items-center text-xs">
        {`Image unavailable: ${alt ?? getFileName(imageFilepath)}`}
      </span>
    );
  }

  if (isLoading || !objectUrl) {
    return (
      <span className="text-muted-foreground inline-flex min-h-20 items-center text-xs">
        {`Loading image: ${alt ?? getFileName(imageFilepath)}`}
      </span>
    );
  }

  if (knowledgeTarget?.kind === "asset") {
    return (
      <button
        type="button"
        className="inline-flex cursor-pointer"
        onClick={() => {
          reveal({
            filepath: knowledgeTarget.artifactPath,
            page: knowledgeTarget.page,
            heading: knowledgeTarget.heading,
            line: knowledgeTarget.line,
            locatorLabel: knowledgeTarget.locatorLabel,
          });
        }}
      >
        <img {...props} src={objectUrl} alt={alt} />
      </button>
    );
  }

  return <img {...props} src={objectUrl} alt={alt} />;
}

function ArtifactBinaryPreview({
  filepath,
  threadId,
  isMock,
  pageNumber,
  revealSequence,
}: {
  filepath: string;
  threadId: string;
  isMock: boolean;
  pageNumber?: number;
  revealSequence?: number;
}) {
  const { objectUrl, blobType, isLoading, error } = useArtifactObjectUrl({
    filepath,
    threadId,
    enabled: true,
    isMock,
  });
  const mediaType = useMemo(
    () => getArtifactBinaryMediaType(filepath, blobType),
    [blobType, filepath],
  );

  if (error instanceof Error) {
    return (
      <ArtifactUnavailableCard
        filepath={filepath}
        label="Preview unavailable"
        description={error.message}
      />
    );
  }

  if (isLoading || !objectUrl) {
    return (
      <div className="flex size-full items-center justify-center">
        <LoaderIcon className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (mediaType === "image") {
    return (
      <div className="bg-muted/10 flex size-full items-center justify-center overflow-auto p-4">
        <img
          className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
          src={objectUrl}
          alt={getFileName(filepath)}
        />
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <div className="flex size-full items-center justify-center bg-black">
        <video className="size-full" controls src={objectUrl} />
      </div>
    );
  }

  if (mediaType === "audio") {
    return (
      <div className="flex size-full items-center justify-center p-6">
        <audio className="w-full max-w-lg" controls src={objectUrl} />
      </div>
    );
  }

  if (mediaType === "pdf") {
    const previewSrc = setPdfPreviewPage(objectUrl, pageNumber);
    return (
      <iframe
        key={`${objectUrl}:${pageNumber ?? 0}:${revealSequence ?? 0}`}
        className="size-full"
        src={previewSrc}
        title={getFileName(filepath)}
      />
    );
  }

  return (
    <ArtifactUnavailableCard
      filepath={filepath}
      label="Preview unavailable"
      description="This file type cannot be previewed inline yet. Use open or download."
    />
  );
}

function getArtifactBinaryMediaType(filepath: string, blobType: string | null) {
  const normalizedMimeType = blobType?.toLowerCase() ?? "";
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }
  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }
  if (normalizedMimeType === "application/pdf") {
    return "pdf";
  }

  const extension = filepath.split(".").pop()?.toLowerCase() ?? "";
  if (
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "bmp",
      "tiff",
      "ico",
      "webp",
      "svg",
      "heic",
    ].includes(extension)
  ) {
    return "image";
  }
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(extension)) {
    return "video";
  }
  if (
    ["mp3", "wav", "ogg", "aac", "m4a", "flac", "wma", "aiff", "ape"].includes(
      extension,
    )
  ) {
    return "audio";
  }
  if (extension === "pdf") {
    return "pdf";
  }

  return "unsupported";
}

function OfficeArtifactView({
  descriptor,
  filepath,
  threadId,
  officePreviewUrl,
  isMock,
  focusPage,
  revealSequence,
}: {
  descriptor: OnlyOfficeDocumentDescriptor;
  filepath: string;
  threadId: string;
  officePreviewUrl: string | null;
  isMock: boolean;
  focusPage?: number;
  revealSequence?: number;
}) {
  const onlyOfficeMode: OnlyOfficeMode = descriptor.defaultMode;
  const [OnlyOfficeDocumentEditor, setOnlyOfficeDocumentEditor] =
    useState<OnlyOfficeDocumentEditorComponent | null>(null);
  const [editorLoadError, setEditorLoadError] = useState<string | null>(null);
  const [editorRuntimeError, setEditorRuntimeError] = useState<string | null>(
    null,
  );
  const { data, error, isLoading } = useQuery({
    queryKey: ["onlyoffice-config", threadId, filepath, onlyOfficeMode],
    queryFn: () =>
      loadOnlyOfficeConfig({
        filepath,
        threadId,
        mode: onlyOfficeMode,
      }),
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    enabled: !isMock,
  });

  useEffect(() => {
    if (!data) {
      return;
    }

    let cancelled = false;
    setEditorLoadError(null);
    setEditorRuntimeError(null);
    setOnlyOfficeDocumentEditor(null);

    void import("./onlyoffice-document-editor")
      .then((mod) => {
        if (!cancelled) {
          setOnlyOfficeDocumentEditor(() => mod.OnlyOfficeDocumentEditor);
        }
      })
      .catch((loadError) => {
        console.error("Failed to load ONLYOFFICE editor:", loadError);
        if (!cancelled) {
          setEditorLoadError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load ONLYOFFICE editor",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center">
        <LoaderIcon className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <ArtifactUnavailableCard
        filepath={filepath}
        label="Editor unavailable"
        description={
          error instanceof Error
            ? error.message
            : "Configure ONLYOFFICE to enable direct office editing."
        }
        previewArtifact={
          officePreviewUrl
            ? {
                filepath,
                threadId,
                isMock,
              }
            : undefined
        }
      />
    );
  }

  if (focusPage && officePreviewUrl) {
    const previewSrc = setPdfPreviewPage(officePreviewUrl, focusPage);
    return (
      <iframe
        key={`${officePreviewUrl}:${focusPage}:${revealSequence ?? 0}`}
        className="size-full"
        src={previewSrc}
        title={`${getFileName(filepath)} preview`}
      />
    );
  }

  if (!OnlyOfficeDocumentEditor) {
    if (editorLoadError) {
      return (
        <ArtifactUnavailableCard
          filepath={filepath}
          label="Editor unavailable"
          description={editorLoadError}
          previewArtifact={
            officePreviewUrl
              ? {
                  filepath,
                  threadId,
                  isMock,
                }
              : undefined
          }
        />
      );
    }

    return (
      <div className="flex size-full items-center justify-center">
        <LoaderIcon className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (editorRuntimeError) {
    return (
      <ArtifactUnavailableCard
        filepath={filepath}
        label="Editor unavailable"
        description={editorRuntimeError}
        previewArtifact={
          officePreviewUrl
            ? {
                filepath,
                threadId,
                isMock,
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="size-full overflow-hidden bg-white">
      <OnlyOfficeDocumentEditor
        id={`onlyoffice-${threadId}-${getFileName(filepath)}-${onlyOfficeMode}`}
        key={`${threadId}:${filepath}:${onlyOfficeMode}`}
        documentServerUrl={data.documentServerUrl}
        config={data.config}
        onLoadComponentError={(_code: number, errorDescription: string) => {
          toast.error(errorDescription || "Failed to load ONLYOFFICE editor");
        }}
        onEditorError={(_code: number, errorDescription: string) => {
          setEditorRuntimeError(formatOnlyOfficeEditorError(errorDescription));
        }}
      />
    </div>
  );
}

function extractText(children: ComponentProps<"h1">["children"]): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string") {
        return child;
      }
      if (typeof child === "number") {
        return String(child);
      }
      if (
        isValidElement<{ children?: ComponentProps<"h1">["children"] }>(child)
      ) {
        return extractText(child.props.children);
      }
      return "";
    })
    .join(" ")
    .trim();
}

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function scrollArtifactMarkdownPreview(
  container: HTMLElement,
  {
    activeHeading,
    activeLine,
    totalLines,
    allowLineFallback = true,
  }: {
    activeHeading: string | null;
    activeLine: number | null;
    totalLines: number;
    allowLineFallback?: boolean;
  },
) {
  if (activeHeading) {
    const matchingTargets = container.querySelectorAll<HTMLElement>(
      `[data-heading-slug="${activeHeading}"]`,
    );
    if (
      matchingTargets.length === 1 ||
      (matchingTargets.length > 0 && activeLine == null)
    ) {
      matchingTargets[0]?.scrollIntoView({ block: "center", behavior: "auto" });
      return true;
    }
    if (!allowLineFallback) {
      return false;
    }
  }

  if (activeLine != null) {
    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    const ratio =
      totalLines <= 1
        ? 0
        : Math.min(1, Math.max(0, (activeLine - 1) / (totalLines - 1)));
    container.scrollTo({
      top: maxScrollTop * ratio,
      behavior: "auto",
    });
    return true;
  }

  return false;
}

function formatOnlyOfficeEditorError(errorDescription: string) {
  const normalized = errorDescription.trim();
  if (!normalized) {
    return "ONLYOFFICE editor is unavailable for this document.";
  }

  if (
    normalized
      .toLowerCase()
      .includes("document security token is not correctly formed")
  ) {
    return "ONLYOFFICE rejected the document token. Check that gateway ONLYOFFICE_JWT_SECRET matches the ONLYOFFICE server secret.";
  }

  return normalized;
}

function ArtifactUnavailableCard({
  filepath,
  label,
  description,
  previewArtifact,
}: {
  filepath: string;
  label: string;
  description: string;
  previewArtifact?: {
    filepath: string;
    threadId: string;
    isMock: boolean;
  };
}) {
  const [isOpeningPreview, setIsOpeningPreview] = useState(false);

  const handleOpenPreview = useCallback(async () => {
    if (!previewArtifact || isOpeningPreview) {
      return;
    }

    setIsOpeningPreview(true);
    try {
      await openArtifactInNewWindow({
        filepath: previewArtifact.filepath,
        threadId: previewArtifact.threadId,
        isMock: previewArtifact.isMock,
        preview: "pdf",
      });
    } catch (error) {
      console.error("Failed to open artifact preview:", error);
      toast.error("Failed to open PDF preview");
    } finally {
      setIsOpeningPreview(false);
    }
  }, [isOpeningPreview, previewArtifact]);

  return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="bg-muted/20 flex max-w-md flex-col items-center gap-4 rounded-2xl border px-6 py-8 text-center">
        <div className="text-primary">{getFileIcon(filepath, "size-12")}</div>
        <div className="space-y-1">
          <h3 className="text-lg font-medium">
            {getFileExtensionDisplayName(filepath)} · {label}
          </h3>
          <p className="text-muted-foreground text-sm">
            {getFileName(filepath)}
          </p>
        </div>
        <p className="text-muted-foreground text-sm leading-6">{description}</p>
        {previewArtifact && (
          <button
            type="button"
            className="text-primary text-sm underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              void handleOpenPreview();
            }}
            disabled={isOpeningPreview}
          >
            {isOpeningPreview ? "Opening PDF preview..." : "Open PDF preview"}
          </button>
        )}
      </div>
    </div>
  );
}
