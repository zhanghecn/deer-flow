import type { Message } from "@langchain/langgraph-sdk";
import { FileIcon, Loader2Icon } from "lucide-react";
import { memo, useMemo, type ImgHTMLAttributes } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Loader } from "@/components/ai-elements/loader";
import {
  Message as AIElementMessage,
  MessageContent as AIElementMessageContent,
  MessageResponse as AIElementMessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { Task, TaskTrigger } from "@/components/ai-elements/task";
import { Badge } from "@/components/ui/badge";
import {
  appendWorkspacePromptParams,
  buildWorkspaceAgentPath,
  readAgentRuntimeSelection,
} from "@/core/agents";
import { useArtifactObjectUrl } from "@/core/artifacts/hooks";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  inferAgentNameFromNextStepPrompt,
  extractNextStepsFromText,
  extractReasoningContentFromMessage,
  parseUploadedFiles,
  shouldKeepNextStepInCurrentThread,
  stripNextStepsFromText,
  stripUploadedFilesTag,
  type FileInMessage,
} from "@/core/messages/utils";
import {
  humanMessagePlugins,
  workspaceMessageRehypePlugins,
} from "@/core/streamdown";
import { cn } from "@/lib/utils";

import { CopyButton } from "../copy-button";

import { useThread } from "./context";
import { MarkdownContent } from "./markdown-content";

export function MessageListItem({
  className,
  message,
  isLoading,
}: {
  className?: string;
  message: Message;
  isLoading?: boolean;
}) {
  const isHuman = message.type === "human";
  const rawContent = extractContentFromMessage(message);
  const displayContent = isHuman
    ? rawContent
    : stripNextStepsFromText(rawContent);
  return (
    <AIElementMessage
      className={cn("group/conversation-message relative w-full", className)}
      from={isHuman ? "user" : "assistant"}
    >
      <MessageContent
        className={isHuman ? "w-fit" : "w-full"}
        message={message}
        isLoading={isLoading}
      />
      {!isLoading && (
        <MessageToolbar
          className={cn(
            isHuman ? "-bottom-9 justify-end" : "-bottom-8",
            "absolute right-0 left-0 z-20 opacity-0 transition-opacity delay-200 duration-300 group-hover/conversation-message:opacity-100",
          )}
        >
          <div className="flex gap-1">
            <CopyButton
              clipboardData={
                displayContent ??
                extractReasoningContentFromMessage(message) ??
                ""
              }
            />
          </div>
        </MessageToolbar>
      )}
    </AIElementMessage>
  );
}

/**
 * Custom image component that handles artifact URLs
 */
function MessageImage({
  src,
  alt,
  threadId,
  maxWidth = "90%",
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  threadId: string;
  maxWidth?: string;
}) {
  const imgClassName = cn("overflow-hidden rounded-lg", `max-w-[${maxWidth}]`);
  const artifactPath =
    typeof src === "string" && src.startsWith("/mnt/") ? src : null;
  const { objectUrl, isLoading } = useArtifactObjectUrl({
    filepath: artifactPath ?? "",
    threadId,
    enabled: Boolean(artifactPath),
  });

  if (!src) return null;

  if (typeof src !== "string") {
    return <img className={imgClassName} src={src} alt={alt} {...props} />;
  }

  if (!artifactPath) {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img className={imgClassName} src={src} alt={alt} {...props} />
      </a>
    );
  }

  if (isLoading || !objectUrl) {
    return (
      <div className={cn(imgClassName, "bg-muted/20 flex min-h-24 items-center justify-center")}>
        <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
      </div>
    );
  }

  return (
    <a href={objectUrl} target="_blank" rel="noopener noreferrer">
      <img className={imgClassName} src={objectUrl} alt={alt} {...props} />
    </a>
  );
}

