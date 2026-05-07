import { ChatPage } from "./pages/chat";
import { WorkbenchPage } from "./pages/workbench";

function getRoute() {
  const path = window.location.pathname;
  const normalizedPath = path.replace(/\/+$/, "") || "/";

  // Keep the built index/default route on chat; the MCP workbench is an
  // explicit operator surface at /mcp so opening index.html does not expose it.
  if (normalizedPath === "/mcp") return "workbench";
  return "chat";
}

export function App() {
  const route = getRoute();

  if (route === "chat") {
    return <ChatPage />;
  }

  return <WorkbenchPage />;
}
