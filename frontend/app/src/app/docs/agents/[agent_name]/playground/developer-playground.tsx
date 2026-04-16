import { PublicAPIPlaygroundPanel } from "@/components/workspace/public-api-playground-dialog";

import { DocsSurface } from "../shared";

interface DeveloperPublicAPIPlaygroundProps {
  agentName: string;
  defaultBaseURL?: string | null;
}

export function DeveloperPublicAPIPlayground({
  agentName,
  defaultBaseURL,
}: DeveloperPublicAPIPlaygroundProps) {
  return (
    <div id="connect" className="scroll-mt-28">
      <DocsSurface className="px-0 py-0">
        <PublicAPIPlaygroundPanel
          agentName={agentName}
          defaultBaseURL={defaultBaseURL}
          accessMode="public"
          headerMode="compact"
          hideDocumentationButton
        />
      </DocsSurface>
    </div>
  );
}
