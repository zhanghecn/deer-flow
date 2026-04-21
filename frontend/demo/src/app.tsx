import { Tree, type NodeRendererProps } from "react-arborist";
import {
  FolderPlus,
  ChevronRight,
  Copy,
  FileCode2,
  FileText,
  Files,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  deleteWorkbenchFile,
  fetchWorkbenchFilePreview,
  fetchWorkbenchFiles,
  fetchWorkbenchHealth,
  fetchWorkbenchToolCatalog,
  invokeWorkbenchTool,
  scanWorkbenchMcp,
  resetWorkbenchFiles,
  type McpDiscoveredTool,
  type McpScanResponse,
  uploadWorkbenchFiles,
  type StoredFileRow,
  type ToolCatalogEntry,
  type WorkbenchHealth,
} from "./lib/workbench-api";

type ToolDraftState = Record<string, string>;

type ExplorerNode = {
  id: string;
  name: string;
  path: string;
  nodeType: "directory" | "file";
  children: ExplorerNode[] | null;
  file?: StoredFileRow;
};

type InvocationRecord = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "running" | "succeeded" | "failed";
  executedAt: number | null;
  transport?: string;
  sessionId?: string | null;
  latencyMs?: number | null;
  result?: unknown;
  rawResult?: unknown;
  errorText?: string;
};

const DEFAULT_WORKBENCH_BASE_URL =
  import.meta.env.VITE_DEMO_WORKBENCH_BASE_URL?.trim() ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://127.0.0.1:8084");

const TOOL_PRESETS: Record<
  string,
  Array<{ label: string; values: Record<string, string> }>
> = {
  fs_ls: [
    { label: "当前目录", values: { path: "", cursor: "0", limit: "100" } },
  ],
  fs_read: [
    { label: "读取前 2000 行", values: { offset: "0", limit: "2000" } },
  ],
  fs_grep: [
    {
      label: "搜索夏仲奇",
      values: {
        pattern: "夏仲奇",
        path: "",
        glob: "*",
        output_mode: "content",
        cursor: "0",
        limit: "20",
      },
    },
  ],
  fs_glob: [
    { label: "匹配 *.md", values: { pattern: "*.md", path: "" } },
  ],
};

type PendingUploadFile = {
  file: File;
  relativePath: string;
};

type DragDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

function uid() {
  return crypto.randomUUID();
}

