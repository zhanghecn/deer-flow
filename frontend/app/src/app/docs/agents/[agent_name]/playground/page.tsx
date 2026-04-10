import { Navigate, useParams } from "react-router-dom";

import { buildPublicAgentPlaygroundPath } from "@/core/agents";

export default function AgentPublicPlaygroundPage() {
  const { agent_name } = useParams<{ agent_name: string }>();

  // Keep legacy playground URLs alive, but route them into the new single-page
  // developer console instead of maintaining a separate public playground page.
  return (
    <Navigate
      replace
      to={buildPublicAgentPlaygroundPath(agent_name ?? "").trim() || "/"}
    />
  );
}
