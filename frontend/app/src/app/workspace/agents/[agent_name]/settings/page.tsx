import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { AgentSettingsPageView } from "@/components/workspace/agent-settings/agent-settings-page";
import { readAgentRuntimeSelection } from "@/core/agents";

export default function AgentSettingsPage() {
  const { agent_name } = useParams<{ agent_name: string }>();
  const [searchParams] = useSearchParams();
  const runtimeSelection = useMemo(
    () => readAgentRuntimeSelection(searchParams, agent_name),
    [agent_name, searchParams],
  );

  return (
    <AgentSettingsPageView
      agentName={runtimeSelection.agentName}
      agentStatus={runtimeSelection.agentStatus}
      executionBackend={runtimeSelection.executionBackend}
    />
  );
}