function buildDefaultMcpURL(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "")}/mcp-http/mcp`;
}

function parseInvocationTimestamp(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatClock(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatLatency(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "耗时未知";
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function describeMcpState(scan: McpScanResponse | null) {
  if (!scan) {
    return {
      label: "未扫描",
      tone: "warn" as const,
      detail: "尚未执行 MCP 协议探测",
    };
  }
  if (!scan.reachable) {
    return {
      label: "探测失败",
      tone: "danger" as const,
      detail: scan.error ?? "MCP 端点不可用",
    };
  }
  return {
    label: `发现 ${scan.tool_count} 个工具`,
    tone: "ok" as const,
    detail: `${scan.server_info?.name ?? "MCP server"} · ${formatLatency(scan.latency_ms)}`,
  };
}

function prettyJSON(value: unknown, maxLength = 10000) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch {
    return String(value);
  }
}

function seedDraft(tool: ToolCatalogEntry) {
  return tool.arguments.reduce<ToolDraftState>((accumulator, item) => {
    accumulator[item.name] =
      item.default === null || item.default === undefined
        ? ""
        : String(item.default);
    return accumulator;
  }, {});
}

function syncToolDrafts(
  currentDrafts: Record<string, ToolDraftState>,
  tools: ToolCatalogEntry[],
) {
  const nextDrafts = { ...currentDrafts };
  for (const tool of tools) {
    nextDrafts[tool.name] = currentDrafts[tool.name] ?? seedDraft(tool);
  }
  return nextDrafts;
}

function summarizeResult(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return "原始返回";
  }
  const payload = result as Record<string, unknown>;
  const items = Array.isArray(payload.items) ? payload.items.length : null;
  const total =
    typeof payload.total === "number"
      ? payload.total
      : typeof payload.saved_count === "number"
        ? payload.saved_count
        : null;
  if (items !== null && total !== null) {
    return `${items} items · total ${total}`;
  }
  if (total !== null) {
    return `total ${total}`;
  }
  return "JSON 返回";
}

function derivePathArgument(toolName: string, selectedFilePath: string) {
  if (!selectedFilePath) {
    return "";
  }
  if (toolName === "fs_read") {
    return selectedFilePath;
  }
  const slashIndex = selectedFilePath.lastIndexOf("/");
  return slashIndex >= 0 ? selectedFilePath.slice(0, slashIndex) : "";
}

function getRelativePathFromFile(file: File) {
  const candidate = file.webkitRelativePath?.trim();
  return candidate ? candidate : file.name;
}

function getUploadCategory(relativePath: string) {
  const [category] = relativePath.split("/");
  return category?.trim() || "未分类";
}

function summarizeUploadedBatch(batch: PendingUploadFile[]) {
  const grouped = new Map<string, number>();
  for (const item of batch) {
    const category = getUploadCategory(item.relativePath);
    grouped.set(category, (grouped.get(category) ?? 0) + 1);
  }
  return Array.from(grouped.entries())
    .map(([category, count]) => `${category} · ${count}`)
    .join("，");
}

function readDroppedFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readDirectoryEntries(entry: FileSystemDirectoryEntry) {
  const reader = entry.createReader();
  const entries: FileSystemEntry[] = [];

  // Chromium returns directory children in chunks, so keep reading until the
  // browser signals completion with an empty batch.
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

async function flattenDroppedEntries(
  entry: FileSystemEntry,
  prefix = "",
): Promise<PendingUploadFile[]> {
  const nextPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await readDroppedFile(entry as FileSystemFileEntry);
    return [{ file, relativePath: nextPath }];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
  const nested = await Promise.all(
    children.map((child) => flattenDroppedEntries(child, nextPath)),
  );
  return nested.flat();
}

async function collectDroppedFiles(dataTransfer: DataTransfer) {
  const entryItems = Array.from(dataTransfer.items ?? []) as DragDataTransferItem[];
  const entries = entryItems
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry !== null && entry !== undefined);

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((entry) => flattenDroppedEntries(entry)));
    return nested.flat();
  }

  return Array.from(dataTransfer.files ?? []).map((file) => ({
    file,
    relativePath: getRelativePathFromFile(file),
  }));
}

function compareExplorerNodes(left: ExplorerNode, right: ExplorerNode) {
  if (left.nodeType !== right.nodeType) {
    return left.nodeType === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

function sortExplorerNodes(nodes: ExplorerNode[]) {
  nodes.sort(compareExplorerNodes);
  for (const node of nodes) {
    if (node.children) {
      sortExplorerNodes(node.children);
    }
  }
}

function buildExplorerTree(files: StoredFileRow[]) {
  const roots: ExplorerNode[] = [];
  const seen = new Map<string, ExplorerNode>();

  // Convert flat file paths into a stable directory tree so the workbench
  // matches how operators inspect files in editors like VS Code.
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let children = roots;
    let currentPath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = seen.get(currentPath);

      if (!node) {
        node = {
          id: currentPath,
          name: part,
          path: currentPath,
          nodeType: isFile ? "file" : "directory",
          children: isFile ? null : [],
        };
        seen.set(currentPath, node);
        children.push(node);
      }

      if (isFile) {
        node.file = file;
      } else if (!node.children) {
        node.children = [];
      }

      children = node.children ?? [];
    }
  }

  sortExplorerNodes(roots);
  return roots;
}

function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--text)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "accent";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-500/30 text-rose-300 hover:border-rose-400/50 hover:bg-rose-500/10"
      : tone === "accent"
        ? "border-cyan-500/30 text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-500/10"
        : "border-[var(--border-strong)] text-[var(--text-soft)] hover:border-zinc-600 hover:bg-zinc-800";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition ${toneClass} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "danger" | "info";
}) {
  const toneMap = {
    ok: "bg-emerald-400",
    warn: "bg-amber-400",
    danger: "bg-rose-400",
    info: "bg-cyan-400",
  } as const;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-zinc-950 px-2.5 py-1 text-[11px] text-[var(--text-soft)]">
      <span className={`inline-block size-2 rounded-full ${toneMap[tone]}`} />
      {label}
    </span>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[var(--code-bg)] p-3 text-xs leading-6 text-[var(--text-soft)]">
      {prettyJSON(value)}
    </pre>
  );
}

function ExplorerTreeNode({
  node,
  style,
}: NodeRendererProps<ExplorerNode>) {
  const isDirectory = node.data.nodeType === "directory";
  const Icon = isDirectory ? (node.isOpen ? FolderOpen : Folder) : FileText;

  return (
    <div style={style} className="px-1">
      <button
        type="button"
        onClick={() => {
          if (isDirectory) {
            node.toggle();
          } else {
            node.select();
            node.activate();
          }
        }}
        className={`flex h-7 w-full items-center gap-1 rounded px-2 text-left text-[13px] transition ${
          node.isSelected
            ? "bg-[#094771] text-zinc-100"
            : "text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        <span className="flex size-4 items-center justify-center text-zinc-500">
          {isDirectory ? (
            <ChevronRight
              className={`size-3.5 transition ${node.isOpen ? "rotate-90" : ""}`}
            />
          ) : null}
        </span>
        <Icon
          className={`size-4 shrink-0 ${
            isDirectory ? "text-[#dcb67a]" : "text-zinc-400"
          }`}
        />
        <span className="min-w-0 truncate">{node.data.name}</span>
      </button>
    </div>
  );
}

