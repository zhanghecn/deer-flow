import {
  Bot,
  Check,
  FileText,
  Loader2,
  Paperclip,
  Send,
  Settings,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  normalizeThreadError,
  shouldIgnoreThreadError,
} from "../lib/thread-error";

import { MarkdownRenderer } from "../components/markdown-renderer";
import {
  createChatSession,
  type ChatActivityStep,
  type ToolCallStep,
} from "../lib/chat-session";
import { resolvePublicAPIBaseURL, uploadPublicAPIFile } from "../lib/public-api";
import { createDemoId } from "../lib/uid";

const SETTINGS_KEY = "demo_chat_settings";
const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024;
const IMAGE_TARGET_RAW_SIZE = Math.floor((API_IMAGE_MAX_BASE64_SIZE * 3) / 4);
const IMAGE_MAX_DIMENSION = 2000;
// Keep the browser-side image preparation aligned with Claude Code's API
// image-block limits so the demo exposes the same compression decision point.
const COMPRESSIBLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/* ─── Types ─────────────────────────────────────────────── */

type AttachmentStatus =
  | "selected"
  | "preparing"
  | "compressing"
  | "uploading"
  | "uploaded"
  | "failed";

type ImageDimensions = {
  width: number;
  height: number;
};

type AttachmentCompression = {
  originalBytes: number;
  preparedBytes: number;
  originalDimensions?: ImageDimensions;
  preparedDimensions?: ImageDimensions;
  outputMimeType?: string;
  didCompress: boolean;
};

type ChatAttachment = {
  id: string;
  file: File;
  uploadFile?: File;
  originalFilename: string;
  filename: string;
  mimeType: string;
  originalBytes: number;
  uploadBytes: number;
  fileId?: string;
  status: AttachmentStatus;
  statusText: string;
  detail?: string;
  compression?: AttachmentCompression;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning: string;
  status: "streaming" | "done" | "error" | "interrupted";
  toolCalls?: ToolCallStep[];
  activities?: ChatActivityStep[];
  attachments?: ChatAttachment[];
};

type ChatSettings = {
  baseURI: string;
  apiKey: string;
  agentName: string;
};

/* ─── Settings helpers ──────────────────────────────────── */

function getDefaultBaseURI(): string {
  return (
    (import.meta.env.VITE_DEMO_PUBLIC_API_BASE_URL as string | undefined)
      ?.trim() || ""
  );
}

function getDefaultAPIKey(): string {
  return (
    (import.meta.env.VITE_DEMO_PUBLIC_API_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_DEMO_HTTP_API_KEY as string | undefined)?.trim() ||
    ""
  );
}

function getDefaultSettings(): ChatSettings {
  return {
    baseURI: getDefaultBaseURI(),
    apiKey: getDefaultAPIKey(),
    agentName:
      getDefaultAgentName() ||
      (import.meta.env.VITE_DEMO_HTTP_AGENT_NAME as string | undefined)
        ?.trim() ||
      "",
  };
}

