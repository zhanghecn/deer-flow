import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArchiveX,
  ChevronDown,
  ChevronRight,
  Database,
  HardDrive,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetch } from "@/hooks/use-fetch";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { formatAgo, formatBytes, formatDateTime } from "@/lib/format";
import type {
  RuntimeStorageCleanupAction,
  RuntimeStorageCleanupJob,
  RuntimeStorageCleanupPolicy,
  RuntimeStorageCleanupPolicyUpdate,
  RuntimeStorageCleanupPreview,
  RuntimeStorageDirectoryUsage,
  RuntimeStorageCheckpointTableUsage,
  RuntimeStorageSummary,
  RuntimeStorageThreadUsage,
  RuntimeStorageUserUsage,
} from "@/types";

const WHOLE_SESSION_DELETE: RuntimeStorageCleanupAction = "full_thread_delete";
const DEFAULT_CLEANUP_INACTIVE_DAYS = 180;
const WHOLE_SESSION_DELETE_LABEL = "Delete whole session";
const WHOLE_SESSION_DELETE_POLICY =
  "Deletes the whole inactive session after protection checks";

type CleanupPreviewRequest = {
  action: RuntimeStorageCleanupAction;
  thread_ids?: string[];
  user_id?: string;
  inactive_days?: number;
  limit?: number;
};

type PaginatedRuntimeStorageUsers = {
  items: RuntimeStorageUserUsage[];
  limit: number;
  offset: number;
  total: number;
};

type PaginatedRuntimeStorageThreads = {
  items: RuntimeStorageThreadUsage[];
  limit: number;
  offset: number;
  total: number;
};

type ExplorerSortKey =
  | "total_bytes"
  | "filesystem_bytes"
  | "checkpoint_bytes"
  | "runtime_cache_bytes"
  | "last_used_at"
  | "thread_count";

const USER_PAGE_SIZE = 20;
const THREAD_PAGE_SIZE = 50;

