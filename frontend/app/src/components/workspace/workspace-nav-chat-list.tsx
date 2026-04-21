import { BookOpenTextIcon, BotIcon, MessagesSquare } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
    <SidebarGroup className="pt-1 px-2">
      <SidebarMenu className="gap-0.5">
        <SidebarMenuItem>
          <SidebarMenuButton isActive={isChatsPage} asChild>
            <Link className="text-muted-foreground gap-2" to="/workspace/chats">
              <MessagesSquare size={16} />
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={isAgentsPage} asChild>
            <Link className="text-muted-foreground gap-2" to="/workspace/agents">
              <BotIcon size={16} />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={isKnowledgePage} asChild>
            <Link className="text-muted-foreground gap-2" to={knowledgeManagePath}>
              <BookOpenTextIcon size={16} />
              <span>{t.knowledge.manageButton}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