function loadSettings(): ChatSettings {
  const defaults = getDefaultSettings();
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return {
        ...defaults,
        ...(JSON.parse(raw) as Partial<ChatSettings>),
      };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

function saveSettings(settings: ChatSettings) {
  sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* ─── Agent resolution ──────────────────────────────────── */

function getDefaultAgentName(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("agent");
  const fromEnv = import.meta.env.VITE_DEMO_DEFAULT_AGENT_NAME as
    | string
    | undefined;
  return fromQuery?.trim() || fromEnv?.trim() || null;
}

function getAgentNameFromQuery(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("agent")?.trim() || null;
}

function resolveAgentName(): string | null {
  const fromQuery = getAgentNameFromQuery();
  if (fromQuery) return fromQuery;
  const settings = loadSettings();
  if (settings.agentName?.trim()) return settings.agentName.trim();
  return getDefaultAgentName();
}

/* ─── Utilities ─────────────────────────────────────────── */

function createMessageId() {
  return createDemoId("chat");
}

function createAttachmentId() {
  return createDemoId("attachment");
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimensions(dimensions: ImageDimensions | undefined) {
  if (!dimensions) return "";
  return `${dimensions.width}x${dimensions.height}`;
}

function replaceFileExtension(filename: string, extension: string) {
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  return `${baseName}${extension}`;
}

function isCompressibleImage(file: File) {
  return COMPRESSIBLE_IMAGE_TYPES.has(file.type);
}

function createChatAttachment(file: File): ChatAttachment {
  return {
    id: createAttachmentId(),
    file,
    originalFilename: file.name,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    originalBytes: file.size,
    uploadBytes: file.size,
    status: "selected",
    statusText: "待发送",
  };
}

function readImageElement(file: File): Promise<{
  image: HTMLImageElement;
  dimensions: ImageDimensions;
}> {
  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectURL);
      resolve({
        image,
        dimensions: {
          width: image.naturalWidth,
          height: image.naturalHeight,
        },
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectURL);
      reject(new Error("无法读取图片尺寸"));
    };
    image.src = objectURL;
  });
}

function getScaledDimensions(dimensions: ImageDimensions): ImageDimensions {
  const scale = Math.min(
    1,
    IMAGE_MAX_DIMENSION / Math.max(dimensions.width, 1),
    IMAGE_MAX_DIMENSION / Math.max(dimensions.height, 1),
  );
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

async function compressImageForUpload(file: File): Promise<{
  file: File;
  compression: AttachmentCompression;
  detail: string;
}> {
  const { image, dimensions } = await readImageElement(file);
  const scaledDimensions = getScaledDimensions(dimensions);
  const needsResize =
    scaledDimensions.width !== dimensions.width ||
    scaledDimensions.height !== dimensions.height;
  const needsSizeCompression = file.size > IMAGE_TARGET_RAW_SIZE;

  if (!needsResize && !needsSizeCompression) {
    return {
      file,
      compression: {
        originalBytes: file.size,
        preparedBytes: file.size,
        originalDimensions: dimensions,
        preparedDimensions: dimensions,
        outputMimeType: file.type,
        didCompress: false,
      },
      detail: `无需压缩 · ${formatDimensions(dimensions)} · ${formatBytes(file.size)}`,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = scaledDimensions.width;
  canvas.height = scaledDimensions.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器无法创建图片压缩画布");
  }
  context.drawImage(image, 0, 0, scaledDimensions.width, scaledDimensions.height);

  const attempts: Array<{ mimeType: string; quality?: number }> = [];
  if (file.type === "image/png") {
    attempts.push({ mimeType: "image/png" });
  } else if (file.type === "image/webp") {
    attempts.push({ mimeType: "image/webp", quality: 0.82 });
  }
  attempts.push(
    { mimeType: "image/jpeg", quality: 0.82 },
    { mimeType: "image/jpeg", quality: 0.68 },
    { mimeType: "image/jpeg", quality: 0.52 },
    { mimeType: "image/jpeg", quality: 0.36 },
    { mimeType: "image/jpeg", quality: 0.24 },
  );

  let bestBlob: Blob | null = null;
  let bestType = file.type;
  for (const attempt of attempts) {
    const blob = await canvasToBlob(canvas, attempt.mimeType, attempt.quality);
    if (!blob) continue;
    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
      bestType = attempt.mimeType;
    }
    if (blob.size <= IMAGE_TARGET_RAW_SIZE) {
      bestBlob = blob;
      bestType = attempt.mimeType;
      break;
    }
  }

  if (!bestBlob) {
    throw new Error("图片压缩失败");
  }

  const extension =
    bestType === "image/png"
      ? ".png"
      : bestType === "image/webp"
        ? ".webp"
        : ".jpg";
  const outputName =
    bestType === file.type ? file.name : replaceFileExtension(file.name, extension);
  const compressedFile = new File([bestBlob], outputName, {
    type: bestType,
    lastModified: file.lastModified,
  });

  return {
    file: compressedFile,
    compression: {
      originalBytes: file.size,
      preparedBytes: compressedFile.size,
      originalDimensions: dimensions,
      preparedDimensions: scaledDimensions,
      outputMimeType: bestType,
      didCompress: true,
    },
    detail: `已压缩 ${formatBytes(file.size)} → ${formatBytes(compressedFile.size)} · ${formatDimensions(dimensions)} → ${formatDimensions(scaledDimensions)}`,
  };
}

async function prepareAttachmentForUpload(file: File): Promise<{
  file: File;
  compression: AttachmentCompression;
  detail: string;
}> {
  // Public `/v1/files` stores normal file attachments. Only images get a
  // browser compression pass; documents are uploaded as-is for runtime parsing.
  if (!isCompressibleImage(file)) {
    return {
      file,
      compression: {
        originalBytes: file.size,
        preparedBytes: file.size,
        outputMimeType: file.type || "application/octet-stream",
        didCompress: false,
      },
      detail: "非可压缩图片，按原文件上传",
    };
  }
  return compressImageForUpload(file);
}

function isDemoOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  return normalizeThreadError(error);
}

