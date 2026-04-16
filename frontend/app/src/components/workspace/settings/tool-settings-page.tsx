import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import {
  useCreateMCPProfile,
  useDeleteMCPProfile,
  useMCPProfiles,
  useUpdateMCPProfile,
} from "@/core/mcp/hooks";
import type { MCPProfile } from "@/core/mcp/types";
import { EditIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "./settings-section";

export function ToolSettingsPage() {
  const { t } = useI18n();
  const { profiles, isLoading, error } = useMCPProfiles();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<MCPProfile | null>(null);

  function handleCreate() {
    setEditingProfile(null);
    setDialogOpen(true);
  }

  function handleEdit(profile: MCPProfile) {
    setEditingProfile(profile);
    setDialogOpen(true);
  }

  return (
    <SettingsSection
      title={t.settings.tools.title}
      description={t.settings.tools.description}
    >
      <div className="flex justify-end">
        <Button size="sm" onClick={handleCreate}>
          <PlusIcon className="size-4" />
          {t.settings.tools.createProfile}
        </Button>
      </div>
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div>{t.settings.tools.loadError(error.message)}</div>
      ) : profiles.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {t.settings.tools.emptyState}
        </div>
      ) : (
        <MCPProfileList profiles={profiles} onEdit={handleEdit} />
      )}
      <MCPProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        profile={editingProfile}
      />
    </SettingsSection>
  );
}

function MCPProfileList({
  profiles,
  onEdit,
}: {
  profiles: MCPProfile[];
  onEdit: (profile: MCPProfile) => void;
}) {
  const { t } = useI18n();
  const { mutateAsync: deleteProfile, isPending } = useDeleteMCPProfile();

  async function handleDelete(profile: MCPProfile) {
    try {
      await deleteProfile(profile.name);
      toast.success(t.settings.tools.profileDeleted);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.settings.tools.saveError,
      );
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {profiles.map((profile) => (
        <Item className="w-full" variant="outline" key={profile.source_path ?? profile.name}>
          <ItemContent>
            <ItemTitle>
              <div className="flex items-center gap-2">
                <div>{profile.name}</div>
              </div>
            </ItemTitle>
            <ItemDescription className="line-clamp-4">
              {profile.server_name}
              {profile.source_path ? ` · ${profile.source_path}` : ""}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            {profile.can_edit && (
              <>
                <Button size="icon" variant="ghost" onClick={() => onEdit(profile)}>
                  <EditIcon className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    void handleDelete(profile);
                  }}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </>
            )}
          </ItemActions>
        </Item>
      ))}
    </div>
  );
}

function MCPProfileDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: MCPProfile | null;
}) {
  const { t } = useI18n();
  const { mutateAsync: createProfile, isPending: isCreating } =
    useCreateMCPProfile();
  const { mutateAsync: updateProfile, isPending: isUpdating } =
    useUpdateMCPProfile();
  const [name, setName] = useState("");
  const [configJSON, setConfigJSON] = useState("{}");
  const isEditing = profile != null;
  const isPending = isCreating || isUpdating;

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(profile?.name ?? "");
    setConfigJSON(
      JSON.stringify(profile?.config_json ?? { mcpServers: {} }, null, 2),
    );
  }, [open, profile]);

  async function handleSave() {
    try {
      const parsed = JSON.parse(configJSON) as Record<string, unknown>;
      if (isEditing && profile) {
        await updateProfile({
          name: profile.name,
          request: { config_json: parsed },
        });
        toast.success(t.settings.tools.profileUpdated);
      } else {
        await createProfile({
          name: name.trim(),
          config_json: parsed,
        });
        toast.success(t.settings.tools.profileCreated);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.settings.tools.saveError,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t.settings.tools.editProfile
              : t.settings.tools.createProfile}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">{t.settings.tools.profileName}</div>
            <Input
              value={name}
              disabled={isEditing}
              onChange={(event) => setName(event.target.value)}
              placeholder="customer-docs"
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {t.settings.tools.profileConfig}
            </div>
            <Textarea
              value={configJSON}
              onChange={(event) => setConfigJSON(event.target.value)}
              className="min-h-72 font-mono text-xs"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void handleSave()} disabled={isPending}>
              {t.settings.tools.saveProfile}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
