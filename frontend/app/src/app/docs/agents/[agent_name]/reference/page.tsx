import { Navigate, useParams } from "react-router-dom";

import { buildPublicAgentReferencePath } from "@/core/agents";

export default function AgentPublicReferencePage() {
  const { agent_name } = useParams<{ agent_name: string }>();

  // Keep legacy reference URLs alive, but route them into the new single-page
  // developer console instead of maintaining a second public documentation UI.
  return (
    <Navigate
      replace
      to={buildPublicAgentReferencePath(agent_name ?? "").trim() || "/"}
    />
  );
}
