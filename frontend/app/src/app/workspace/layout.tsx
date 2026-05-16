import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useLocation, useNavigate, Outlet } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthLoadingScreen } from "@/components/auth/auth-loading-screen";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { useAuth } from "@/core/auth/hooks";
import { getLocalSettings, useLocalSettings } from "@/core/settings";
import { WorkspaceSurfaceProvider } from "@/core/workspace-surface/context";

const queryClient = new QueryClient();

export default function WorkspaceLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authenticated, ready } = useAuth();
  const [settings, setSettings] = useLocalSettings();
  const [open, setOpen] = useState(false); // SSR default: open (matches server render)
  const compactSidebar = location.pathname.includes("/knowledge");

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
        {ready && authenticated ? (
          <SidebarProvider
            className="h-screen"
            open={open}
            onOpenChange={handleOpenChange}
            // Knowledge workspaces need more horizontal room for graph canvases
            // and source panes, while the regular chat shell keeps its width.
            style={
              compactSidebar
                ? ({ "--sidebar-width": "16rem" } as CSSProperties)
                : undefined
            }
          >
            <WorkspaceSidebar />
            <SidebarInset className="min-w-0">
              <Outlet />
            </SidebarInset>
          </SidebarProvider>
        ) : (
          <AuthLoadingScreen />
        )}
      </WorkspaceSurfaceProvider>
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