export function ThreadsPage() {
  const [query, setQuery] = useState("");
  const [ageFilter, setAgeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<ExplorerSortKey>("total_bytes");
  const [userPage, setUserPage] = useState(1);
  const [selectedThread, setSelectedThread] =
    useState<RuntimeStorageThreadUsage | null>(null);
  const [preview, setPreview] = useState<RuntimeStorageCleanupPreview | null>(
    null,
  );
  const [pendingRequest, setPendingRequest] = useState<{
    action: RuntimeStorageCleanupAction;
    thread_ids?: string[];
    user_id?: string;
    inactive_days?: number;
    limit?: number;
  } | null>(null);
  const [jobID, setJobID] = useState<string | null>(null);

  const summary = useFetch<RuntimeStorageSummary>(
    "/api/admin/runtime/storage/summary",
  );
  const usersQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(USER_PAGE_SIZE));
    params.set("offset", String((userPage - 1) * USER_PAGE_SIZE));
    params.set("sort_by", sortBy);
    if (query.trim()) params.set("query", query.trim());
    if (ageFilter !== "all") params.set("inactive_days", ageFilter);
    return params.toString();
  }, [ageFilter, query, sortBy, userPage]);
  const users = useFetch<PaginatedRuntimeStorageUsers>(
    `/api/admin/runtime/storage/users?${usersQuery}`,
  );
  const policies = useFetch<{ items: RuntimeStorageCleanupPolicy[] }>(
    "/api/admin/runtime/storage/cleanup/policies",
  );
  const job = useFetch<RuntimeStorageCleanupJob>(
    jobID ? `/api/admin/runtime/storage/cleanup/jobs/${jobID}` : null,
    { interval: jobID ? 2000 : undefined },
  );
  const refetchSummary = summary.refetch;
  const refetchUsers = users.refetch;

  useEffect(() => {
    const status = job.data?.status;
    if (status === "completed" || status === "partial" || status === "failed") {
      refetchSummary();
      refetchUsers();
    }
  }, [job.data?.status, refetchSummary, refetchUsers]);

  function refreshAll() {
    refetchSummary();
    refetchUsers();
  }

  async function previewCleanup(request: {
    action: RuntimeStorageCleanupAction;
    thread_ids?: string[];
    user_id?: string;
    inactive_days?: number;
    limit?: number;
  }) {
    try {
      const result = await api<RuntimeStorageCleanupPreview>(
        "/api/admin/runtime/storage/cleanup/preview",
        { method: "POST", body: request },
      );
      setPendingRequest(request);
      setPreview(result);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to preview cleanup"),
      );
    }
  }

  async function updatePolicy(
    action: RuntimeStorageCleanupAction,
    update: RuntimeStorageCleanupPolicyUpdate,
  ) {
    try {
      await api<RuntimeStorageCleanupPolicy>(
        `/api/admin/runtime/storage/cleanup/policies/${action}`,
        { method: "PUT", body: update },
      );
      policies.refetch();
      toast.success(t("Cleanup policy saved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to save cleanup policy"),
      );
    }
  }

  async function createCleanupJob() {
    if (!pendingRequest) return;
    try {
      const result = await api<RuntimeStorageCleanupJob>(
        "/api/admin/runtime/storage/cleanup/jobs",
        { method: "POST", body: pendingRequest },
      );
      setJobID(result.job_id);
      setPreview(null);
      toast.success(t("Cleanup job created"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to create cleanup job"),
      );
    }
  }

  const loading = summary.isLoading || users.isLoading;
  const error = summary.error || users.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {t("Runtime Storage")}
          </h2>
          <p className="text-muted-foreground">
            {t("Runtime files, checkpoints, users, and delete jobs")}
          </p>
        </div>
        <Button variant="outline" onClick={() => void refreshAll()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("Refresh")}
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-8 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      ) : null}

      <OverviewSection
        summary={summary.data}
        job={job.data ?? summary.data?.recent_jobs?.[0] ?? null}
        isLoading={loading}
      />

      <Tabs defaultValue="explorer" className="space-y-4">
        <TabsList>
          <TabsTrigger value="explorer">{t("Users / Threads")}</TabsTrigger>
          <TabsTrigger value="policies">{t("Scheduled Delete")}</TabsTrigger>
          <TabsTrigger value="jobs">{t("Delete Jobs")}</TabsTrigger>
        </TabsList>

        <TabsContent value="explorer" className="space-y-3">
          <StorageExplorer
            usersPage={users.data}
            isLoading={users.isLoading}
            query={query}
            ageFilter={ageFilter}
            sortBy={sortBy}
            page={userPage}
            onQueryChange={setQuery}
            onAgeFilterChange={setAgeFilter}
            onSortByChange={setSortBy}
            onPageChange={setUserPage}
            onSelectThread={setSelectedThread}
            onPreviewCleanup={previewCleanup}
          />
        </TabsContent>

        <TabsContent value="policies">
          <CleanupPolicyPanel
            policies={policies.data?.items ?? []}
            isLoading={policies.isLoading}
            summary={summary.data}
            onUpdatePolicy={updatePolicy}
            onPreviewCleanup={previewCleanup}
          />
        </TabsContent>

        <TabsContent value="jobs">
          <CleanupJobsPanel
            latestJob={job.data ?? summary.data?.recent_jobs?.[0] ?? null}
            jobs={summary.data?.recent_jobs ?? []}
          />
        </TabsContent>
      </Tabs>

      <ThreadDetailSheet
        thread={selectedThread}
        onOpenChange={(open) => {
          if (!open) setSelectedThread(null);
        }}
        onPreviewCleanup={previewCleanup}
      />

      <CleanupPreviewDialog
        preview={preview}
        onCancel={() => setPreview(null)}
        onConfirm={() => void createCleanupJob()}
      />
    </div>
  );
}

