import { Suspense, lazy } from "react";

const NewChatClient = lazy(
  () => import("@/components/workspace/chats/new-chat-client"),
);

export default function NewChatPage() {
  return (
    <Suspense fallback={null}>
      <NewChatClient />
    </Suspense>
  );
}
