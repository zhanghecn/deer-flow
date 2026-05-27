import { BookOpenTextIcon, BotIcon, MessagesSquare } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  sidebarMenuButtonClassName,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const pathname = useLocation().pathname;
  const isChatsPage =
    pathname === "/workspace/chats" ||
    pathname.startsWith("/workspace/chats/") ||
    pathname.includes("/chats/");
  const isAgentsPage =
    pathname === "/workspace/agents" || pathname === "/workspace/agents/new";
  const isKnowledgePage = pathname.includes("/knowledge");
  const knowledgeManagePath = "/workspace/knowledge";

  return (
    <SidebarGroup className="px-2 pt-1">
      <SidebarMenu className="gap-0.5">
        <SidebarMenuItem>
          <Link
            data-slot="sidebar-menu-button"
            data-sidebar="menu-button"
            data-size="default"
            data-active={isChatsPage}
            className={sidebarMenuButtonClassName({
              className: "text-muted-foreground gap-2",
            })}
            to="/workspace/chats"
          >
            <MessagesSquare size={16} />
            <span>{t.sidebar.chats}</span>
          </Link>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <Link
            data-slot="sidebar-menu-button"
            data-sidebar="menu-button"
            data-size="default"
            data-active={isAgentsPage}
            className={sidebarMenuButtonClassName({
              className: "text-muted-foreground gap-2",
            })}
            to="/workspace/agents"
          >
            <BotIcon size={16} />
            <span>{t.sidebar.agents}</span>
          </Link>
        </SidebarMenuItem>
        <SidebarMenuItem>
          {/* These shell links never need Slot composition; direct anchors keep
              React Router refs out of sidebar state transitions. */}
          <Link
            data-slot="sidebar-menu-button"
            data-sidebar="menu-button"
            data-size="default"
            data-active={isKnowledgePage}
            className={sidebarMenuButtonClassName({
              className: "text-muted-foreground gap-2",
            })}
            to={knowledgeManagePath}
          >
            <BookOpenTextIcon size={16} />
            <span>{t.knowledge.manageButton}</span>
          </Link>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
