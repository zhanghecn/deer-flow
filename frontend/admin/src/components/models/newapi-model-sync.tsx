import { useMemo, useState } from "react";
import { Clock, DownloadCloud, RefreshCw, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";
import { api } from "@/lib/api";

type NewAPIImportProvider = "openai" | "anthropic" | "deepseek";

interface NewAPIModelCandidate {
  id: string;
  owner?: string;
  provider: NewAPIImportProvider;
  endpoint_types?: string[];
  created?: number;
}

interface NewAPIModelScanResponse {
  items: NewAPIModelCandidate[];
  count: number;
}

interface NewAPIModelImportResponse {
  count: number;
  created: number;
  updated: number;
  providers: Partial<Record<NewAPIImportProvider, number>>;
}

interface NewAPIRecentConfig {
  base_url: string;
  last_synced_at: string;
}

interface NewAPIModelSyncProps {
  onSuccess: () => void;
}

const NEW_API_RECENT_STORAGE_KEY = "openagents.admin.newapi.recent";
const NEW_API_RECENT_LIMIT = 50;
const NEW_API_RECENT_PAGE_SIZE = 5;

function getRecentPageCount(totalItems: number) {
  return Math.max(1, Math.ceil(totalItems / NEW_API_RECENT_PAGE_SIZE));
}

function normalizeRecentBaseURL(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function loadRecentConfigs(): NewAPIRecentConfig[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(NEW_API_RECENT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is NewAPIRecentConfig => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof item.base_url === "string" &&
          typeof item.last_synced_at === "string"
        );
      })
      .map((item) => ({
        base_url: normalizeRecentBaseURL(item.base_url),
        last_synced_at: item.last_synced_at,
      }))
      .filter((item) => item.base_url !== "")
      .slice(0, NEW_API_RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecentConfigs(configs: NewAPIRecentConfig[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    NEW_API_RECENT_STORAGE_KEY,
    JSON.stringify(configs),
  );
}

function formatNewAPIProvider(provider: NewAPIImportProvider) {
  if (provider === "anthropic") {
    return "Anthropic";
  }
  if (provider === "deepseek") {
    return "DeepSeek";
  }
  return "OpenAI";
}

export function NewAPIModelSync({ onSuccess }: NewAPIModelSyncProps) {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [recentConfigs, setRecentConfigs] =
    useState<NewAPIRecentConfig[]>(loadRecentConfigs);
  const [selectedRecentUrls, setSelectedRecentUrls] = useState<string[]>([]);
  const [recentPage, setRecentPage] = useState(1);
  const [scanResult, setScanResult] =
    useState<NewAPIModelScanResponse | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const normalizedBaseUrl = normalizeRecentBaseURL(baseUrl);
  const hasReusableRecentKey = recentConfigs.some(
    (item) => item.base_url === normalizedBaseUrl,
  );
  const canSubmit =
    normalizedBaseUrl !== "" && (apiKey.trim() !== "" || hasReusableRecentKey);
  const previewItems = useMemo(
    () => scanResult?.items.slice(0, 8) ?? [],
    [scanResult],
  );
  const recentPageCount = getRecentPageCount(recentConfigs.length);
  const currentRecentPage = Math.min(recentPage, recentPageCount);
  const pagedRecentConfigs = useMemo(() => {
    const startIndex = (currentRecentPage - 1) * NEW_API_RECENT_PAGE_SIZE;
    return recentConfigs.slice(
      startIndex,
      startIndex + NEW_API_RECENT_PAGE_SIZE,
    );
  }, [currentRecentPage, recentConfigs]);
  const selectedRecentSet = useMemo(
    () => new Set(selectedRecentUrls),
    [selectedRecentUrls],
  );
  const recentPageStart = recentConfigs.length
    ? (currentRecentPage - 1) * NEW_API_RECENT_PAGE_SIZE + 1
    : 0;
  const recentPageEnd = Math.min(
    currentRecentPage * NEW_API_RECENT_PAGE_SIZE,
    recentConfigs.length,
  );
  const allRecentOnPageSelected =
    pagedRecentConfigs.length > 0 &&
    pagedRecentConfigs.every((item) => selectedRecentSet.has(item.base_url));

  function updateRecentConfigs(nextConfigs: NewAPIRecentConfig[]) {
    const next = nextConfigs.slice(0, NEW_API_RECENT_LIMIT);
    const retainedBaseUrls = new Set(next.map((item) => item.base_url));

    saveRecentConfigs(next);
    setRecentConfigs(next);
    setSelectedRecentUrls((current) =>
      current.filter((baseUrl) => retainedBaseUrls.has(baseUrl)),
    );
    setRecentPage((current) => Math.min(current, getRecentPageCount(next.length)));
  }

  function rememberRecentConfig(rawBaseUrl: string) {
    const normalized = normalizeRecentBaseURL(rawBaseUrl);
    if (!normalized) {
      return;
    }
    updateRecentConfigs([
      {
        base_url: normalized,
        last_synced_at: new Date().toISOString(),
      },
      ...recentConfigs.filter((item) => item.base_url !== normalized),
    ]);
  }

  function removeRecentConfig(rawBaseUrl: string) {
    const normalized = normalizeRecentBaseURL(rawBaseUrl);
    updateRecentConfigs(
      recentConfigs.filter((item) => item.base_url !== normalized),
    );
  }

  function toggleRecentSelection(rawBaseUrl: string, selected: boolean) {
    const normalized = normalizeRecentBaseURL(rawBaseUrl);
    setSelectedRecentUrls((current) => {
      if (!selected) {
        return current.filter((item) => item !== normalized);
      }
      return Array.from(new Set([...current, normalized]));
    });
  }

  function toggleRecentPageSelection(selected: boolean) {
    const pageBaseUrls = pagedRecentConfigs.map((item) => item.base_url);
    setSelectedRecentUrls((current) => {
      if (!selected) {
        return current.filter((baseUrl) => !pageBaseUrls.includes(baseUrl));
      }
      return Array.from(new Set([...current, ...pageBaseUrls]));
    });
  }

  function removeSelectedRecentConfigs() {
    if (!selectedRecentUrls.length) {
      return;
    }
    const selected = new Set(selectedRecentUrls);
    const next = recentConfigs.filter((item) => !selected.has(item.base_url));
    const removedCount = recentConfigs.length - next.length;

    updateRecentConfigs(next);
    setSelectedRecentUrls([]);
    toast.success(t("Deleted {count} recent configs", { count: removedCount }));
  }

  function resetSecretState() {
    // Keep user-provided API keys scoped to the modal lifecycle; persisted
    // copies only exist after the admin explicitly imports model rows.
    setApiKey("");
    setScanResult(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetSecretState();
    }
  }

  async function handleScan() {
    if (!canSubmit) {
      toast.error(t("New API URL and key are required"));
      return;
    }

    setIsScanning(true);
    try {
      const response = await api<NewAPIModelScanResponse>(
        "/api/admin/models/newapi/scan",
        {
          method: "POST",
          body: {
            base_url: baseUrl,
            api_key: apiKey.trim() || undefined,
          },
        },
      );
      setScanResult(response);
      toast.success(t("Found {count} models", { count: response.count }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Failed to scan New API models"),
      );
    } finally {
      setIsScanning(false);
    }
  }

  async function handleImport() {
    if (!canSubmit) {
      toast.error(t("New API URL and key are required"));
      return;
    }

    await syncModels(baseUrl, apiKey, scanResult);
  }

  async function handleRecentSync(recentBaseUrl: string) {
    setBaseUrl(recentBaseUrl);
    setApiKey("");
    setScanResult(null);
    await syncModels(recentBaseUrl, "", null);
  }

  async function syncModels(
    targetBaseUrl: string,
    targetApiKey: string,
    targetScanResult: NewAPIModelScanResponse | null,
  ) {
    setIsImporting(true);
    try {
      const response = await api<NewAPIModelImportResponse>(
        "/api/admin/models/newapi/import",
        {
          method: "POST",
          body: {
            base_url: targetBaseUrl,
            api_key: targetApiKey.trim() || undefined,
            models: targetScanResult?.items ?? [],
            model_ids: targetScanResult?.items.map((item) => item.id) ?? [],
            enabled: true,
          },
        },
      );
      rememberRecentConfig(targetBaseUrl);
      toast.success(
        t("Synced {count} models: {created} created, {updated} updated", {
          count: response.count,
          created: response.created,
          updated: response.updated,
        }),
      );
      handleOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Failed to import New API models"),
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <Button className="shrink-0" variant="outline" onClick={() => setOpen(true)}>
        <DownloadCloud className="mr-2 h-4 w-4" />
        {t("Sync New API")}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[82vh] w-[95vw] max-w-[720px] overflow-hidden p-0 sm:w-[92vw]">
          <DialogHeader className="border-b bg-muted/30 px-5 py-4">
            <DialogTitle>{t("Sync New API Models")}</DialogTitle>
            <DialogDescription>
              {t("Scan an OpenAI-compatible New API endpoint and import every returned model into the runtime table.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-5 py-4">
            {recentConfigs.length ? (
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <Label>{t("Recent New API configs")}</Label>
                    <div className="text-xs text-muted-foreground">
                      {t("Keys are reused from imported model rows.")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        aria-label={t("Select all recent configs on this page")}
                        checked={allRecentOnPageSelected}
                        className="h-4 w-4 rounded border-border accent-primary"
                        type="checkbox"
                        onChange={(event) =>
                          toggleRecentPageSelection(event.target.checked)
                        }
                      />
                      {t("Select page")}
                    </label>
                    {selectedRecentUrls.length ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {t("{count} selected", {
                            count: selectedRecentUrls.length,
                          })}
                        </span>
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={() => setSelectedRecentUrls([])}
                        >
                          {t("Clear selection")}
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="destructive"
                          onClick={removeSelectedRecentConfigs}
                        >
                          {t("Delete selected")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-2">
                  {/* Recent configs are local, keyless bookmarks; client-side pagination
                      keeps longer histories manageable without creating another backend
                      source of truth for secrets. */}
                  {pagedRecentConfigs.map((item) => (
                    <div
                      key={item.base_url}
                      className="flex items-center justify-between gap-3 rounded-md border bg-muted/15 px-3 py-2"
                    >
                      <input
                        aria-label={t("Select recent config")}
                        checked={selectedRecentSet.has(item.base_url)}
                        className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                        type="checkbox"
                        onChange={(event) =>
                          toggleRecentSelection(item.base_url, event.target.checked)
                        }
                      />
                      <button
                        className="min-w-0 flex-1 text-left"
                        type="button"
                        onClick={() => {
                          setBaseUrl(item.base_url);
                          setApiKey("");
                          setScanResult(null);
                        }}
                      >
                        <span className="flex items-center gap-2 text-xs font-medium">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="truncate">{item.base_url}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          disabled={isImporting}
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void handleRecentSync(item.base_url);
                          }}
                        >
                          <RefreshCw
                            className={[
                              "mr-2 h-3.5 w-3.5",
                              isImporting ? "animate-spin" : "",
                            ].join(" ")}
                          />
                          {t("Sync now")}
                        </Button>
                        <Button
                          aria-label={t("Remove recent config")}
                          size="icon"
                          type="button"
                          variant="ghost"
                          onClick={() => removeRecentConfig(item.base_url)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {recentConfigs.length > NEW_API_RECENT_PAGE_SIZE ? (
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-muted-foreground">
                        {t("{start}-{end} of {total}", {
                          start: recentPageStart,
                          end: recentPageEnd,
                          total: recentConfigs.length,
                        })}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          disabled={currentRecentPage <= 1}
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setRecentPage((current) => Math.max(1, current - 1))
                          }
                        >
                          {t("Prev")}
                        </Button>
                        <Button
                          disabled={currentRecentPage >= recentPageCount}
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setRecentPage((current) =>
                              Math.min(recentPageCount, current + 1),
                            )
                          }
                        >
                          {t("Next")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>{t("New API URL")}</Label>
              <Input
                autoComplete="off"
                placeholder="http://localhost:13000/"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setScanResult(null);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("New API Key")}</Label>
              <Input
                autoComplete="new-password"
                placeholder="sk-..."
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setScanResult(null);
                }}
              />
              <div className="text-xs text-muted-foreground">
                {hasReusableRecentKey && apiKey.trim() === ""
                  ? t("This URL can reuse the key from existing imported rows.")
                  : t("Enter a key for the first sync of a URL.")}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/15 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {scanResult
                      ? t("{count} models ready", { count: scanResult.count })
                      : t("Models will be imported with max reasoning and vision enabled")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("Provider type is detected from endpoint metadata and names.")}
                  </div>
                </div>
                <Button
                  disabled={!canSubmit || isScanning}
                  type="button"
                  variant="outline"
                  onClick={handleScan}
                >
                  <RefreshCw
                    className={[
                      "mr-2 h-4 w-4",
                      isScanning ? "animate-spin" : "",
                    ].join(" ")}
                  />
                  {isScanning ? t("Scanning...") : t("Scan")}
                </Button>
              </div>

              {previewItems.length ? (
                <div className="mt-4 max-h-56 space-y-2 overflow-y-auto border-t pt-3">
                  {previewItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                    >
                      <span className="break-all font-mono text-xs">{item.id}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        {item.owner ? (
                          <Badge variant="outline">{item.owner}</Badge>
                        ) : null}
                        <Badge variant="secondary">
                          {formatNewAPIProvider(item.provider)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {scanResult && scanResult.count > previewItems.length ? (
                    <div className="text-xs text-muted-foreground">
                      {t("{count} more models will be included", {
                        count: scanResult.count - previewItems.length,
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t bg-background px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              disabled={!canSubmit || isImporting}
              type="button"
              onClick={handleImport}
            >
              {isImporting
                ? t("Syncing...")
                : scanResult
                  ? t("Sync scanned models")
                  : t("Sync all models")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