function MessageContent_({
  className,
  message,
  isLoading = false,
}: {
  className?: string;
  message: Message;
  isLoading?: boolean;
}) {
  const isHuman = message.type === "human";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeParams = useParams<{ thread_id: string; agent_name?: string }>();
  const threadId = routeParams.thread_id ?? "";
  const { sendMessage, thread, isMock } = useThread();
  const components = useMemo(
    () => ({
      img: (props: ImgHTMLAttributes<HTMLImageElement>) => (
        <MessageImage {...props} threadId={threadId} maxWidth="90%" />
      ),
    }),
    [threadId],
  );

  const rawContent = extractContentFromMessage(message);
  const reasoningContent = extractReasoningContentFromMessage(message);
  const nextSteps = useMemo(
    () => (isHuman ? [] : extractNextStepsFromText(rawContent)),
    [isHuman, rawContent],
  );

  const files = useMemo(() => {
    const files = message.additional_kwargs?.files;
    if (!Array.isArray(files) || files.length === 0) {
      if (rawContent.includes("<uploaded_files>")) {
        // If the content contains the <uploaded_files> tag, we return the parsed files from the content for backward compatibility.
        return parseUploadedFiles(rawContent);
      }
      return null;
    }
    return files as FileInMessage[];
  }, [message.additional_kwargs?.files, rawContent]);

  const contentToDisplay = useMemo(() => {
    if (isHuman) {
      return rawContent ? stripUploadedFilesTag(rawContent) : "";
    }
    return rawContent ? stripNextStepsFromText(rawContent) : "";
  }, [rawContent, isHuman]);

  const currentRuntimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams, routeParams.agent_name),
    [routeParams.agent_name, searchParams],
  );

  async function handleNextStepClick(step: {
    label: string;
    prompt: string;
    agent_name?: string;
    agent_status?: "dev" | "prod";
    execution_backend?: "remote";
    remote_session_id?: string;
    new_chat?: boolean;
  }) {
    const inferredAgentName =
      step.agent_name ?? inferAgentNameFromNextStepPrompt(step.prompt);
    const targetSelection = {
      agentName: inferredAgentName ?? currentRuntimeSelection.agentName,
      agentStatus: step.agent_status ?? currentRuntimeSelection.agentStatus,
      executionBackend:
        step.execution_backend ?? currentRuntimeSelection.executionBackend,
      remoteSessionId:
        step.remote_session_id ?? currentRuntimeSelection.remoteSessionId,
    };

    const runtimeChanged =
      targetSelection.agentName !== currentRuntimeSelection.agentName ||
      targetSelection.agentStatus !== currentRuntimeSelection.agentStatus ||
      targetSelection.executionBackend !==
        currentRuntimeSelection.executionBackend ||
      targetSelection.remoteSessionId !==
        currentRuntimeSelection.remoteSessionId;
    const keepInCurrentThread =
      !runtimeChanged && shouldKeepNextStepInCurrentThread(rawContent, step);
    const shouldStartNewChat =
      !keepInCurrentThread && (step.new_chat === true || runtimeChanged);

    if (!shouldStartNewChat && sendMessage) {
      await sendMessage({
        text: step.prompt,
        files: [],
      });
      return;
    }

    let nextPath = appendWorkspacePromptParams(
      buildWorkspaceAgentPath(targetSelection),
      {
        prompt: step.prompt,
        autoSend: true,
      },
    );
    if (isMock) {
      nextPath += nextPath.includes("?") ? "&mock=true" : "?mock=true";
    }
    void navigate(nextPath);
  }

  const filesList =
    files && files.length > 0 && threadId ? (
      <RichFilesList files={files} threadId={threadId} />
    ) : null;

  // Uploading state: mock AI message shown while files upload
  if (message.additional_kwargs?.element === "task") {
    return (
      <AIElementMessageContent className={className}>
        <Task defaultOpen={false}>
          <TaskTrigger title="">
            <div className="text-muted-foreground flex w-full cursor-default items-center gap-2 text-sm select-none">
              <Loader className="size-4" />
              <span>{contentToDisplay}</span>
            </div>
          </TaskTrigger>
        </Task>
      </AIElementMessageContent>
    );
  }

  // Reasoning-only AI message (no main response content yet)
  if (!isHuman && reasoningContent && !rawContent) {
    return (
      <AIElementMessageContent className={className}>
        <Reasoning isStreaming={isLoading}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      </AIElementMessageContent>
    );
  }

  if (isHuman) {
    const messageResponse = contentToDisplay ? (
      <AIElementMessageResponse
        remarkPlugins={humanMessagePlugins.remarkPlugins}
        rehypePlugins={humanMessagePlugins.rehypePlugins}
        components={components}
      >
        {contentToDisplay}
      </AIElementMessageResponse>
    ) : null;
    return (
      <div className={cn("ml-auto flex flex-col gap-2", className)}>
        {filesList}
        {messageResponse && (
          <AIElementMessageContent className="w-fit">
            {messageResponse}
          </AIElementMessageContent>
        )}
      </div>
    );
  }

  return (
    <AIElementMessageContent className={className}>
      {filesList}
      <MarkdownContent
        content={contentToDisplay}
        isLoading={isLoading}
        rehypePlugins={workspaceMessageRehypePlugins}
        className="my-3"
        components={components}
      />
      {nextSteps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {nextSteps.map((step) => (
            <Suggestion
              key={`${message.id ?? "message"}-${step.label}-${step.prompt}`}
              suggestion={step.label}
              disabled={thread.isLoading}
              onClick={() => {
                void handleNextStepClick(step);
              }}
            />
          ))}
        </div>
      )}
    </AIElementMessageContent>
  );
}

