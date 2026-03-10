import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { ProtectedRoute } from "@/components/layout/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { UsersPage } from "@/pages/users";
import { AgentsPage } from "@/pages/agents";
import { ModelsPage } from "@/pages/models";
import { ObservabilityPage } from "@/pages/observability";
import { ThreadsPage } from "@/pages/threads";

const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: "dashboard",
            element: <DashboardPage />,
          },
          {
            path: "users",
            element: <UsersPage />,
          },
          {
            path: "agents",
            element: <AgentsPage />,
          },
          {
            path: "models",
            element: <ModelsPage />,
          },
          {
            path: "observability",
            element: <ObservabilityPage />,
          },
          {
            path: "threads",
            element: <ThreadsPage />,
          },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
