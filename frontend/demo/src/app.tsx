import { ChatPage } from "./pages/chat";
import { WorkbenchPage } from "./pages/workbench";

function getRoute() {
  const path = window.location.pathname;
  if (path === "/chat") return "chat";
  return "workbench";
}

export function App() {
  const route = getRoute();

  if (route === "chat") {
    return <ChatPage />;
  }

  return <WorkbenchPage />;
}