/**
 * Get file extension and check helpers
 */
const getFileExt = (filename: string) =>
  filename.split(".").pop()?.toLowerCase() ?? "";

const FILE_TYPE_MAP: Record<string, string> = {
  json: "JSON",
  csv: "CSV",
  txt: "TXT",
  md: "Markdown",
  py: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  jpeg: "JPEG",
  gif: "GIF",
  svg: "SVG",
  zip: "ZIP",
  tar: "TAR",
  gz: "GZ",
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

function getFileTypeLabel(filename: string): string {
  const ext = getFileExt(filename);
  return FILE_TYPE_MAP[ext] ?? (ext.toUpperCase() || "FILE");
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(getFileExt(filename));
}

/**
 * Format bytes to human-readable size string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * List of files from additional_kwargs.files (with optional upload status)
 */
function RichFilesList({
  files,
  threadId,
}: {
  files: FileInMessage[];
  threadId: string;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap justify-end gap-2">
      {files.map((file, index) => (
        <RichFileCard
          key={`${file.filename}-${index}`}
          file={file}
          threadId={threadId}
        />
      ))}
    </div>
  );
}

/**
 * Single file card that handles FileInMessage (supports uploading state)
 */
function RichFileCard({
  file,
  threadId,
}: {
  file: FileInMessage;
  threadId: string;
}) {
  const { t } = useI18n();
  const isUploading = file.status === "uploading";
  const isImage = isImageFile(file.filename);
  const { objectUrl, isLoading } = useArtifactObjectUrl({
    filepath: file.path ?? "",
    threadId,
    enabled: !isUploading && Boolean(file.path) && isImage,
  });

  if (isUploading) {
    return (
      <div className="bg-background border-border/40 flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 opacity-60 shadow-sm">
        <div className="flex items-start gap-2">
          <Loader2Icon className="text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin" />
          <span
            className="text-foreground truncate text-sm font-medium"
            title={file.filename}
          >
            {file.filename}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="secondary"
            className="rounded px-1.5 py-0.5 text-[10px] font-normal"
          >
            {getFileTypeLabel(file.filename)}
          </Badge>
          <span className="text-muted-foreground text-[10px]">
            {t.uploads.uploading}
          </span>
        </div>
      </div>
    );
  }

  if (!file.path) return null;

  if (isImage) {
    return (
      <div className="group border-border/40 relative block overflow-hidden rounded-lg border">
        {isLoading || !objectUrl ? (
          <div className="bg-muted/20 flex h-32 w-40 items-center justify-center">
            <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
          </div>
        ) : (
          <a href={objectUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={objectUrl}
              alt={file.filename}
              className="h-32 w-auto max-w-60 object-cover transition-transform group-hover:scale-105"
            />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="bg-background border-border/40 flex max-w-50 min-w-30 flex-col gap-1 rounded-lg border p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <FileIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span
          className="text-foreground truncate text-sm font-medium"
          title={file.filename}
        >
          {file.filename}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant="secondary"
          className="rounded px-1.5 py-0.5 text-[10px] font-normal"
        >
          {getFileTypeLabel(file.filename)}
        </Badge>
        <span className="text-muted-foreground text-[10px]">
          {formatBytes(file.size)}
        </span>
      </div>
    </div>
  );
}

const MessageContent = memo(MessageContent_);
