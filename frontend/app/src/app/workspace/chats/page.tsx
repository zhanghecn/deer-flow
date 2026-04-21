import { ArrowLeftIcon, ArrowRightIcon, Trash2Icon } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { useClearThreads, useThreads } from "@/core/threads/query-hooks";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

const THREADS_PAGE_SIZE = 50;

export default function ChatsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim();
  const [page, setPage] = useState(1);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const { data, isLoading } = useThreads({
    limit: THREADS_PAGE_SIZE,
    offset: (page - 1) * THREADS_PAGE_SIZE,
    query: normalizedSearch,
  });
  const threads = data?.items ?? [];
  const totalThreads = data?.total ?? 0;
  const clearThreads = useClearThreads();

  useEffect(() => {
    document.title = `${t.pages.chats} - ${t.pages.appName}`;
  }, [t.pages.chats, t.pages.appName]);

  useEffect(() => {
    setPage(1);
  }, [normalizedSearch]);

  const hasThreads = threads.length > 0;
  const hasNewerPage = page > 1;
  const totalPages = Math.max(1, Math.ceil(totalThreads / THREADS_PAGE_SIZE));
  const hasOlderPage = page < totalPages;
  // Keep "no history" separate from "this later page has no rows" so the page
  // does not imply the whole account is empty after pagination or deletion.
  const showLoadingState = isLoading && !hasThreads;
  const showEmptyHistoryState =
    !showLoadingState && page === 1 && !hasThreads && normalizedSearch === "";
  const showNoResultsState =
    !showLoadingState && page === 1 && !hasThreads && normalizedSearch !== "";
  const showEmptyPageState = !showLoadingState && page > 1 && !hasThreads;

  async function handleClearAll() {
    try {
      await clearThreads.mutateAsync();
      setClearDialogOpen(false);
      setPage(1);
      toast.success(t.chats.clearAllSuccess);
      void navigate("/workspace/chats/new");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <WorkspaceContainer>
      <WorkspaceHeader></WorkspaceHeader>
      <WorkspaceBody>
        <div className="flex size-full flex-col">
          <header className="mx-auto flex w-full max-w-(--container-width-md) shrink-0 flex-col gap-4 px-4 pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                type="search"
                className="h-12 flex-1 text-xl"
                placeholder={t.chats.searchChats}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={!hasThreads || clearThreads.isPending}
                onClick={() => setClearDialogOpen(true)}
              >
                <Trash2Icon className="size-4" />
                {t.chats.clearAll}
              </Button>
            </div>
            <div className="text-muted-foreground flex items-center justify-between text-sm">
              <span>{t.chats.pageLabel(page, totalPages, totalThreads)}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNewerPage}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ArrowLeftIcon className="size-3.5" />
                  {t.chats.newerPage}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasOlderPage}
                  onClick={() => setPage((current) => current + 1)}
                >
                  {t.chats.olderPage}
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          </header>
          <main className="min-h-0 flex-1">
            <ScrollArea className="size-full py-4">
              <div className="mx-auto flex size-full max-w-(--container-width-md) flex-col">
                {showLoadingState ? (
                  <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 py-20 text-sm">
                    {t.common.loading}
                  </div>
                ) : showEmptyHistoryState ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-20 text-center">
                    <div className="text-base font-medium">
                      {t.chats.emptyTitle}
                    </div>
                    <p className="text-muted-foreground max-w-md text-sm">
                      {t.chats.emptyDescription}
                    </p>
                    <Button asChild>
                      <Link to="/workspace/chats/new">{t.chats.emptyAction}</Link>
                    </Button>
                  </div>
                ) : showEmptyPageState ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-20 text-center">
                    <div className="text-base font-medium">
                      {t.chats.emptyPageTitle}
                    </div>
                    <p className="text-muted-foreground max-w-md text-sm">
                      {t.chats.emptyPageDescription}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      <ArrowLeftIcon className="size-4" />
                      {t.chats.newerPage}
                    </Button>
                  </div>
                ) : showNoResultsState ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-20 text-center">
                    <div className="text-base font-medium">
                      {t.chats.noResultsTitle}
                    </div>
                    <p className="text-muted-foreground max-w-md text-sm">
                      {t.chats.noResultsDescription}
                    </p>
                  </div>
                ) : (
                  threads.map((thread) => (
                    <Link
                      key={thread.thread_id}
                      to={pathOfThread(thread)}
                      className="block transition-colors hover:bg-accent/40"
                    >
                      <div className="flex flex-col gap-1 border-b p-4">
                        <div className="text-sm font-medium">
                          {titleOfThread(thread)}
                        </div>
                        {thread.updated_at && (
                          <div className="text-muted-foreground text-xs">
                            {formatTimeAgo(thread.updated_at)}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </WorkspaceBody>
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t.chats.clearAll}</DialogTitle>
          </DialogHeader>
          <div className="text-muted-foreground text-sm leading-relaxed">
            {t.chats.clearAllConfirm}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearDialogOpen(false)}
              disabled={clearThreads.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleClearAll()}
              disabled={clearThreads.isPending}
            >
              {clearThreads.isPending ? t.common.loading : t.common.clearAll}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceContainer>
  );
}