/* ─── Components ────────────────────────────────────────── */

function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" }) {
  const map = {
    ok: "bg-teal-500",
    warn: "bg-stone-400",
    danger: "bg-red-500",
  };
  return (
    <span className={`inline-block size-2 rounded-full ${map[tone]}`} />
  );
}

function getAttachmentStatusTone(status: AttachmentStatus) {
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  if (status === "uploaded") {
    return "border-teal-200 bg-teal-50 text-teal-700";
  }
  if (
    status === "uploading" ||
    status === "compressing" ||
    status === "preparing"
  ) {
    return "border-stone-200 bg-stone-50 text-stone-700";
  }
  return "border-stone-200 bg-white text-stone-600";
}

function AttachmentStatusIcon({ status }: { status: AttachmentStatus }) {
  if (status === "failed") return <X className="size-3.5 shrink-0" />;
  if (status === "uploaded") return <Check className="size-3.5 shrink-0" />;
  if (
    status === "uploading" ||
    status === "compressing" ||
    status === "preparing"
  ) {
    return <Loader2 className="size-3.5 shrink-0 animate-spin" />;
  }
  return <FileText className="size-3.5 shrink-0" />;
}

function AttachmentList({
  attachments,
  onRemove,
  variant = "input",
}: {
  attachments: ChatAttachment[];
  onRemove?: (id: string) => void;
  variant?: "input" | "message";
}) {
  if (attachments.length === 0) return null;

  const messageVariant = variant === "message";

  return (
    <div className={`flex flex-wrap gap-2 ${messageVariant ? "mt-2" : ""}`}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={`min-w-0 max-w-full rounded-lg border px-2.5 py-2 text-xs shadow-sm ${
            messageVariant
              ? "border-white/25 bg-white/15 text-white shadow-none"
              : getAttachmentStatusTone(attachment.status)
          }`}
          title={`${attachment.originalFilename}\n${attachment.detail ?? attachment.statusText}`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <AttachmentStatusIcon status={attachment.status} />
            <span className="truncate font-medium">
              {attachment.originalFilename}
            </span>
            {onRemove && attachment.status === "selected" && (
              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                className="ml-1 rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                title="移除附件"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div
            className={`mt-1 truncate ${
              messageVariant ? "text-white/75" : "text-stone-500"
            }`}
          >
            {attachment.statusText}
            {attachment.fileId ? ` · ${attachment.fileId}` : ""}
          </div>
          <div
            className={`mt-0.5 truncate font-mono text-[10px] ${
              messageVariant ? "text-white/65" : "text-stone-400"
            }`}
          >
            {formatBytes(attachment.uploadBytes)}
            {attachment.detail ? ` · ${attachment.detail}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatToolArguments(argumentsValue: Record<string, unknown>) {
  if (Object.keys(argumentsValue).length === 0) return "{}";

  try {
    return JSON.stringify(argumentsValue, null, 2) ?? "{}";
  } catch {
    // Tool arguments come from runtime events; keep the UI resilient if a
    // future transport sends a non-JSON-serializable value.
    return String(argumentsValue);
  }
}

function ToolActivityCard({ tool, index }: { tool: ToolCallStep; index: number }) {
  // Tool names are runtime-owned and may change, so the demo renders the
  // event payload directly instead of translating known names into labels.
  const toolArguments = formatToolArguments(tool.arguments);
  const [open, setOpen] = useState(tool.status === "running");

  useEffect(() => {
    if (tool.status === "running") {
      setOpen(true);
    }
  }, [tool.status]);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mb-2 w-full min-w-0 rounded-lg border border-stone-200 bg-white/80 text-left"
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-stone-600 [&::-webkit-details-marker]:hidden">
        <FileText className="size-3.5 shrink-0 text-stone-400" />
        <span className="rounded-md border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[10px] text-stone-500">
          #{index}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono" title={tool.name}>
          {tool.name}
        </span>
        {tool.status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-teal-600" />
        ) : tool.status === "error" ? (
          <X className="size-3.5 shrink-0 text-red-500" />
        ) : (
          <Check className="size-3.5 shrink-0 text-teal-600" />
        )}
      </summary>
      <div className="border-t border-stone-200 px-3 py-2">
        <pre className="whitespace-pre-wrap break-words rounded-md bg-stone-50 px-2.5 py-2 font-mono text-[11px] leading-5 text-stone-600">
          {toolArguments}
        </pre>
      </div>
    </details>
  );
}

function ActivityTimeline({
  activities,
  isStreaming,
}: {
  activities: ChatActivityStep[];
  isStreaming: boolean;
}) {
  if (activities.length === 0) return null;

  let toolIndex = 0;

  return (
    <div className="mb-1.5 w-full min-w-0">
      {activities.map((activity, index) => {
        if (activity.kind === "reasoning") {
          return (
            <ReasoningCard
              key={activity.id}
              reasoning={activity.text}
              isStreaming={
                isStreaming &&
                index === activities.length - 1 &&
                activity.status === "running"
              }
            />
          );
        }

        toolIndex += 1;
        return (
          <ToolActivityCard
            key={activity.id}
            tool={activity.tool}
            index={toolIndex}
          />
        );
      })}
    </div>
  );
}

function ReasoningCard({
  reasoning,
  isStreaming,
}: {
  reasoning: string;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(isStreaming);
  const wasStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setOpen(true);
    } else if (wasStreamingRef.current) {
      setOpen(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  if (!reasoning || reasoning.trim().length === 0) return null;

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mb-2 w-full min-w-0 rounded-lg border border-stone-200 bg-white/80 text-left"
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-stone-600 [&::-webkit-details-marker]:hidden">
        <Sparkles className="size-3.5 shrink-0 text-teal-600" />
        <span>思考过程</span>
        {isStreaming && (
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-teal-600">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-teal-500" />
            思考中
          </span>
        )}
      </summary>
      <div className="border-t border-stone-200 px-3 py-2">
        <div className="whitespace-pre-wrap break-words text-[12px] leading-6 text-stone-600">
          {reasoning}
        </div>
      </div>
    </details>
  );
}

function ConfigurationWarning({
  agentName,
  baseURLIsDemo,
}: {
  agentName: string | null;
  baseURLIsDemo: boolean;
}) {
  if (!agentName) {
    return <>请在设置中配置 Agent 名称，或在 URL 中指定 ?agent=</>;
  }
  if (baseURLIsDemo) {
    return <>Base URI 不能留空（否则会请求到 demo 自身导致 404），请在设置中填写</>;
  }
  return <>请在右上角设置中填写 API Key</>;
}

/* ─── Main Chat Page ────────────────────────────────────── */

export function ChatPage() {
  const agentName = resolveAgentName();
  const agentNameFromQuery = getAgentNameFromQuery();

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<ReturnType<typeof createChatSession> | null>(null);
  const sessionKeyRef = useRef("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const [settings, setSettingsState] = useState<ChatSettings>(loadSettings);
  const [baseURIInput, setBaseURIInput] = useState(settings.baseURI);
  const [apiKeyInput, setApiKeyInput] = useState(settings.apiKey);
  const [agentNameInput, setAgentNameInput] = useState(
    settings.agentName || getDefaultAgentName() || "",
  );

  const resolvedBaseURL = resolvePublicAPIBaseURL(baseURIInput || null);
  const baseURLIsDemo = isDemoOrigin(resolvedBaseURL);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = messages.length === 0;
  const isConfigured =
    agentName != null && agentName.trim() !== "" && apiKeyInput.trim() !== "" && !baseURLIsDemo;
  const canSend =
    (draft.trim().length > 0 || attachments.length > 0) &&
    !isStreaming &&
    isConfigured;

  /* The demo chat owns a light surface while the workbench keeps dark globals. */
  useEffect(() => {
    document.body.style.color = "#292524";
    document.body.style.background = "#f7f6f3";
    return () => {
      document.body.style.color = "";
      document.body.style.background = "";
    };
  }, []);

  /* Sync settings inputs when drawer opens */
  useEffect(() => {
    if (settingsOpen) {
      setBaseURIInput(settings.baseURI);
      setApiKeyInput(settings.apiKey);
      setAgentNameInput(settings.agentName || getDefaultAgentName() || "");
    }
  }, [settingsOpen, settings]);

  /* Auto-scroll */
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  /* Auto-resize textarea */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const ensureSession = useCallback(() => {
    const configKey = `${resolvedBaseURL}\n${apiKeyInput.trim()}\n${agentName ?? ""}`;
    if (!sessionRef.current || sessionKeyRef.current !== configKey) {
      sessionRef.current = createChatSession({
        baseURL: resolvedBaseURL,
        apiToken: apiKeyInput.trim(),
        agent: agentName ?? "",
      });
      sessionKeyRef.current = configKey;
    }
    return sessionRef.current;
  }, [resolvedBaseURL, apiKeyInput, agentName]);

  const handleFilesSelected = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList ?? []);
    if (selectedFiles.length === 0) return;
    setAttachments((prev) => [
      ...prev,
      ...selectedFiles.map(createChatAttachment),
    ]);
    setError(null);
  }, []);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleFilesSelected(event.target.files);
      event.target.value = "";
    },
    [handleFilesSelected],
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    const attachmentsForTurn = attachments;
    if (
      (!text && attachmentsForTurn.length === 0) ||
      isStreaming ||
      !isConfigured
    ) {
      return;
    }

    const userId = createMessageId();
    const assistantMessageId = createMessageId();
    const abortController = new AbortController();
    abortRef.current = abortController;

    setDraft("");
    setAttachments([]);
    setError(null);
    setIsStreaming(true);

    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: "user",
        content: text,
        reasoning: "",
        status: "done",
        attachments: attachmentsForTurn,
      },
    ]);

    const updateUserAttachment = (
      attachmentId: string,
      patch: Partial<ChatAttachment>,
    ) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === userId
            ? {
                ...message,
                attachments: (message.attachments ?? []).map((attachment) =>
                  attachment.id === attachmentId
                    ? { ...attachment, ...patch }
                    : attachment,
                ),
              }
            : message,
        ),
      );
    };

    let assistantCreated = false;

    void (async () => {
      let latestPhase:
        | "streaming"
        | "waiting"
        | "ready"
        | "failed"
        | "interrupted" = "streaming";
      let latestError = "";

      try {
        const uploadedFileIds: string[] = [];
        // The SDK-style attachment contract is two-step: upload to `/v1/files`,
        // then reference the returned opaque ids from `/v1/turns input.file_ids`.
        for (const attachment of attachmentsForTurn) {
          updateUserAttachment(attachment.id, {
            status: isCompressibleImage(attachment.file)
              ? "compressing"
              : "preparing",
            statusText: isCompressibleImage(attachment.file)
              ? "压缩检查中"
              : "检查附件",
          });

          try {
            const prepared = await prepareAttachmentForUpload(attachment.file);
            updateUserAttachment(attachment.id, {
              uploadFile: prepared.file,
              filename: prepared.file.name,
              mimeType: prepared.file.type || attachment.mimeType,
              uploadBytes: prepared.file.size,
              compression: prepared.compression,
              detail: prepared.detail,
              status: "uploading",
              statusText: "上传到 /v1/files",
            });

            const uploaded = await uploadPublicAPIFile({
              baseURL: resolvedBaseURL,
              apiToken: apiKeyInput.trim(),
              file: prepared.file,
              purpose: "assistants",
              signal: abortController.signal,
            });
            uploadedFileIds.push(uploaded.id);
            updateUserAttachment(attachment.id, {
              fileId: uploaded.id,
              filename: uploaded.filename,
              uploadBytes: uploaded.bytes,
              status: "uploaded",
              statusText: "已加入 input.file_ids",
            });
          } catch (attachmentError) {
            updateUserAttachment(attachment.id, {
              status: "failed",
              statusText: "附件处理失败",
              detail: getErrorMessage(attachmentError),
            });
            throw attachmentError;
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            reasoning: "",
            status: "streaming",
            toolCalls: [],
            activities: [],
          },
        ]);
        assistantCreated = true;

        const session = ensureSession();
        const result = await session.prompt({
          text,
          fileIds: uploadedFileIds.length > 0 ? uploadedFileIds : undefined,
          stream: true,
          signal: abortController.signal,
          metadata: {
            demo_surface: "mcp_workbench_chat",
            attachment_count: uploadedFileIds.length,
          },
          onUpdate: ({
            text: liveText,
            reasoning: liveReasoning,
            phase,
            error: liveError,
          }) => {
            latestPhase = phase;
            latestError = liveError ?? latestError;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      // Failed public runs can terminate without a turn snapshot.
                      // Preserve the streamed content when present, otherwise
                      // surface the normalized terminal error inline.
                      content:
                        liveText ||
                        m.content ||
                        (phase === "failed" && liveError
                          ? `Error: ${liveError}`
                          : ""),
                      reasoning: liveReasoning,
                      status:
                        phase === "failed"
                          ? "error"
                          : phase === "interrupted"
                            ? "interrupted"
                            : phase === "ready"
                              ? "done"
                              : "streaming",
                    }
                  : m,
              ),
            );
            if (phase === "failed" && liveError) {
              setError(liveError);
            }
          },
          onActivity: (activity) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMessageId) return m;
                const activities = m.activities ?? [];
                const existing = activities.find((item) => item.id === activity.id);
                if (existing) {
                  return {
                    ...m,
                    activities: activities.map((item) =>
                      item.id === activity.id ? activity : item,
                    ),
                  };
                }
                return { ...m, activities: [...activities, activity] };
              }),
            );
          },
          onToolCall: (tool) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMessageId || !m.toolCalls) return m;
                const existing = m.toolCalls.find((t) => t.id === tool.id);
                if (existing) {
                  return {
                    ...m,
                    toolCalls: m.toolCalls.map((t) =>
                      t.id === tool.id ? tool : t,
                    ),
                  };
                }
                return { ...m, toolCalls: [...m.toolCalls, tool] };
              }),
            );
          },
        });

        if (!result.turn) {
          if (latestError) {
            const detail = latestError || "Request failed";
            setError(detail);
            toast.error(detail);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      status: "error",
                      content: m.content || `Error: ${detail}`,
                    }
                  : m,
              ),
            );
          }
          return;
        }

        const finalStatus =
          result.turn.status === "completed" ||
          result.turn.status === "requires_input"
            ? "done"
            : "error";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: result.turn?.output_text?.trim() || m.content,
                  status: finalStatus,
                }
              : m,
          ),
        );
      } catch (err) {
        if (shouldIgnoreThreadError(err)) {
          if (assistantCreated) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, status: "interrupted" }
                  : m,
              ),
            );
          }
          return;
        }
        const detail = getErrorMessage(err);
        setError(detail);
        toast.error(detail);
        if (assistantCreated) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    status: "error",
                    content: m.content || `Error: ${detail}`,
                  }
                : m,
            ),
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    })();
  }, [
    draft,
    attachments,
    isStreaming,
    isConfigured,
    resolvedBaseURL,
    apiKeyInput,
    ensureSession,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const handleSaveSettings = useCallback(() => {
    const next = {
      baseURI: baseURIInput.trim(),
      apiKey: apiKeyInput.trim(),
      agentName: agentNameInput.trim(),
    };
    setSettingsState(next);
    saveSettings(next);
    setSettingsOpen(false);
    toast.success("设置已保存");
  }, [baseURIInput, apiKeyInput, agentNameInput]);

  const handleResetChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current?.reset();
    setMessages([]);
    setAttachments([]);
    setIsStreaming(false);
    setError(null);
    setSettingsOpen(false);
  }, []);

  /* ─── Render ────────────────────────────────────────────── */

  return (
    <div className="demo-chat-shell flex h-screen flex-col overflow-hidden bg-[#f7f6f3] text-stone-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-[#fbfaf8]/95 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-teal-700">
            <Bot className="size-5" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-800">
              AI 助手
            </span>
            {isConfigured ? (
              <StatusDot tone="ok" />
            ) : (
              <StatusDot tone="warn" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            title="设置"
          >
            <Settings className="size-5" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-5">
        {empty ? (
          <div className="flex flex-col items-center justify-center px-2 pt-16 text-center sm:pt-20">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-stone-200 bg-white text-teal-700 sm:h-16 sm:w-16">
              <Bot className="size-8 sm:size-9" />
            </div>
            <h1 className="mx-auto mb-2 max-w-[22rem] text-lg font-semibold leading-8 text-stone-900 sm:max-w-none sm:text-xl">
              你好，我是{" "}
              <span className="block break-words text-teal-700 sm:inline">
                {agentName ?? "AI"} 助手
              </span>
            </h1>
            <p className="max-w-md text-center text-sm leading-6 text-stone-500 sm:max-w-2xl">
              有什么可以帮您的吗？请输入您的问题，我会尽力为您解答。
            </p>
            {!isConfigured && (
              <div className="mt-6 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                <ConfigurationWarning
                  agentName={agentName}
                  baseURLIsDemo={baseURLIsDemo}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[92%] rounded-lg rounded-tr-sm bg-stone-900 px-4 py-2.5 text-sm leading-6 text-white sm:max-w-[78%]">
                    {msg.content ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <p className="text-white/80">已发送附件</p>
                    )}
                    <AttachmentList
                      attachments={msg.attachments ?? []}
                      variant="message"
                    />
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex justify-start">
                  {/* Keep the assistant lane width stable while tool events stream in. */}
                  <div className="w-full min-w-0 max-w-[96%] sm:max-w-[90%]">
                    {/* Reasoning */}
                    {(!msg.activities || msg.activities.length === 0) &&
                      msg.reasoning &&
                      msg.reasoning.trim().length > 0 && (
                      <div className="mb-1.5 w-full min-w-0">
                        <ReasoningCard
                          reasoning={msg.reasoning}
                          isStreaming={msg.status === "streaming"}
                        />
                      </div>
                    )}

                    {/* Thinking and tool calls stay in SSE order. */}
                    {msg.activities && msg.activities.length > 0 ? (
                      <ActivityTimeline
                        activities={msg.activities}
                        isStreaming={msg.status === "streaming"}
                      />
                    ) : (
                      msg.toolCalls &&
                      msg.toolCalls.length > 0 && (
                        <div className="mb-1.5 w-full min-w-0">
                          {msg.toolCalls.map((tool, index) => (
                            <ToolActivityCard
                              key={tool.id}
                              tool={tool}
                              index={index + 1}
                            />
                          ))}
                        </div>
                      )
                    )}

                    <div
                      className={`w-full min-w-0 rounded-lg rounded-tl-sm border bg-white px-4 py-3 shadow-[0_1px_2px_rgba(28,25,23,0.04)] ${
                        msg.status === "error"
                          ? "border-red-200 bg-red-50"
                          : "border-stone-200"
                      }`}
                    >
                      {msg.status === "streaming" &&
                      msg.content.length === 0 &&
                      !msg.reasoning &&
                      (!msg.activities || msg.activities.length === 0) &&
                      (!msg.toolCalls || msg.toolCalls.length === 0) ? (
                        <div className="flex items-center gap-2 text-stone-400">
                          <Loader2 className="size-4 animate-spin" />
                          <span>思考中…</span>
                        </div>
                      ) : msg.status === "interrupted" &&
                        msg.content.length === 0 ? (
                        <div className="text-sm leading-6 text-stone-500">
                          已中断
                        </div>
                      ) : (
                        <div className="text-sm leading-6 text-stone-700">
                          <MarkdownRenderer
                            content={msg.content}
                            isStreaming={msg.status === "streaming"}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}

            {error && (
              <div className="flex justify-center">
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                  {error}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-stone-200 bg-[#fbfaf8] px-4 py-3">
        <div className="mx-auto max-w-5xl">
          {!isConfigured && !empty && (
            <div className="mb-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700">
              {!agentName
                ? "请在设置中配置 Agent 名称，或在 URL 中指定 ?agent="
                : baseURLIsDemo
                  ? "Base URI 不能留空，请在设置中填写正确的 API 地址"
                  : "请在右上角设置中填写 API Key"}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          {attachments.length > 0 && (
            <div className="mb-2">
              <AttachmentList
                attachments={attachments}
                onRemove={handleRemoveAttachment}
              />
            </div>
          )}
          <div className="flex items-end gap-2 rounded-lg border border-stone-300 bg-white p-2 transition-colors focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isConfigured || isStreaming}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
              title="添加 SDK 附件"
            >
              <Paperclip className="size-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息"
              rows={1}
              disabled={!isConfigured || isStreaming}
              className="min-h-[40px] max-h-[160px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-stone-800 placeholder-stone-400 outline-none disabled:opacity-50"
              style={{ height: "auto" }}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-stone-200 text-stone-700 transition-colors hover:bg-stone-300"
                title="停止"
              >
                <Square className="size-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
                title="发送"
              >
                <Send className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-stone-400">
            内容由 AI 生成，仅供参考
          </p>
        </div>
      </div>

      {/* Settings Drawer */}
      {settingsOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setSettingsOpen(false)}
          />
          <aside className="fixed top-0 right-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-stone-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
              <h2 className="text-base font-semibold text-stone-900">设置</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-stone-700">
                  Base URI
                </label>
                <input
                  type="text"
                  value={baseURIInput}
                  onChange={(e) => setBaseURIInput(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
                <p className="text-xs text-stone-500">
                  留空则使用默认地址
                </p>
                <p className="text-xs font-mono text-stone-500">
                  解析后: {resolvedBaseURL}
                </p>
                {baseURLIsDemo && (
                  <p className="text-xs text-red-500">
                    解析地址与当前页面同源，会导致请求 404，请填写正确的 API 地址
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-stone-700">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="df_..."
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
                <p className="text-xs text-stone-500">
                  仅保存在 sessionStorage，关闭标签页后清除
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-stone-700">
                  Agent 名称
                </label>
                <input
                  type="text"
                  value={agentNameInput}
                  onChange={(e) => setAgentNameInput(e.target.value)}
                  placeholder="support-cases-http-demo"
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
                {agentNameFromQuery ? (
                  <p className="text-xs text-stone-600">
                    当前由 URL 参数 ?agent={agentNameFromQuery} 控制，修改设置不会生效
                  </p>
                ) : (
                  <p className="text-xs text-stone-500">
                    来源优先级: URL ?agent= &gt; 设置 &gt; VITE_DEMO_DEFAULT_AGENT_NAME
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="flex-1 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={handleResetChat}
                  className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50"
                >
                  清空对话
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
