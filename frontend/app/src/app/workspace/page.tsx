import { Navigate } from "react-router-dom";

import { env } from "@/env";

export default function WorkspacePage() {
  if (env.VITE_STATIC_WEBSITE_ONLY === "true") {
    // In static mode, fetch the first thread from the mock API on the client side
    // For now, redirect to new chat; the thread list will handle navigation
    return <Navigate to="/workspace/chats/new" replace />;
  }
  return <Navigate to="/workspace/chats/new" replace />;
}
