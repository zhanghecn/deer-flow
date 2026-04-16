import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { Toaster } from "@/components/ui/sonner";
import { ArtifactsProvider } from "@/components/workspace/artifacts/context";
import { useAuth } from "@/core/auth/hooks";
import { SubtasksProvider } from "@/core/tasks/context";

// Lazy-load heavy page components
const LoginPage = lazy(() => import("@/app/login/page"));
const RegisterPage = lazy(() => import("@/app/register/page"));
const AgentPublicDocsPage = lazy(
  () => import("@/app/docs/agents/[agent_name]/page"),
);
const AgentPublicReferencePage = lazy(
  () => import("@/app/docs/agents/[agent_name]/reference/page"),
);
const AgentPublicPlaygroundPage = lazy(
  () => import("@/app/docs/agents/[agent_name]/playground/page"),
);
const AgentPublicSupportPage = lazy(
  () => import("@/app/docs/agents/[agent_name]/support/page"),
);
const WorkspaceLayout = lazy(() => import("@/app/workspace/layout"));
const ChatsPage = lazy(() => import("@/app/workspace/chats/page"));
const ChatPage = lazy(() => import("@/app/workspace/chats/[thread_id]/page"));
const NewChatPage = lazy(() => import("@/app/workspace/chats/new/page"));
const KnowledgeLibraryPage = lazy(
  () => import("@/app/workspace/knowledge/page"),
);
const APIKeysPage = lazy(() => import("@/app/workspace/keys/page"));
const ThreadKnowledgePage = lazy(
  () => import("@/app/workspace/chats/[thread_id]/knowledge/page"),
);
const AgentsPage = lazy(() => import("@/app/workspace/agents/page"));
const NewAgentPage = lazy(() => import("@/app/workspace/agents/new/page"));
const AgentSettingsPage = lazy(
  () => import("@/app/workspace/agents/[agent_name]/settings/page"),
);
const AgentPlaygroundPage = lazy(
  () => import("@/app/workspace/agents/[agent_name]/playground/page"),
);
const AgentAuthoringPage = lazy(
  () => import("@/app/workspace/agents/[agent_name]/authoring/page"),
);
const SkillAuthoringPage = lazy(
  () => import("@/app/workspace/skills/[skill_name]/authoring/page"),
);
const AgentChatPage = lazy(
  () => import("@/app/workspace/agents/[agent_name]/chats/[thread_id]/page"),
);
const AgentNewChatPage = lazy(
  () => import("@/app/workspace/agents/[agent_name]/chats/new/page"),
);

// Public docs routes live outside the workspace shell, so they need their own
// query + toast boundary for export-doc loading, copy actions, and playground UX.
const publicDocsQueryClient = new QueryClient();

function ChatLayout() {
  return (
    <SubtasksProvider>
      <ArtifactsProvider>
        <PromptInputProvider>
          <Outlet />
        </PromptInputProvider>
      </ArtifactsProvider>
    </SubtasksProvider>
  );
}

function PublicDocsLayout() {
  return (
    <QueryClientProvider client={publicDocsQueryClient}>
      <Outlet />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          Loading...
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function RootEntryRoute() {
  const { authenticated } = useAuth();

  return <Navigate to={authenticated ? "/workspace" : "/login"} replace />;
}

export function AppRoutes() {
  return (
    <PageSuspense>
      <Routes>
        <Route path="/" element={<RootEntryRoute />} />
        <Route
          path="/login"
          element={
            <PageSuspense>
              <LoginPage />
            </PageSuspense>
          }
        />
        <Route
          path="/register"
          element={
            <PageSuspense>
              <RegisterPage />
            </PageSuspense>
          }
        />
        <Route
          element={
            <PageSuspense>
              <PublicDocsLayout />
            </PageSuspense>
          }
        >
          <Route
            path="/docs/agents/:agent_name"
            element={
              <PageSuspense>
                <AgentPublicDocsPage />
              </PageSuspense>
            }
          />
          <Route
            path="/docs/agents/:agent_name/reference"
            element={
              <PageSuspense>
                <AgentPublicReferencePage />
              </PageSuspense>
            }
          />
          <Route
            path="/docs/agents/:agent_name/support"
            element={
              <PageSuspense>
                <AgentPublicSupportPage />
              </PageSuspense>
            }
          />
          <Route
            path="/docs/agents/:agent_name/playground"
            element={
              <PageSuspense>
                <AgentPublicPlaygroundPage />
              </PageSuspense>
            }
          />
        </Route>
        <Route
          path="/workspace"
          element={
            <PageSuspense>
              <WorkspaceLayout />
            </PageSuspense>
          }
        >
          <Route index element={<Navigate to="chats/new" replace />} />
          <Route
            path="chats"
            element={
              <PageSuspense>
                <ChatsPage />
              </PageSuspense>
            }
          />
          <Route path="chats/new" element={<ChatLayout />}>
            <Route
              index
              element={
                <PageSuspense>
                  <NewChatPage />
                </PageSuspense>
              }
            />
          </Route>
          <Route path="chats/:thread_id" element={<ChatLayout />}>
            <Route
              index
              element={
                <PageSuspense>
                  <ChatPage />
                </PageSuspense>
              }
            />
            <Route
              path="knowledge"
              element={
                <PageSuspense>
                  <ThreadKnowledgePage />
                </PageSuspense>
              }
            />
          </Route>
          <Route
            path="agents"
            element={
              <PageSuspense>
                <AgentsPage />
              </PageSuspense>
            }
          />
          <Route
            path="agents/new"
            element={
              <PageSuspense>
                <NewAgentPage />
              </PageSuspense>
            }
          />
          <Route
            path="agents/:agent_name/settings"
            element={
              <PageSuspense>
                <AgentSettingsPage />
              </PageSuspense>
            }
          />
          <Route
            path="agents/:agent_name/playground"
            element={
              <PageSuspense>
                <AgentPlaygroundPage />
              </PageSuspense>
            }
          />
          <Route
            path="agents/:agent_name/authoring"
            element={
              <PageSuspense>
                <AgentAuthoringPage />
              </PageSuspense>
            }
          />
          <Route
            path="skills/:skill_name/authoring"
            element={
              <PageSuspense>
                <SkillAuthoringPage />
              </PageSuspense>
            }
          />
          <Route path="agents/:agent_name/chats/new" element={<ChatLayout />}>
            <Route
              index
              element={
                <PageSuspense>
                  <AgentNewChatPage />
                </PageSuspense>
              }
            />
          </Route>
          <Route
            path="agents/:agent_name/chats/:thread_id"
            element={<ChatLayout />}
          >
            <Route
              index
              element={
                <PageSuspense>
                  <AgentChatPage />
                </PageSuspense>
              }
            />
            <Route
              path="knowledge"
              element={
                <PageSuspense>
                  <ThreadKnowledgePage />
                </PageSuspense>
              }
            />
          </Route>
          <Route
            path="knowledge"
            element={
              <PageSuspense>
                <KnowledgeLibraryPage />
              </PageSuspense>
            }
          />
          <Route
            path="keys"
            element={
              <PageSuspense>
                <APIKeysPage />
              </PageSuspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PageSuspense>
  );
}
