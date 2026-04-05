import { useParams, useSearchParams } from "react-router-dom";

import { BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { AuthoringWorkbench } from "@/components/workspace/authoring/authoring-workbench";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";

export default function AgentAuthoringPage() {
  const { agent_name } = useParams<{ agent_name: string }>();
  const [searchParams] = useSearchParams();
  const agentStatus = searchParams.get("agent_status") === "prod" ? "prod" : "dev";
  const agentName = agent_name ?? "lead_agent";

  return (
    <WorkspaceContainer>
      <WorkspaceHeader>
        <BreadcrumbItem>
          <BreadcrumbPage>{agentName}</BreadcrumbPage>
        </BreadcrumbItem>
      </WorkspaceHeader>
      <WorkspaceBody className="bg-background">
        <AuthoringWorkbench
          target={{
            kind: "agent",
            name: agentName,
            agentStatus,
          }}
        />
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