export function App() {
  const [workbenchBaseURL, setWorkbenchBaseURL] = useState(DEFAULT_WORKBENCH_BASE_URL);
  const [workbenchHealth, setWorkbenchHealth] = useState<WorkbenchHealth | null>(null);
  const [toolCatalog, setToolCatalog] = useState<ToolCatalogEntry[]>([]);
  const [mcpScan, setMcpScan] = useState<McpScanResponse | null>(null);
  const [storedFiles, setStoredFiles] = useState<StoredFileRow[]>([]);
  const [workbenchLoading, setWorkbenchLoading] = useState(true);
  const [scanPending, setScanPending] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const [isExplorerDragActive, setIsExplorerDragActive] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedFilePreview, setSelectedFilePreview] = useState("");
  const [selectedFileLoading, setSelectedFileLoading] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [selectedToolName, setSelectedToolName] = useState("");
  const [toolDrafts, setToolDrafts] = useState<Record<string, ToolDraftState>>({});
  const [invocations, setInvocations] = useState<InvocationRecord[]>([]);
  const [selectedInvocationId, setSelectedInvocationId] = useState("");
  const [invokePending, setInvokePending] = useState(false);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const folderPickerRef = useRef<HTMLInputElement | null>(null);
  const defaultMcpURL = useMemo(
    () => buildDefaultMcpURL(workbenchBaseURL),
    [workbenchBaseURL],
  );

  const directoryGroups = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const file of storedFiles) {
      const [category] = file.path.split("/");
      const key = category?.trim() || "未分类";
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    return Array.from(grouped.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => left.category.localeCompare(right.category, "zh-CN"));
  }, [storedFiles]);

  const selectedTool = useMemo(
    () => toolCatalog.find((tool) => tool.name === selectedToolName) ?? null,
    [toolCatalog, selectedToolName],
  );
  const selectedDiscoveredTool = useMemo(
    () => mcpScan?.tools.find((tool) => tool.name === selectedToolName) ?? null,
    [mcpScan, selectedToolName],
  );
  const mcpState = useMemo(() => describeMcpState(mcpScan), [mcpScan]);

  const selectedInvocation = useMemo(
    () => invocations.find((item) => item.id === selectedInvocationId) ?? invocations[0] ?? null,
    [invocations, selectedInvocationId],
  );

  const filteredFiles = useMemo(() => {
    const keyword = fileFilter.trim().toLowerCase();
    if (!keyword) {
      return storedFiles;
    }
    return storedFiles.filter((file) => file.path.toLowerCase().includes(keyword));
  }, [storedFiles, fileFilter]);

  const fileTreeData = useMemo(() => buildExplorerTree(filteredFiles), [filteredFiles]);
  const selectedFileEntry = useMemo(
    () => storedFiles.find((item) => item.path === selectedFilePath) ?? null,
    [storedFiles, selectedFilePath],
  );

  useEffect(() => {
    if (!folderPickerRef.current) {
      return;
    }
    // React does not type the directory-picker attributes, but Chromium still
    // requires them for folder uploads.
    folderPickerRef.current.setAttribute("webkitdirectory", "");
    folderPickerRef.current.setAttribute("directory", "");
  }, []);

  async function refreshWorkbench(options?: { preserveSelection?: boolean }) {
    setWorkbenchLoading(true);
    try {
      const [nextHealth, nextToolCatalog, nextFilePayload] = await Promise.all([
        fetchWorkbenchHealth(workbenchBaseURL),
        fetchWorkbenchToolCatalog(workbenchBaseURL),
        fetchWorkbenchFiles(workbenchBaseURL),
      ]);
      setWorkbenchHealth(nextHealth);
      setToolCatalog(nextToolCatalog.tools);
      setStoredFiles(nextFilePayload.items);

      // Tool drafts are owned by the UI so operators can tweak inputs per tool,
      // but we reseed new tools from the backend catalog defaults.
      setToolDrafts((current) => syncToolDrafts(current, nextToolCatalog.tools));

      setSelectedToolName((current) =>
        current && nextToolCatalog.tools.some((tool) => tool.name === current)
          ? current
          : (nextToolCatalog.tools[0]?.name ?? ""),
      );

      const nextSelected =
        options?.preserveSelection && selectedFilePath
          ? nextFilePayload.items.find((item) => item.path === selectedFilePath)?.path
          : nextFilePayload.items[0]?.path ?? "";
      setSelectedFilePath(nextSelected ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载工作台服务失败");
    } finally {
      setWorkbenchLoading(false);
    }
  }

  async function scanMcp(options?: { silent?: boolean }) {
    setScanPending(true);
    try {
      const scanResult = await scanWorkbenchMcp(workbenchBaseURL);
      setMcpScan(scanResult);
      if (!options?.silent) {
        if (scanResult.reachable) {
          toast.success(`MCP 探测完成，发现 ${scanResult.tool_count} 个工具`);
        } else {
          toast.error(scanResult.error ?? "MCP 探测失败");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP 探测失败";
      setMcpScan({
        reachable: false,
        transport: "streamable_http",
        scanned_at: new Date().toISOString(),
        latency_ms: null,
        session_id: null,
        protocol_version: null,
        server_info: null,
        capabilities: null,
        tool_count: 0,
        tools: [],
        error: message,
      });
      if (!options?.silent) {
        toast.error(message);
      }
    } finally {
      setScanPending(false);
    }
  }

  useEffect(() => {
    void refreshWorkbench();
    void scanMcp({ silent: true });
  }, [workbenchBaseURL]);

  useEffect(() => {
    if (!selectedFilePath) {
      setSelectedFilePreview("");
      return;
    }
    let cancelled = false;
    setSelectedFileLoading(true);
    void fetchWorkbenchFilePreview(workbenchBaseURL, selectedFilePath)
      .then((payload) => {
        if (!cancelled) {
          setSelectedFilePreview(payload.content);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "读取文件失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedFileLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workbenchBaseURL, selectedFilePath]);

  async function uploadBatch(batch: PendingUploadFile[]) {
    if (batch.length === 0) {
      toast.error("请先选择文件或文件夹");
      return;
    }

    setUploadPending(true);
    try {
      const result = await uploadWorkbenchFiles({
        baseURL: workbenchBaseURL,
        files: batch.map((item) => item.file),
        relativePaths: batch.map((item) => item.relativePath),
      });
      const uploadSummary = summarizeUploadedBatch(batch);
      toast.success(
        `已写入 ${result.saved_count} 个文件${uploadSummary ? `：${uploadSummary}` : ""}`,
      );
      await refreshWorkbench({ preserveSelection: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploadPending(false);
      if (filePickerRef.current) {
        filePickerRef.current.value = "";
      }
      if (folderPickerRef.current) {
        folderPickerRef.current.value = "";
      }
    }
  }

  async function handlePickerChange(fileList: FileList | null) {
    const batch = Array.from(fileList ?? []).map((file) => ({
      file,
      relativePath: getRelativePathFromFile(file),
    }));
    await uploadBatch(batch);
  }

  async function handleExplorerDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsExplorerDragActive(false);
    const batch = await collectDroppedFiles(event.dataTransfer);
    await uploadBatch(batch);
  }

  async function handleDeleteFile(path: string) {
    try {
      await deleteWorkbenchFile(workbenchBaseURL, path);
      toast.success("已删除文件");
      if (selectedFilePath === path) {
        setSelectedFilePath("");
      }
      await refreshWorkbench({ preserveSelection: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除文件失败");
    }
  }

  async function handleResetFiles() {
    try {
      const result = await resetWorkbenchFiles(workbenchBaseURL);
      toast.success(`已清空 ${result.removed_files} 个文件`);
      await refreshWorkbench();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重置文件失败");
    }
  }

  function updateDraft(toolName: string, argumentName: string, value: string) {
    setToolDrafts((current) => ({
      ...current,
      [toolName]: {
        ...(current[toolName] ?? {}),
        [argumentName]: value,
      },
    }));
  }

  function mergeDraftValues(toolName: string, values: Record<string, string>) {
    setToolDrafts((current) => ({
      ...current,
      [toolName]: {
        ...(current[toolName] ?? {}),
        ...values,
      },
    }));
  }

  function applyPreset(tool: ToolCatalogEntry, values: Record<string, string>) {
    mergeDraftValues(tool.name, values);
  }

  function selectReadTarget(filePath: string) {
    mergeDraftValues("fs_read", { file_path: filePath });
    setSelectedToolName("fs_read");
  }

  function materializeArguments(tool: ToolCatalogEntry) {
    const draft = toolDrafts[tool.name] ?? {};
    const argumentsPayload: Record<string, unknown> = {};

    // Normalize form strings into MCP-compatible JSON so the workbench can behave
    // like a real tool runner instead of leaking raw browser form values.
    for (const argument of tool.arguments) {
      const rawValue = draft[argument.name] ?? "";
      const effectiveValue =
        rawValue.trim() === "" && argument.default !== undefined && argument.default !== null
          ? String(argument.default)
          : rawValue;

      if (effectiveValue.trim() === "") {
        if (argument.required) {
          throw new Error(`${argument.name} 是必填参数`);
        }
        continue;
      }

      if (argument.type === "integer") {
        const parsed = Number(effectiveValue);
        if (!Number.isInteger(parsed)) {
          throw new Error(`${argument.name} 必须是整数`);
        }
        argumentsPayload[argument.name] = parsed;
        continue;
      }

      argumentsPayload[argument.name] = effectiveValue;
    }

    return argumentsPayload;
  }

  async function handleInvokeTool() {
    if (!selectedTool) {
      toast.error("请选择一个工具");
      return;
    }

    let invocationRecord: InvocationRecord | null = null;
    try {
      const argumentsPayload = materializeArguments(selectedTool);
      invocationRecord = {
        id: uid(),
        toolName: selectedTool.name,
        arguments: argumentsPayload,
        status: "running",
        executedAt: Date.now(),
      };
      setInvokePending(true);
      setInvocations((current) => [invocationRecord!, ...current]);
      setSelectedInvocationId(invocationRecord.id);

      const response = await invokeWorkbenchTool({
        baseURL: workbenchBaseURL,
        toolName: selectedTool.name,
        arguments: argumentsPayload,
      });

      setInvocations((current) =>
        current.map((item) =>
          item.id === invocationRecord!.id
            ? {
                ...item,
                status: "succeeded",
                // Keep the optimistic local timestamp when workbench data is incomplete
                // so one bad response field cannot crash the entire acceptance console.
                executedAt:
                  parseInvocationTimestamp(response.executed_at) ?? item.executedAt,
                transport: response.transport,
                sessionId: response.session_id ?? null,
                latencyMs: response.latency_ms ?? null,
                result: response.result,
                rawResult: response.raw_result,
              }
            : item,
        ),
      );
      toast.success(`${selectedTool.name} 已通过 MCP 执行`);
      await scanMcp({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "工具执行失败";
      if (invocationRecord) {
        setInvocations((current) =>
          current.map((item) =>
            item.id === invocationRecord!.id
              ? {
                ...item,
                status: "failed",
                transport: "streamable_http",
                errorText: message,
              }
            : item,
          ),
        );
      }
      toast.error(message);
    } finally {
      setInvokePending(false);
    }
  }

  function copyText(value: string, successText: string) {
    void navigator.clipboard.writeText(value);
    toast.success(successText);
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h1 className="text-base font-medium">MCP 文件调试台</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              只保留文件维护、MCP 工具规范和手动工具调试。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={workbenchHealth ? `${workbenchHealth.file_count} 文件` : "未连接"}
              tone={workbenchHealth ? "ok" : "danger"}
            />
            <StatusBadge label={mcpState.label} tone={mcpState.tone} />
            <StatusBadge
              label={scanPending ? "探测中" : invokePending ? "工具执行中" : "空闲"}
              tone={scanPending || invokePending ? "info" : "ok"}
            />
            <GhostButton
              tone="accent"
              onClick={() =>
                copyText(
                  workbenchHealth?.mcp_url ?? defaultMcpURL,
                  "已复制 MCP 地址",
                )
              }
            >
              <Copy className="size-3.5" />
              复制 MCP URL
            </GhostButton>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1760px] gap-4 px-4 py-4 xl:grid-cols-[320px_minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <Panel
            title="连接信息"
            description="当前页面负责文件库维护、MCP 地址分发、协议扫描和工具联调。"
            actions={
              <div className="flex items-center gap-2">
                <GhostButton
                  tone="accent"
                  disabled={scanPending}
                  onClick={() => void scanMcp()}
                >
                  {scanPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Wrench className="size-3.5" />
                  )}
                  扫描 MCP
                </GhostButton>
                <GhostButton onClick={() => void refreshWorkbench({ preserveSelection: true })}>
                  <RefreshCcw className="size-3.5" />
                  刷新
                </GhostButton>
              </div>
            }
          >
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs text-[var(--muted)]">Workbench Base URL</span>
                <input
                  value={workbenchBaseURL}
                  onChange={(event) => setWorkbenchBaseURL(event.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-cyan-500/50"
                />
              </label>
              <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <HardDrive className="size-3.5" />
                  Storage Root
                </div>
                <p className="mt-1 break-all font-mono text-xs text-[var(--text-soft)]">
                  {workbenchHealth?.storage_root ?? "加载中…"}
                </p>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <Wrench className="size-3.5" />
                  MCP URL
                </div>
                <p className="mt-1 break-all font-mono text-xs text-cyan-300">
                  {workbenchHealth?.mcp_url ?? defaultMcpURL}
                </p>
              </div>
              <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <Wrench className="size-3.5" />
                      MCP 探测状态
                    </div>
                    <p className="mt-1 text-sm text-[var(--text)]">{mcpState.detail}</p>
                  </div>
                  <StatusBadge label={mcpState.label} tone={mcpState.tone} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-[var(--border)] bg-zinc-900 px-3 py-2">
                    <p className="text-[11px] text-[var(--muted)]">上次扫描</p>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">
                      {mcpScan ? formatClock(Date.parse(mcpScan.scanned_at)) : "尚未扫描"}
                    </p>
                  </div>
                  <div className="rounded-md border border-[var(--border)] bg-zinc-900 px-3 py-2">
                    <p className="text-[11px] text-[var(--muted)]">协议/耗时</p>
                    <p className="mt-1 text-xs text-[var(--text-soft)]">
                      {mcpScan?.protocol_version ?? "未知"} · {formatLatency(mcpScan?.latency_ms)}
                    </p>
                  </div>
                </div>
                {mcpScan?.error ? (
                  <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-200">
                    {mcpScan.error}
                  </div>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel
            title="文件资源库"
            description="直接拖文件到 Explorer 即可上传；筛选、目录浏览和删除保持在同一面板。"
          >
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                  <p className="text-xs text-[var(--muted)]">已上传</p>
                  <p className="mt-2 text-sm text-[var(--text)]">{storedFiles.length} 个文件</p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                  <p className="text-xs text-[var(--muted)]">目录分组</p>
                  <p className="mt-2 text-sm text-[var(--text)]">
                    {directoryGroups.length} 个目录
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                  <p className="text-xs text-[var(--muted)]">上传状态</p>
                  <p className="mt-2 text-sm text-[var(--text)]">
                    {uploadPending ? "上传中…" : "空闲"}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  已上传分类
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {directoryGroups.length > 0 ? (
                    directoryGroups.map((group) => (
                      <span
                        key={group.category}
                        className="rounded-md border border-[var(--border)] bg-zinc-900 px-2 py-1 text-[11px] text-[var(--text-soft)]"
                      >
                        {group.category} · {group.count}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--muted)]">磁盘中还没有文件</span>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-2">
                <Search className="size-3.5 text-[var(--muted)]" />
                <input
                  value={fileFilter}
                  onChange={(event) => setFileFilter(event.target.value)}
                  placeholder="按路径过滤"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
                />
              </label>

              {selectedFileEntry ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-[var(--text-soft)]">
                    {selectedFileEntry.path}
                  </code>
                  <GhostButton onClick={() => selectReadTarget(selectedFileEntry.path)}>
                    设为读取目标
                  </GhostButton>
                  <GhostButton
                    tone="danger"
                    onClick={() => void handleDeleteFile(selectedFileEntry.path)}
                  >
                    删除
                  </GhostButton>
                </div>
              ) : null}

              <div
                className={`relative overflow-hidden rounded-md border bg-zinc-950 transition ${
                  isExplorerDragActive
                    ? "border-cyan-400/60 ring-1 ring-cyan-400/40"
                    : "border-[var(--border)]"
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!isExplorerDragActive) {
                    setIsExplorerDragActive(true);
                  }
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    return;
                  }
                  setIsExplorerDragActive(false);
                }}
                onDrop={(event) => void handleExplorerDrop(event)}
              >
                <div className="border-b border-[var(--border)] bg-[#111318] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-medium tracking-[0.18em] text-zinc-500">
                        EXPLORER
                      </span>
                      <span className="text-[11px] text-zinc-600">
                        {filteredFiles.length} files
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <GhostButton
                        tone="accent"
                        disabled={uploadPending}
                        onClick={() => folderPickerRef.current?.click()}
                      >
                        <FolderPlus className="size-3.5" />
                        上传目录
                      </GhostButton>
                      <GhostButton
                        disabled={uploadPending}
                        onClick={() => filePickerRef.current?.click()}
                      >
                        <Files className="size-3.5" />
                        上传文件
                      </GhostButton>
                      <GhostButton
                        onClick={() => void refreshWorkbench({ preserveSelection: true })}
                      >
                        <RefreshCcw className="size-3.5" />
                        刷新
                      </GhostButton>
                      <GhostButton
                        onClick={() => setFileFilter("")}
                        disabled={fileFilter.trim() === ""}
                      >
                        清空筛选
                      </GhostButton>
                      <GhostButton
                        disabled={!selectedFileEntry}
                        onClick={() =>
                          selectedFileEntry
                            ? selectReadTarget(selectedFileEntry.path)
                            : undefined
                        }
                      >
                        <FileCode2 className="size-3.5" />
                        读取目标
                      </GhostButton>
                      <GhostButton
                        tone="danger"
                        disabled={!selectedFileEntry}
                        onClick={() =>
                          selectedFileEntry
                            ? void handleDeleteFile(selectedFileEntry.path)
                            : undefined
                        }
                      >
                        <Trash2 className="size-3.5" />
                        删除
                      </GhostButton>
                    </div>
                  </div>
                </div>
                <input
                  ref={filePickerRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => void handlePickerChange(event.target.files)}
                />
                <input
                  ref={folderPickerRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => void handlePickerChange(event.target.files)}
                />
                {isExplorerDragActive ? (
                  <div className="pointer-events-none absolute inset-x-3 top-14 z-10 rounded-md border border-dashed border-cyan-400/60 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                    直接拖目录或文件到 Explorer，放手后立即上传到当前文件库。
                  </div>
                ) : null}
                {workbenchLoading ? (
                  <div className="px-3 py-8 text-sm text-[var(--muted)]">正在加载文件…</div>
                ) : filteredFiles.length === 0 ? (
                  <div className="px-3 py-8 text-sm text-[var(--muted)]">
                    {storedFiles.length === 0
                      ? "拖目录到这里，或用上方按钮直接上传。"
                      : "没有匹配文件。"}
                  </div>
                ) : (
                  <Tree<ExplorerNode>
                    data={fileTreeData}
                    width="100%"
                    height={360}
                    rowHeight={28}
                    indent={18}
                    padding={6}
                    selection={selectedFilePath || undefined}
                    openByDefault={false}
                    childrenAccessor={(item) => item.children}
                    idAccessor={(item) => item.id}
                    onActivate={(node) => {
                      if (node.data.nodeType === "file") {
                        setSelectedFilePath(node.data.path);
                      }
                    }}
                  >
                    {ExplorerTreeNode}
                  </Tree>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel
            title="工具工作台"
            description="参数表单来自静态规范，但执行和验收都走真实 MCP transport。"
            actions={
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={selectedTool ? selectedTool.name : "未选择"}
                  tone="info"
                />
                <StatusBadge label={mcpState.label} tone={mcpState.tone} />
              </div>
            }
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {toolCatalog.map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => setSelectedToolName(tool.name)}
                    className={`rounded-md border px-3 py-2 text-xs transition ${
                      selectedToolName === tool.name
                        ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                        : "border-[var(--border)] text-[var(--text-soft)] hover:border-zinc-600 hover:bg-zinc-900"
                    }`}
                  >
                    <span className="font-mono">{tool.name}</span>
                  </button>
                ))}
              </div>

              {selectedTool ? (
                <>
                  <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                    <p className="font-mono text-sm text-[var(--text)]">{selectedTool.name}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
                      {selectedTool.summary}
                    </p>
                    <p className="mt-2 text-xs text-cyan-300">
                      当前执行链路：{"HTTP MCP `initialize -> tools/call`"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(TOOL_PRESETS[selectedTool.name] ?? []).map((preset) => (
                        <GhostButton
                          key={preset.label}
                          onClick={() => applyPreset(selectedTool, preset.values)}
                        >
                          {preset.label}
                        </GhostButton>
                      ))}
                      {selectedFilePath &&
                      selectedTool.arguments.some(
                        (item) => item.name === "path" || item.name === "file_path",
                      ) ? (
                        <GhostButton
                          onClick={() =>
                            updateDraft(
                              selectedTool.name,
                              selectedTool.arguments.some(
                                (item) => item.name === "file_path",
                              )
                                ? "file_path"
                                : "path",
                              derivePathArgument(selectedTool.name, selectedFilePath),
                            )
                          }
                        >
                          {selectedTool.name === "fs_read"
                            ? "使用当前文件"
                            : "使用当前目录"}
                        </GhostButton>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedTool.arguments.map((argument) => (
                      <label key={`${selectedTool.name}-${argument.name}`} className="block">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="font-mono text-xs text-[var(--text)]">
                            {argument.name}
                          </span>
                          <span className="text-[11px] text-[var(--muted)]">
                            {argument.type}
                          </span>
                          {argument.required ? (
                            <span className="text-[11px] text-rose-300">required</span>
                          ) : null}
                        </div>
                        <input
                          value={toolDrafts[selectedTool.name]?.[argument.name] ?? ""}
                          onChange={(event) =>
                            updateDraft(selectedTool.name, argument.name, event.target.value)
                          }
                          placeholder={
                            argument.default !== null && argument.default !== undefined
                              ? String(argument.default)
                              : argument.description
                          }
                          className="w-full rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                        />
                        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                          {argument.description}
                        </p>
                      </label>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <GhostButton
                      tone="accent"
                      disabled={invokePending || scanPending}
                      onClick={() => void handleInvokeTool()}
                    >
                      {invokePending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      通过 MCP 执行
                    </GhostButton>
                    <GhostButton
                      disabled={scanPending}
                      onClick={() => void scanMcp()}
                    >
                      <RefreshCcw className="size-3.5" />
                      重新扫描
                    </GhostButton>
                    <GhostButton
                      onClick={() =>
                        setToolDrafts((current) => ({
                          ...current,
                          [selectedTool.name]: seedDraft(selectedTool),
                        }))
                      }
                    >
                      重置参数
                    </GhostButton>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">暂无可用工具。</p>
              )}
            </div>
          </Panel>

          <Panel
            title="返回预览"
            description="查看当前选中调用的 JSON 返回。"
            actions={
              selectedInvocation ? (
                <GhostButton
                  onClick={() =>
                    copyText(
                      prettyJSON(selectedInvocation.result ?? { error: selectedInvocation.errorText }),
                      "已复制返回 JSON",
                    )
                  }
                >
                  <Copy className="size-3.5" />
                  复制返回
                </GhostButton>
              ) : null
            }
          >
            {selectedInvocation ? (
              selectedInvocation.status === "failed" ? (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200">
                  {selectedInvocation.errorText}
                </div>
              ) : (
                <JsonBlock value={selectedInvocation.result ?? { status: "running" }} />
              )
            ) : (
              <p className="text-sm text-[var(--muted)]">执行一次工具后，这里显示 JSON 返回。</p>
            )}
          </Panel>

          <Panel title="文件预览" description="磁盘文件读取仍然走分页接口，避免一次性把整个文件拉进浏览器。">
            {selectedFilePath ? (
              <div className="space-y-2">
                <p className="font-mono text-xs text-[var(--text-soft)]">{selectedFilePath}</p>
                <pre className="max-h-[340px] overflow-y-auto whitespace-pre-wrap rounded-md bg-[var(--code-bg)] p-3 text-xs leading-6 text-[var(--text-soft)]">
                  {selectedFileLoading ? "正在读取文件…" : selectedFilePreview || "文件为空。"}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">从左侧文件列表选择一个文件。</p>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel
            title="MCP 扫描结果"
            description="参考 Claude Code 的发现流程，展示真实 `tools/list` 返回，而不是静态配置。"
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                  <p className="text-xs text-[var(--muted)]">Server</p>
                  <p className="mt-2 text-sm text-[var(--text)]">
                    {mcpScan?.server_info?.name ?? "未探测"}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    {mcpScan?.server_info?.version ?? "版本未知"}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                  <p className="text-xs text-[var(--muted)]">Session / Transport</p>
                  <p className="mt-2 break-all font-mono text-xs text-[var(--text-soft)]">
                    {mcpScan?.session_id ?? "未建立会话"}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    {mcpScan?.transport ?? "streamable_http"}
                  </p>
                </div>
              </div>

              {mcpScan?.tools.length ? (
                <div className="space-y-2">
                  {mcpScan.tools.map((tool: McpDiscoveredTool) => (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => setSelectedToolName(tool.name)}
                      className={`w-full rounded-md border px-3 py-3 text-left transition ${
                        selectedToolName === tool.name
                          ? "border-cyan-500/40 bg-cyan-500/10"
                          : "border-[var(--border)] bg-zinc-950 hover:border-zinc-600"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <code className="text-xs text-cyan-300">{tool.name}</code>
                        <span className="text-[11px] text-[var(--muted)]">
                          {tool.inputSchema ? "schema 已发现" : "无 schema"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
                        {tool.description || "该工具未返回描述。"}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  {scanPending ? "正在扫描 MCP 工具…" : "尚未拿到 `tools/list` 结果。"}
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title="当前工具规范"
            description="左边是本地表单规范，右边对照 MCP 实际返回的 input/output schema。"
          >
            {selectedTool ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <FileCode2 className="size-4 text-cyan-300" />
                    <code className="text-sm text-cyan-300">{selectedTool.name}</code>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
                    {selectedTool.summary}
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-xs text-[var(--muted)]">参数</p>
                  <div className="space-y-2">
                    {selectedTool.arguments.map((argument) => (
                      <div
                        key={`${selectedTool.name}-spec-${argument.name}`}
                        className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-[var(--text)]">{argument.name}</code>
                          <span className="text-[11px] text-[var(--muted)]">
                            {argument.type}
                          </span>
                          {argument.required ? (
                            <span className="text-[11px] text-rose-300">required</span>
                          ) : (
                            <span className="text-[11px] text-[var(--muted)]">optional</span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
                          {argument.description}
                        </p>
                        {argument.default !== null && argument.default !== undefined ? (
                          <p className="mt-1 font-mono text-[11px] text-cyan-300">
                            default = {String(argument.default)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs text-[var(--muted)]">返回</p>
                  <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3 text-sm text-[var(--text-soft)]">
                    {selectedTool.returns}
                  </div>
                </div>
                {selectedDiscoveredTool ? (
                  <>
                    <div>
                      <p className="mb-2 text-xs text-[var(--muted)]">MCP inputSchema</p>
                      <JsonBlock value={selectedDiscoveredTool.inputSchema ?? {}} />
                    </div>
                    <div>
                      <p className="mb-2 text-xs text-[var(--muted)]">MCP outputSchema</p>
                      <JsonBlock value={selectedDiscoveredTool.outputSchema ?? {}} />
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                    当前工具还没有对应的真实扫描结果，请先执行 MCP 扫描。
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">暂无工具规范。</p>
            )}
          </Panel>

          <Panel title="调用记录" description="每次工具执行都会保留参数、状态和返回摘要。">
            {invocations.length > 0 ? (
              <div className="space-y-2">
                {invocations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedInvocationId(item.id)}
                    className={`w-full rounded-md border px-3 py-3 text-left transition ${
                      selectedInvocation?.id === item.id
                        ? "border-cyan-500/40 bg-cyan-500/10"
                        : "border-[var(--border)] bg-zinc-950 hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <code className="text-xs text-[var(--text)]">{item.toolName}</code>
                      <span
                        className={`text-[11px] ${
                          item.status === "failed"
                            ? "text-rose-300"
                            : item.status === "running"
                              ? "text-cyan-300"
                              : "text-emerald-300"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      {formatClock(item.executedAt)} · {formatLatency(item.latencyMs)} ·{" "}
                      {item.status === "failed"
                        ? item.errorText
                        : summarizeResult(item.result)}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">还没有调用记录。</p>
            )}
          </Panel>

          <Panel title="选中调用" description="这里固定显示方法名、参数和最终返回。">
            {selectedInvocation ? (
              <div className="space-y-4">
                <div className="rounded-md border border-[var(--border)] bg-zinc-950 px-3 py-3">
                  <p className="text-xs text-[var(--muted)]">方法</p>
                  <p className="mt-1 font-mono text-sm text-[var(--text)]">
                    {selectedInvocation.toolName}
                  </p>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    {formatClock(selectedInvocation.executedAt)} ·{" "}
                    {selectedInvocation.transport ?? "streamable_http"} ·{" "}
                    {formatLatency(selectedInvocation.latencyMs)}
                  </p>
                  {selectedInvocation.sessionId ? (
                    <p className="mt-2 break-all font-mono text-[11px] text-cyan-300">
                      session: {selectedInvocation.sessionId}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="mb-2 text-xs text-[var(--muted)]">参数</p>
                  <JsonBlock value={selectedInvocation.arguments} />
                </div>
                <div>
                  <p className="mb-2 text-xs text-[var(--muted)]">返回</p>
                  {selectedInvocation.status === "failed" ? (
                    <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200">
                      {selectedInvocation.errorText}
                    </div>
                  ) : (
                    <JsonBlock value={selectedInvocation.result ?? { status: "running" }} />
                  )}
                </div>
                {selectedInvocation.rawResult ? (
                  <div>
                    <p className="mb-2 text-xs text-[var(--muted)]">原始 MCP 返回</p>
                    <JsonBlock value={selectedInvocation.rawResult} />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">选择一条调用记录查看细节。</p>
            )}
          </Panel>
        </div>
      </main>
    </div>
  );
}
