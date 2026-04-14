import { DownloadIcon, LoaderIcon, PackageIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { downloadArtifactFile } from "@/core/artifacts/actions";
import { useI18n } from "@/core/i18n/hooks";
import { installSkill } from "@/core/skills/api";
import {
  getFileExtensionDisplayName,
  getFileIcon,
  getFileName,
} from "@/core/utils/files";
import { cn } from "@/lib/utils";

import { useWorkbenchActions } from "../surfaces/use-workbench-actions";

export function ArtifactFileList({
  className,
  files,
  threadId,
}: {
  className?: string;
  files: string[];
  threadId: string;
}) {
  const { t } = useI18n();
  const { openArtifactWorkspace } = useWorkbenchActions(threadId);
  const [installingFile, setInstallingFile] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const handleClick = useCallback(
    (filepath: string) => {
      openArtifactWorkspace(filepath);
    },
    [openArtifactWorkspace],
  );

  const handleInstallSkill = useCallback(
    async (e: React.MouseEvent, filepath: string) => {
      e.stopPropagation();
      e.preventDefault();

      if (installingFile) return;

      setInstallingFile(filepath);
      try {
        const result = await installSkill({
          thread_id: threadId,
          path: filepath,
        });
        if (result.success) {
          toast.success(result.message);
        } else {
          toast.error(result.message || "Failed to install skill");
        }
      } catch (error) {
        console.error("Failed to install skill:", error);
        toast.error("Failed to install skill");
      } finally {
        setInstallingFile(null);
      }
    },
    [threadId, installingFile],
  );

  const handleDownload = useCallback(
    async (e: React.MouseEvent, filepath: string) => {
      e.stopPropagation();
      e.preventDefault();

      if (downloadingFile) return;

      setDownloadingFile(filepath);
      try {
        await downloadArtifactFile({
          filepath,
          threadId,
        });
      } catch (error) {
        console.error("Failed to download artifact:", error);
        toast.error("Failed to download artifact");
      } finally {
        setDownloadingFile(null);
      }
    },
    [downloadingFile, threadId],
  );

  return (
    <ul className={cn("flex w-full flex-col gap-4", className)}>
      {files.map((file) => (
        <Card
          key={file}
          className="relative cursor-pointer p-3"
          onClick={() => handleClick(file)}
        >
          <CardHeader className="pr-2 pl-1">
            <CardTitle className="relative pl-8">
              <div>{getFileName(file)}</div>
              <div className="absolute top-2 -left-0.5">
                {getFileIcon(file, "size-6")}
              </div>
            </CardTitle>
            <CardDescription className="pl-8 text-xs">
              {getFileExtensionDisplayName(file)} file
            </CardDescription>
            <CardAction>
              {file.endsWith(".skill") && (
                <Button
                  variant="ghost"
                  disabled={installingFile === file}
                  onClick={(e) => handleInstallSkill(e, file)}
                >
                  {installingFile === file ? (
                    <LoaderIcon className="size-4 animate-spin" />
                  ) : (
                    <PackageIcon className="size-4" />
                  )}
                  {t.common.install}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={downloadingFile === file}
                onClick={(e) => handleDownload(e, file)}
              >
                {downloadingFile === file ? (
                  <LoaderIcon className="size-4 animate-spin" />
                ) : (
                  <DownloadIcon className="size-4" />
                )}
                {t.common.download}
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      ))}
    </ul>
  );
}
