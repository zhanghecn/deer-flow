import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { Toaster } from "sonner";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { useAuth } from "@/core/auth/hooks";
import { getLocalSettings, useLocalSettings } from "@/core/settings";
import { WorkspaceSurfaceProvider } from "@/core/workspace-surface/context";

const queryClient = new QueryClient();

export default function WorkspaceLayout() {
  const navigate = useNavigate();
  const { authenticated, ready } = useAuth();
  const [settings, setSettings] = useLocalSettings();
  const [open, setOpen] = useState(false); // SSR default: open (matches server render)

  useLayoutEffect(() => {
    // Runs synchronously before first paint on the client — no visual flash
    setOpen(!getLocalSettings().layout.sidebar_collapsed);
  }, []);

  useEffect(() => {
    setOpen(!settings.layout.sidebar_collapsed);
  }, [settings.layout.sidebar_collapsed]);

  useEffect(() => {
    if (!ready || authenticated) {
      return;
    }
    void navigate("/login", { replace: true });
  }, [authenticated, navigate, ready]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setOpen(open);
      setSettings("layout", { sidebar_collapsed: !open });
    },
    [setSettings],
  );
  return (
    <QueryClientProvider client={queryClient}>
      {/* The sidebar header and chat surfaces both read workspace-dock state. */}
      <WorkspaceSurfaceProvider>
        <SidebarProvider
          className="h-screen"
          open={open}
          onOpenChange={handleOpenChange}
        >
          <WorkspaceSidebar />
          <SidebarInset className="min-w-0">
            {ready && authenticated ? <Outlet /> : null}
          </SidebarInset>
        </SidebarProvider>
      </WorkspaceSurfaceProvider>
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
