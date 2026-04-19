import { ChatPlayground } from "./chat-playground";

interface DeveloperPublicAPIPlaygroundProps {
  agentName: string;
  defaultBaseURL?: string | null;
}

export function DeveloperPublicAPIPlayground({
  agentName,
  defaultBaseURL,
}: DeveloperPublicAPIPlaygroundProps) {
  return (
    <div id="connect" className="scroll-mt-4">
      <ChatPlayground
        agentName={agentName}
        defaultBaseURL={defaultBaseURL}
      />
    </div>
  );
}
