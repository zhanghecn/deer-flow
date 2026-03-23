import { useQuery } from "@tanstack/react-query";
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
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const { artifacts, setOpen, select } = useArtifacts();
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
          />
        )}
        {isBinaryPreview && (
          <ArtifactBinaryPreview
            filepath={filepath}
            threadId={threadId}
            isMock={Boolean(isMock)}
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
}: {
  filepath: string;
  threadId: string;
  content: string;
  isLoading: boolean;
  error: unknown;
  language: string;
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
}: {
  filepath: string;
  threadId: string;
  content: string;
  isMock: boolean;
}) {
  const components = useMemo(() => {
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
    };
  }, [filepath, isMock, threadId]);

  return (
    <div className="size-full px-4">
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
  const internalFilepath = useMemo(() => {
    if (typeof href !== "string") {
      return null;
    }
    return resolveThreadScopedPath(href, filepath);
  }, [filepath, href]);

  if (typeof children === "string") {
    const match = /^citation:(.+)$/.exec(children);
    if (match) {
      const [, text] = match;
      return (
        <CitationLink
          href={href}
          onClick={onClick}
          rel={rel}
          target={target}
          {...props}
        >
          {text}
        </CitationLink>
      );
    }
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
  const internalFilepath = useMemo(() => {
    if (typeof src !== "string") {
      return null;
    }
    return resolveThreadScopedPath(src, filepath);
  }, [filepath, src]);
  const { objectUrl, isLoading, error } = useArtifactObjectUrl({
    filepath: internalFilepath ?? "",
    threadId,
    enabled: Boolean(internalFilepath),
    isMock,
  });

  if (!internalFilepath) {
    return <img {...props} src={src} alt={alt} />;
  }

  if (error instanceof Error) {
    return (
      <span className="text-muted-foreground inline-flex min-h-20 items-center text-xs">
        {`Image unavailable: ${alt ?? getFileName(internalFilepath)}`}
      </span>
    );
  }

  if (isLoading || !objectUrl) {
    return (
      <span className="text-muted-foreground inline-flex min-h-20 items-center text-xs">
        {`Loading image: ${alt ?? getFileName(internalFilepath)}`}
      </span>
    );
  }

  return <img {...props} src={objectUrl} alt={alt} />;
}

function ArtifactBinaryPreview({
  filepath,
  threadId,
  isMock,
}: {
  filepath: string;
  threadId: string;
  isMock: boolean;
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
    return <iframe className="size-full" src={objectUrl} />;
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
}: {
  descriptor: OnlyOfficeDocumentDescriptor;
  filepath: string;
  threadId: string;
  officePreviewUrl: string | null;
  isMock: boolean;
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
        previewUrl={officePreviewUrl}
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
          previewUrl={officePreviewUrl}
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
        previewUrl={officePreviewUrl}
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
  previewUrl,
}: {
  filepath: string;
  label: string;
  description: string;
  previewUrl?: string | null;
}) {
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
        {previewUrl && (
          <a
            className="text-primary text-sm underline underline-offset-4"
            href={previewUrl}
            target="_blank"
          >
            Open PDF preview
          </a>
        )}
      </div>
    </div>
  );
}
