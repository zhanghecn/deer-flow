"use client";

import dynamic from "next/dynamic";

const NewChatClient = dynamic(
  () => import("@/components/workspace/chats/new-chat-client"),
  { ssr: false },
);

export default function AgentNewChatPage() {
  return <NewChatClient />;
}
