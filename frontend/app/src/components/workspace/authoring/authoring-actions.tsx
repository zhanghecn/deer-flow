import { ArrowLeftIcon, SaveIcon, RocketIcon, PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { AuthoringWorkbenchText } from "./authoring-workbench.i18n";

export function AuthoringActions({
  text,
  kind,
  status,
  sourcePath,
  rootPath,
  threadId,
  isDirty,
  isSaving,
  isPublishing,
  canPublish,
  newFilePath,
  onNewFilePathChange,
  onCreateFile,
  onSave,
  onPublish,
  onBack,
}: {
  text: AuthoringWorkbenchText;
  kind: "agent" | "skill";
  status?: string;
  sourcePath?: string;
  rootPath: string;
  threadId: string;
  isDirty: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  canPublish: boolean;
  newFilePath: string;
  onNewFilePathChange: (value: string) => void;
  onCreateFile: () => void;
  onSave: () => void;
  onPublish: () => void;
  onBack: () => void;
}) {
  const saveHint =
    kind === "agent"
      ? text.saveHintAgent
      : sourcePath?.startsWith("store/")
        ? text.saveHintSkillLegacy
        : text.saveHintSkill;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="bg-background rounded-3xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{text.archiveSummary}</div>
            <div className="text-muted-foreground mt-1 text-xs">
              {kind === "agent"
                ? text.actionsDescriptionAgent
                : text.actionsDescriptionSkill}
            </div>
          </div>
          <Badge variant={isDirty ? "secondary" : "outline"}>
            {isDirty ? text.dirtyState : text.cleanState}
          </Badge>
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          {status ? (
            <div>
              <dt className="text-muted-foreground text-xs">
                {text.archiveStatus}
              </dt>
              <dd className="mt-1 font-medium">{status}</dd>
            </div>
          ) : null}
          {sourcePath ? (
            <div>
              <dt className="text-muted-foreground text-xs">
                {text.sourcePath}
              </dt>
              <dd className="mt-1 font-medium break-all">{sourcePath}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground text-xs">{text.rootPath}</dt>
            <dd className="mt-1 font-medium break-all">{rootPath}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {text.authoringThread}
            </dt>
            <dd className="mt-1 font-medium break-all">{threadId}</dd>
          </div>
        </dl>
      </div>

      <div className="bg-background rounded-3xl border p-4">
        <div className="text-sm font-semibold">{text.actionsTitle}</div>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {saveHint}
        </p>
        {kind === "agent" && canPublish ? (
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {text.publishHintAgent}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={onSave} disabled={isSaving || isPublishing}>
            <SaveIcon className="size-4" />
            {text.saveDraft}
          </Button>
          {kind === "agent" && canPublish ? (
            <Button
              variant="outline"
              onClick={onPublish}
              disabled={isSaving || isPublishing}
            >
              <RocketIcon className="size-4" />
              {text.publishAgent}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            {kind === "agent" ? text.settings : text.backToAgents}
          </Button>
        </div>
      </div>

      <div className="bg-background rounded-3xl border p-4">
        <div className="text-sm font-semibold">{text.createFile}</div>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {text.createFileDescription}
        </p>
        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs">
              {text.newFilePath}
            </div>
            <Input
              value={newFilePath}
              placeholder={text.newFilePathPlaceholder}
              onChange={(event) => onNewFilePathChange(event.target.value)}
            />
          </div>
          <Button variant="outline" onClick={onCreateFile}>
            <PlusIcon className="size-4" />
            {text.createFileSubmit}
          </Button>
        </div>
      </div>
    </div>
  );
}
