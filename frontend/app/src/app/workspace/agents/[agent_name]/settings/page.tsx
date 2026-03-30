import { useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { AgentSettingsDialog } from "@/components/workspace/agent-settings-dialog";
import { AgentGallery } from "@/components/workspace/agents/agent-gallery";
import { readAgentRuntimeSelection } from "@/core/agents";

export default function AgentSettingsPage() {
  const navigate = useNavigate();
  const { agent_name } = useParams<{ agent_name: string }>();
  const [searchParams] = useSearchParams();
  const runtimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams, agent_name),
    [agent_name, searchParams],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        return;
      }
      void navigate("/workspace/agents");
    },
    [navigate],
  );

  return (
    <>
      <AgentGallery />
      <AgentSettingsDialog
        open
        onOpenChange={handleOpenChange}
        agentName={runtimeSelection.agentName}
        agentStatus={runtimeSelection.agentStatus}
        executionBackend={runtimeSelection.executionBackend}
        remoteSessionId={runtimeSelection.remoteSessionId || undefined}
      />
    </>
  );
}
