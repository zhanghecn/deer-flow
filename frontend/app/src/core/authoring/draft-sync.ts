import { createAgentAuthoringDraft } from "./api";
import { readStoredAuthoringThreadId } from "./thread-storage";

type AgentAuthoringStatus = "dev" | "prod";

export async function overwriteStoredAgentAuthoringDraft(
  agentName: string,
  agentStatus: AgentAuthoringStatus,
) {
  const threadId = readStoredAuthoringThreadId({
    kind: "agent",
    name: agentName,
    agentStatus,
  });
  if (!threadId) {
    return;
  }

  // The settings form has already saved the canonical archive. Reusing the
  // same sticky draft thread preserves the user's authoring workspace address
  // while restaging copied skills and config from the updated archive.
  await createAgentAuthoringDraft(agentName, {
    thread_id: threadId,
    agent_status: agentStatus,
    overwrite: true,
  });
}
