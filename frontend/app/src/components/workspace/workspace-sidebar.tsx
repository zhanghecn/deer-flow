import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";

import { RecentChatList } from "./recent-chat-list";
import { ThreadKnowledgeSidebarSection } from "./knowledge/thread-knowledge-sidebar-section";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNavChatList } from "./workspace-nav-chat-list";
import { WorkspaceNavMenu } from "./workspace-nav-menu";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="sidebar" collapsible="icon" {...props}>
      <SidebarHeader className="py-0">
        <WorkspaceHeader />
      </SidebarHeader>
      <SidebarContent className="overflow-hidden">
        <WorkspaceNavChatList />
        <RecentChatList />
        <ThreadKnowledgeSidebarSection />
      </SidebarContent>
      <SidebarFooter>
        <WorkspaceNavMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
