import { useParams, useSearchParams } from "react-router-dom";

import { BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { AuthoringWorkbench } from "@/components/workspace/authoring/authoring-workbench";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";

export default function SkillAuthoringPage() {
  const { skill_name } = useParams<{ skill_name: string }>();
  const [searchParams] = useSearchParams();
  const skillName = skill_name ?? "";
  const sourcePath = searchParams.get("source_path") ?? undefined;

  return (
    <WorkspaceContainer>
      <WorkspaceHeader>
        <BreadcrumbItem>
          <BreadcrumbPage>{skillName}</BreadcrumbPage>
        </BreadcrumbItem>
      </WorkspaceHeader>
      <WorkspaceBody className="bg-background">
        <AuthoringWorkbench
          target={{
            kind: "skill",
            name: skillName,
            sourcePath,
          }}
        />
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
