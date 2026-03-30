import { Suspense, lazy } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ArtifactsProvider } from "@/components/workspace/artifacts/context";
import { useAuth } from "@/core/auth/hooks";
import { SubtasksProvider } from "@/core/tasks/context";

// Lazy-load heavy page components
const LoginPage = lazy(() => import("@/app/login/page"));
const RegisterPage = lazy(() => import("@/app/register/page"));
const WorkspaceLayout = lazy(() => import("@/app/workspace/layout"));
const ChatsPage = lazy(() => import("@/app/workspace/chats/page"));
const ChatPage = lazy(() => import("@/app/workspace/chats/[thread_id]/page"));
const KnowledgeLibraryPage = lazy(() => import("@/app/workspace/knowledge/page"));
const ThreadKnowledgePage = lazy(
  () => import("@/app/workspace/chats/[thread_id]/knowledge/page"),
);
const AgentsPage = lazy(() => import("@/app/workspace/agents/page"));
const NewAgentPage = lazy(() => import("@/app/workspace/agents/new/page"));
const AgentSettingsPage = lazy(
  () => import("@/app/workspace/agents/[agent_name]/settings/page"),
);
const AgentChatPage = lazy(
  () =>
    import(
      "@/app/workspace/agents/[agent_name]/chats/[thread_id]/page"
    ),
);

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

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
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
                  <ChatPage />
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
          <Route path="agents/:agent_name/chats/new" element={<ChatLayout />}>
            <Route
              index
              element={
                <PageSuspense>
                  <AgentChatPage />
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PageSuspense>
  );
}
