import { FilesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { useWorkspaceSurface } from "@/core/workspace-surface/context";

import { useArtifacts } from "./context";

export const ArtifactTrigger = () => {
  const { t } = useI18n();
  const { artifacts, selectedArtifact } = useArtifacts();
  const workspaceSurface = useWorkspaceSurface();

  if (!artifacts || artifacts.length === 0) {
    return null;
  }
  return (
    <Tooltip content="Show artifacts of this conversation">
      <Button
        className="text-muted-foreground hover:text-foreground"
        variant="ghost"
        onClick={() => {
          workspaceSurface.openSurface(selectedArtifact ? "preview" : "files");
        }}
      >
        <FilesIcon />
        {t.common.artifacts}
      </Button>
    </Tooltip>
  );
};
