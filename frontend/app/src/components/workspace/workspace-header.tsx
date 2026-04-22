import { MessageSquarePlus } from "lucide-react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { buildWorkspaceAgentPath } from "@/core/agents";
import { APP_INITIALS, APP_NAME } from "@/core/config/site";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state, toggleSidebar } = useSidebar();
  const pathname = useLocation().pathname;
  const params = useParams<{ agent_name?: string; thread_id?: string }>();
  const [searchParams] = useSearchParams();
  const newChatPath = buildWorkspaceAgentPath({
    agentName:
      params.agent_name ?? searchParams.get("agent_name") ?? "lead_agent",
    agentStatus:
      (searchParams.get("agent_status") as "dev" | "prod" | null) ?? "dev",
    executionBackend:
      searchParams.get("execution_backend") === "remote" ? "remote" : undefined,
    remoteSessionId: searchParams.get("remote_session_id") ?? undefined,
  });

  return (
    <>
      {/* Clean header — no glass effects, just subtle separation */}
      <div
        className={cn(
          "flex h-12 flex-col justify-center",
          className,
        )}
      >
        {state === "collapsed" ? (
          // Keep the collapsed monogram itself clickable so the sidebar can be
          // reopened from the same obvious hit area after icon-collapse.
          <button
            type="button"
            aria-label="Toggle Sidebar"
            onClick={toggleSidebar}
            className="flex h-8 w-full items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
          >
            <div className="block pt-1 font-serif text-sm tracking-tight">
              {APP_INITIALS}
            </div>
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              {env.VITE_STATIC_WEBSITE_ONLY === "true" ? (
                <Link
                  to="/"
                  className="text-foreground font-serif text-sm tracking-tight transition-opacity hover:opacity-80"
                >
                  {APP_NAME}
                </Link>
              ) : (
                <div className="text-foreground cursor-default font-serif text-sm tracking-tight">
                  {APP_NAME}
                </div>
              )}
              <SidebarTrigger className="h-7 w-7" />
            </div>
          </div>
        )}
      </div>
      {/* "New Chat" promoted to a clear primary action within the sidebar */}
      <SidebarMenu className="px-0 py-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.endsWith("/chats/new")}
            asChild
            className={cn(
              "h-9 rounded-md transition-colors group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0",
              pathname.endsWith("/chats/new")
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-foreground hover:bg-accent",
            )}
          >
            <Link className="font-medium" to={newChatPath}>
              <MessageSquarePlus size={16} />
              <span>{t.sidebar.newChat}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