function OverviewSection({
  summary,
  job,
  isLoading,
}: {
  summary: RuntimeStorageSummary | null;
  job: RuntimeStorageCleanupJob | null;
  isLoading: boolean;
}) {
  const metrics = [
    {
      label: "Thread files",
      value: formatBytes(summary?.filesystem.thread_bytes),
      icon: HardDrive,
    },
    {
      label: "Checkpoints",
      value: formatBytes(summary?.checkpoint.bytes),
      icon: Database,
    },
    {
      label: "Runtime cache",
      value: formatBytes(summary?.filesystem.runtime_cache_bytes),
      icon: ArchiveX,
    },
    {
      label: "Orphan dirs",
      value: String(summary?.orphan_thread_count ?? 0),
      icon: Trash2,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.label}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              {t(metric.label)}
            </CardTitle>
            <metric.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="text-2xl font-semibold">{metric.value}</div>
            )}
          </CardContent>
        </Card>
      ))}
      <Card className="md:col-span-4">
        <CardContent className="flex flex-col gap-3 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="text-muted-foreground">
            {t("Last scan")}:{" "}
            <span className="text-foreground">
              {formatDateTime(summary?.scan.last_success_at)}
            </span>
          </div>
          {job ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">{job.status}</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {job.job_id}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">{t("No cleanup jobs yet")}</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StorageExplorer({
  usersPage,
  isLoading,
  query,
  ageFilter,
  sortBy,
  page,
  onQueryChange,
  onAgeFilterChange,
  onSortByChange,
  onPageChange,
  onSelectThread,
  onPreviewCleanup,
}: {
  usersPage: PaginatedRuntimeStorageUsers | null;
  isLoading: boolean;
  query: string;
  ageFilter: string;
  sortBy: ExplorerSortKey;
  page: number;
  onQueryChange: (value: string) => void;
  onAgeFilterChange: (value: string) => void;
  onSortByChange: (value: ExplorerSortKey) => void;
  onPageChange: (value: number) => void;
  onSelectThread: (thread: RuntimeStorageThreadUsage) => void;
  onPreviewCleanup: (request: CleanupPreviewRequest) => void;
}) {
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(() => new Set());
  const users = usersPage?.items ?? [];
  const total = usersPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const startRow = total === 0 ? 0 : (page - 1) * USER_PAGE_SIZE + 1;
  const endRow = Math.min(page * USER_PAGE_SIZE, total);

  function toggleUser(userID: string) {
    setExpandedUsers((current) => {
      const next = new Set(current);
      if (next.has(userID)) {
        next.delete(userID);
      } else {
        next.add(userID);
      }
      return next;
    });
  }

  if (isLoading) return <TableSkeleton rows={8} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex-1 space-y-2">
          <Label>{t("Search")}</Label>
          <Input
            value={query}
            onChange={(event) => {
              onPageChange(1);
              onQueryChange(event.target.value);
            }}
            placeholder={t("Search user, thread, agent, reason...")}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:w-[420px]">
          <div className="space-y-2">
            <Label>{t("Inactive")}</Label>
            <Select
              value={ageFilter}
              onValueChange={(value) => {
                onPageChange(1);
                onAgeFilterChange(value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Any age")}</SelectItem>
                <SelectItem value="7">{t("7+ days inactive")}</SelectItem>
                <SelectItem value="30">{t("30+ days inactive")}</SelectItem>
                <SelectItem value="180">{t("180+ days inactive")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("Sort by")}</Label>
            <Select
              value={sortBy}
              onValueChange={(value) => {
                onPageChange(1);
                onSortByChange(value as ExplorerSortKey);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total_bytes">{t("Total")}</SelectItem>
                <SelectItem value="filesystem_bytes">{t("Files")}</SelectItem>
                <SelectItem value="checkpoint_bytes">{t("Checkpoint")}</SelectItem>
                <SelectItem value="runtime_cache_bytes">{t("Runtime cache")}</SelectItem>
                <SelectItem value="last_used_at">{t("Last used")}</SelectItem>
                <SelectItem value="thread_count">{t("Threads")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("User / Thread")}</TableHead>
              <TableHead>{t("Total")}</TableHead>
              <TableHead>{t("Files")}</TableHead>
              <TableHead>{t("Checkpoint")}</TableHead>
              <TableHead>{t("Runtime cache")}</TableHead>
              <TableHead>{t("Last used")}</TableHead>
              <TableHead className="text-right">{t("Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const expanded = expandedUsers.has(user.user_id);
              return (
                <Fragment key={user.user_id}>
                  <TableRow key={user.user_id} className="bg-muted/30">
                    <TableCell>
                      <button
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => toggleUser(user.user_id)}
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {user.user_name || user.user_email || user.user_id}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {user.user_id} · {user.thread_count} {t("threads")}
                          </span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>{formatBytes(user.total_bytes)}</TableCell>
                    <TableCell>{formatBytes(user.filesystem_bytes)}</TableCell>
                    <TableCell>{formatBytes(user.checkpoint_bytes)}</TableCell>
                    <TableCell>{formatBytes(user.runtime_cache_bytes)}</TableCell>
                    <TableCell>{formatAgo(user.last_used_at)}</TableCell>
                    <TableCell className="text-right">
                      <CleanupMenu
                        label="Preview delete"
                        onPreview={() =>
                          onPreviewCleanup({
                            action: WHOLE_SESSION_DELETE,
                            user_id: user.user_id,
                            inactive_days: DEFAULT_CLEANUP_INACTIVE_DAYS,
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                  {expanded ? (
                    <UserThreadRows
                      key={`${user.user_id}:${query}:${ageFilter}:${sortBy}`}
                      userID={user.user_id}
                      query={query}
                      ageFilter={ageFilter}
                      sortBy={sortBy}
                      onSelectThread={onSelectThread}
                      onPreviewCleanup={onPreviewCleanup}
                    />
                  ) : null}
                </Fragment>
              );
            })}
            {!users.length ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {t("No runtime storage users found")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t("{start}-{end} of {total}", {
            start: startRow,
            end: endRow,
            total,
          })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isLoading}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            {t("Prev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isLoading}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          >
            {t("Next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserThreadRows({
  userID,
  query,
  ageFilter,
  sortBy,
  onSelectThread,
  onPreviewCleanup,
}: {
  userID: string;
  query: string;
  ageFilter: string;
  sortBy: ExplorerSortKey;
  onSelectThread: (thread: RuntimeStorageThreadUsage) => void;
  onPreviewCleanup: (request: CleanupPreviewRequest) => void;
}) {
  const [page, setPage] = useState(1);
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("user_id", userID);
    params.set("limit", String(THREAD_PAGE_SIZE));
    params.set("offset", String((page - 1) * THREAD_PAGE_SIZE));
    params.set("sort_by", sortBy);
    if (query.trim()) params.set("query", query.trim());
    if (ageFilter !== "all") params.set("inactive_days", ageFilter);
    return params.toString();
  }, [ageFilter, page, query, sortBy, userID]);
  const { data, isLoading } = useFetch<PaginatedRuntimeStorageThreads>(
    `/api/admin/runtime/storage/threads?${queryParams}`,
  );

  const threads = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / THREAD_PAGE_SIZE));
  const startRow = total === 0 ? 0 : (page - 1) * THREAD_PAGE_SIZE + 1;
  const endRow = Math.min(page * THREAD_PAGE_SIZE, total);

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={7} className="pl-10 text-sm text-muted-foreground">
          {t("Loading threads...")}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {threads.map((thread) => (
        <TableRow key={thread.thread_id}>
          <TableCell>
            <div className="ml-6 min-w-0">
              <button
                className="block max-w-[360px] truncate font-mono text-xs underline-offset-4 hover:underline"
                onClick={() => onSelectThread(thread)}
              >
                {thread.thread_id}
              </button>
              <div className="mt-1 flex max-w-[460px] flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{thread.agent_name || "-"}</span>
                <span>workspace {formatBytes(thread.directories.workspace.bytes)}</span>
                <span>uploads {formatBytes(thread.directories.uploads.bytes)}</span>
                <span>outputs {formatBytes(thread.directories.outputs.bytes)}</span>
                <span>agents {formatBytes(thread.directories.runtime_agents.bytes)}</span>
              </div>
              <ReasonBadges thread={thread} />
            </div>
          </TableCell>
          <TableCell>{formatBytes(thread.total_bytes)}</TableCell>
          <TableCell>{formatBytes(thread.filesystem_bytes)}</TableCell>
          <TableCell>{formatBytes(thread.checkpoint_bytes)}</TableCell>
          <TableCell>{formatBytes(thread.runtime_cache_bytes)}</TableCell>
          <TableCell>{formatAgo(thread.last_used_at)}</TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onSelectThread(thread)}>
                {t("Details")}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to={observabilityHref(thread)}>{t("View traces")}</Link>
              </Button>
              <CleanupMenu
                label="Preview delete"
                onPreview={() =>
                  onPreviewCleanup({
                    action: WHOLE_SESSION_DELETE,
                    thread_ids: [thread.thread_id],
                  })
                }
              />
            </div>
          </TableCell>
        </TableRow>
      ))}
      {!threads.length ? (
        <TableRow>
          <TableCell colSpan={7} className="pl-10 text-sm text-muted-foreground">
            {t("No matching threads")}
          </TableCell>
        </TableRow>
      ) : null}
      <TableRow>
        <TableCell colSpan={7}>
          <div className="ml-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {t("{start}-{end} of {total}", {
                start: startRow,
                end: endRow,
                total,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                {t("Prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                {t("Next")}
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    </>
  );
}

function CleanupMenu({
  label,
  onPreview,
}: {
  label: string;
  onPreview: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onPreview}
    >
      <Trash2 className="mr-2 h-4 w-4" />
      {t(label)}
    </Button>
  );
}

function CleanupPolicyPanel({
  policies,
  isLoading,
  summary,
  onUpdatePolicy,
  onPreviewCleanup,
}: {
  policies: RuntimeStorageCleanupPolicy[];
  isLoading: boolean;
  summary: RuntimeStorageSummary | null;
  onUpdatePolicy: (
    action: RuntimeStorageCleanupAction,
    update: RuntimeStorageCleanupPolicyUpdate,
  ) => void;
  onPreviewCleanup: (request: CleanupPreviewRequest) => void;
}) {
  const policy = policies.find((item) => item.action === WHOLE_SESSION_DELETE);

  if (isLoading) return <TableSkeleton rows={4} />;
  if (!policy) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("No scheduled delete policy configured")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Policy")}</TableHead>
            <TableHead>{t("Enabled")}</TableHead>
            <TableHead>{t("Mode")}</TableHead>
            <TableHead>{t("Inactive days")}</TableHead>
            <TableHead>{t("Schedule")}</TableHead>
            <TableHead>{t("Last run")}</TableHead>
            <TableHead>{t("Next run")}</TableHead>
            <TableHead className="text-right">{t("Actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <CleanupPolicyRow
            key={[
              policy.enabled,
              policy.dry_run,
              policy.inactive_days,
              policy.schedule,
              policy.run_at,
              policy.updated_at ?? "default",
            ].join(":")}
            policy={policy}
            candidates={summary?.candidate_counts?.[WHOLE_SESSION_DELETE] ?? 0}
            onUpdatePolicy={onUpdatePolicy}
            onPreviewCleanup={onPreviewCleanup}
          />
        </TableBody>
      </Table>
    </div>
  );
}

function CleanupPolicyRow({
  policy,
  candidates,
  onUpdatePolicy,
  onPreviewCleanup,
}: {
  policy: RuntimeStorageCleanupPolicy;
  candidates: number;
  onUpdatePolicy: (
    action: RuntimeStorageCleanupAction,
    update: RuntimeStorageCleanupPolicyUpdate,
  ) => void;
  onPreviewCleanup: (request: CleanupPreviewRequest) => void;
}) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [dryRun, setDryRun] = useState(policy.dry_run);
  const [inactiveDays, setInactiveDays] = useState(String(policy.inactive_days));
  const [schedule, setSchedule] = useState(policy.schedule);
  const [runAt, setRunAt] = useState(policy.run_at);

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-start gap-2">
          <Trash2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">{t(WHOLE_SESSION_DELETE_LABEL)}</div>
            <div className="text-xs text-muted-foreground">
              {candidates} {t("candidates")} · {t(WHOLE_SESSION_DELETE_POLICY)}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </TableCell>
      <TableCell>
        <Select
          value={dryRun ? "dry_run" : "execute"}
          onValueChange={(value) => setDryRun(value === "dry_run")}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dry_run">{t("Dry-run")}</SelectItem>
            <SelectItem value="execute">{t("Execute")}</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          value={inactiveDays}
          inputMode="numeric"
          className="w-20"
          onChange={(event) => setInactiveDays(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Select
            value={schedule}
            onValueChange={(value) =>
              setSchedule(value as RuntimeStorageCleanupPolicy["schedule"])
            }
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">{t("Hourly")}</SelectItem>
              <SelectItem value="daily">{t("Daily")}</SelectItem>
              <SelectItem value="weekly">{t("Weekly")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={runAt}
            className="w-20"
            onChange={(event) => setRunAt(event.target.value)}
          />
        </div>
      </TableCell>
      <TableCell>{formatDateTime(policy.last_run_at)}</TableCell>
      <TableCell>{formatDateTime(policy.next_run_at)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onPreviewCleanup({
                action: policy.action,
                inactive_days: Number(inactiveDays) || policy.inactive_days,
              })
            }
          >
            {t("Preview")}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              onUpdatePolicy(policy.action, {
                enabled,
                dry_run: dryRun,
                inactive_days: Number(inactiveDays) || policy.inactive_days,
                schedule,
                run_at: runAt,
              })
            }
          >
            {t("Save")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CleanupJobsPanel({
  latestJob,
  jobs,
}: {
  latestJob: RuntimeStorageCleanupJob | null;
  jobs: RuntimeStorageCleanupJob[];
}) {
  const visibleJobs = latestJob
    ? [latestJob, ...jobs.filter((job) => job.job_id !== latestJob.job_id)]
    : jobs;
  if (!visibleJobs.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("No cleanup jobs yet")}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Job")}</TableHead>
            <TableHead>{t("Action")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead>{t("Planned")}</TableHead>
            <TableHead>{t("Freed")}</TableHead>
            <TableHead>{t("Created")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleJobs.map((job) => (
            <TableRow key={job.job_id}>
              <TableCell className="font-mono text-xs">{job.job_id}</TableCell>
              <TableCell>{t(WHOLE_SESSION_DELETE_LABEL)}</TableCell>
              <TableCell>
                <Badge variant={job.status === "failed" ? "destructive" : "outline"}>
                  {job.status}
                </Badge>
              </TableCell>
              <TableCell>{formatBytes(job.preview.total_bytes_reclaimable)}</TableCell>
              <TableCell>{formatBytes(totalJobBytesFreed(job))}</TableCell>
              <TableCell>{formatDateTime(job.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ThreadDetailSheet({
  thread,
  onOpenChange,
  onPreviewCleanup,
}: {
  thread: RuntimeStorageThreadUsage | null;
  onOpenChange: (open: boolean) => void;
  onPreviewCleanup: (request: {
    action: RuntimeStorageCleanupAction;
    thread_ids?: string[];
  }) => void;
}) {
  const rows = thread
    ? [
        ["workspace", thread.directories.workspace],
        ["uploads", thread.directories.uploads],
        ["outputs", thread.directories.outputs],
        ["authoring", thread.directories.authoring],
        ["user-data/agents", thread.directories.runtime_agents],
        ["other user-data", thread.directories.other_user_data],
      ]
    : [];

  return (
    <Sheet open={!!thread} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {thread ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("Thread details")}</SheetTitle>
              <SheetDescription className="font-mono">
                {thread.thread_id}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Total" value={formatBytes(thread.total_bytes)} />
                <Metric
                  label="Files"
                  value={`${thread.file_count} / ${thread.dir_count}`}
                />
                <Metric label="Inactive" value={`${thread.inactive_days}d`} />
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t("Directory usage")}</h3>
                <div className="rounded-md border">
                  <Table>
                    <TableBody>
                      {(rows as Array<[string, RuntimeStorageDirectoryUsage]>).map(([label, usage]) => (
                        <TableRow key={label as string}>
                          <TableCell>{t(label as string)}</TableCell>
                          <TableCell>{formatBytes(usage.bytes)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {usage.file_count} {t("files")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t("Checkpoint usage")}</h3>
                <div className="rounded-md border">
                  <Table>
                    <TableBody>
                      {([
                        ["checkpoints", thread.checkpoint.checkpoints],
                        ["checkpoint_writes", thread.checkpoint.checkpoint_writes],
                        ["checkpoint_blobs", thread.checkpoint.checkpoint_blobs],
                      ] as Array<[string, RuntimeStorageCheckpointTableUsage]>).map(([label, usage]) => (
                        <TableRow key={label as string}>
                          <TableCell className="font-mono text-xs">
                            {label as string}
                          </TableCell>
                          <TableCell>{formatBytes(usage.bytes)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {usage.rows} {t("rows")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t("Protection")}</h3>
                <ReasonBadges thread={thread} />
              </section>

              <Button
                variant="destructive"
                onClick={() =>
                  onPreviewCleanup({
                    action: WHOLE_SESSION_DELETE,
                    thread_ids: [thread.thread_id],
                  })
                }
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t(WHOLE_SESSION_DELETE_LABEL)}
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CleanupPreviewDialog({
  preview,
  onCancel,
  onConfirm,
}: {
  preview: RuntimeStorageCleanupPreview | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasCandidates = (preview?.candidates.length ?? 0) > 0;
  const hasRefused = (preview?.refused.length ?? 0) > 0;

  return (
    <AlertDialog open={!!preview} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {hasCandidates ? t("Cleanup preview") : t("No eligible cleanup")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {preview
              ? t("{count} eligible threads, {bytes} estimated reclaim", {
                  count: preview.candidates.length,
                  bytes: formatBytes(preview.total_bytes_reclaimable),
                })
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {preview ? (
          <div className="max-h-[420px] space-y-4 overflow-y-auto text-sm">
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
              <Metric
                label="Action"
                value={t(WHOLE_SESSION_DELETE_LABEL)}
              />
              <Metric
                label="Estimated reclaim"
                value={formatBytes(preview.total_bytes_reclaimable)}
              />
              <Metric
                label="Checkpoint rows"
                value={String(preview.total_checkpoint_rows)}
              />
            </div>

            {hasCandidates ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t("Will clean")}</h3>
                <CleanupCandidateRows
                  candidates={preview.candidates}
                  mode="candidate"
                />
              </section>
            ) : (
              <div className="rounded-md border p-3 text-muted-foreground">
                {t("Nothing can be executed from this preview")}
              </div>
            )}

            {hasRefused ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {preview.refused.length} {t("refused by protection rules")}
                </h3>
                <CleanupCandidateRows
                  candidates={preview.refused}
                  mode="refused"
                />
              </section>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!preview || !hasCandidates}
          >
            {hasCandidates ? t("Create job") : t("No eligible items")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CleanupCandidateRows({
  candidates,
  mode,
}: {
  candidates: RuntimeStorageCleanupPreview["candidates"];
  mode: "candidate" | "refused";
}) {
  return (
    <div className="rounded-md border">
      {candidates.slice(0, 12).map((candidate) => (
        <div
          key={`${mode}-${candidate.thread_id}-${candidate.action}`}
          className="grid gap-2 border-b p-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px]"
        >
          <div className="min-w-0">
            <div className="truncate font-mono text-xs">
              {candidate.thread_id || "-"}
            </div>
            {mode === "refused" ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {candidateBlockers(candidate).map((reason) => (
                  <Badge key={reason} variant="outline">
                    {formatCleanupReason(reason)}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">
                {candidate.checkpoint_rows} {t("checkpoint rows")}
              </div>
            )}
          </div>
          <div className="text-right font-medium">
            {formatBytes(candidate.bytes_reclaimable)}
          </div>
        </div>
      ))}
      {candidates.length > 12 ? (
        <div className="p-3 text-sm text-muted-foreground">
          +{candidates.length - 12}
        </div>
      ) : null}
    </div>
  );
}

function ReasonBadges({ thread }: { thread: RuntimeStorageThreadUsage }) {
  const deleteCandidateReasons = thread.candidate_reasons.filter((reason) =>
    reason.startsWith("full_thread_delete"),
  );
  const reasons = [
    ...deleteCandidateReasons,
    ...thread.protection_reasons.map((reason) => `protected:${reason}`),
  ];
  if (!reasons.length) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
  return (
    <div className="flex max-w-[260px] flex-wrap gap-1">
      {reasons.slice(0, 3).map((reason) => (
        <Badge
          key={reason}
          variant={reason.startsWith("protected:") ? "destructive" : "secondary"}
          className="max-w-[180px] truncate"
        >
          {reason.startsWith("protected:")
            ? `${t("protected")}: ${formatCleanupReason(reason.slice(10))}`
            : formatCleanupReason(reason)}
        </Badge>
      ))}
      {reasons.length > 3 ? (
        <Badge variant="outline">+{reasons.length - 3}</Badge>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{t(label)}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}

function formatCleanupReason(reason: string) {
  switch (reason) {
    case "active_run":
      return t("active run");
    case "interrupt":
      return t("interrupt");
    case "authoring_draft":
      return t("authoring draft");
    case "thread_not_found":
      return t("thread not found");
    case "missing_thread_owner":
      return t("missing thread owner");
    case "nothing_to_reclaim":
      return t("nothing to reclaim");
    case "not_eligible":
      return t("not eligible");
    default:
      if (reason.startsWith("recent_activity_")) {
        return t("recent activity");
      }
      return reason.replace(/_/g, " ");
  }
}

function candidateBlockers(
  candidate: RuntimeStorageCleanupPreview["candidates"][number],
) {
  if (candidate.protection_reasons?.length) {
    return candidate.protection_reasons;
  }
  if (candidate.bytes_reclaimable <= 0) {
    return ["nothing_to_reclaim"];
  }
  return ["not_eligible"];
}

function totalJobBytesFreed(job: RuntimeStorageCleanupJob) {
  return job.items.reduce((sum, item) => sum + item.bytes_freed, 0);
}

function observabilityHref(thread: RuntimeStorageThreadUsage) {
  const params = new URLSearchParams();
  if (thread.user_id) params.set("user_id", thread.user_id);
  if (thread.thread_id) params.set("thread_id", thread.thread_id);
  if (thread.agent_name) params.set("agent_name", thread.agent_name);
  const query = params.toString();
  return query ? `/observability?${query}` : "/observability";
}
