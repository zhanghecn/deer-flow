import { MoreHorizontalIcon, PlusSquareIcon, Share2Icon } from "lucide-react";
import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ResolvedAgentRuntimeSelection } from "@/core/agents";
import { DEMO_SHARE_BASE_URL } from "@/core/config/site";
import { useI18n } from "@/core/i18n/hooks";
import { buildCurrentPath, buildThreadPath } from "@/core/threads/utils";

export function ThreadActionsMenu({
  runtimeSelection,
}: {
  runtimeSelection: ResolvedAgentRuntimeSelection;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentPath = buildCurrentPath(location.pathname, searchParams);

  const handleCopyLink = useCallback(async () => {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    const baseUrl = isLocalhost ? DEMO_SHARE_BASE_URL : window.location.origin;

    try {
      await navigator.clipboard.writeText(`${baseUrl}${currentPath}`);
      toast.success(t.clipboard.linkCopied);
    } catch {
      toast.error(t.clipboard.failedToCopyToClipboard);
    }
  }, [
    currentPath,
    t.clipboard.failedToCopyToClipboard,
    t.clipboard.linkCopied,
  ]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground rounded-full"
          aria-label={t.common.more}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-2xl">
        <DropdownMenuItem
          onSelect={() => {
            void navigate(buildThreadPath(runtimeSelection));
          }}
        >
          <PlusSquareIcon className="size-4" />
          <span>{t.agents.newChat}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void handleCopyLink();
          }}
        >
          <Share2Icon className="size-4" />
          <span>{t.common.share}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
