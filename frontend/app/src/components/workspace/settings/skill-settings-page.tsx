import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAuthoringWorkbenchText } from "@/components/workspace/authoring/authoring-workbench.i18n";
import { buildWorkspaceSkillAuthoringPath } from "@/core/authoring";
import { useI18n } from "@/core/i18n/hooks";
import { getLocalizedSkillDescription } from "@/core/skills";
import { useEnableSkill, useSkills } from "@/core/skills/hooks";
import {
  DEFAULT_SKILL_SCOPE,
  filterSkillsByScope,
  formatSkillScopeLabel,
  getSkillScopes,
  type SkillScope,
} from "@/core/skills/scope";
import type { Skill } from "@/core/skills/type";
import { env } from "@/env";

import { SettingsSection } from "./settings-section";

export function SkillSettingsPage({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const { skills, isLoading, error } = useSkills();
  return (
    <SettingsSection
      title={t.settings.skills.title}
      description={t.settings.skills.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div>{t.settings.skills.loadError(error.message)}</div>
      ) : (
        <SkillSettingsList skills={skills} onClose={onClose} />
      )}
    </SettingsSection>
  );
}

function SkillSettingsList({
  skills,
  onClose,
}: {
  skills: Skill[];
  onClose?: () => void;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const categories = useMemo(() => getSkillScopes(skills), [skills]);
  const [filter, setFilter] = useState<SkillScope>(DEFAULT_SKILL_SCOPE);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const { mutate: enableSkill } = useEnableSkill();
  const workbenchText = getAuthoringWorkbenchText(locale);
  const filteredSkills = useMemo(
    () => filterSkillsByScope(skills, filter),
    [skills, filter],
  );

  const handleCreateSkill = () => {
    setCreateDialogOpen(true);
  };

  const handleOpenWorkbench = useCallback(
    (skillName: string, sourcePath?: string | null) => {
      onClose?.();
      void navigate(
        buildWorkspaceSkillAuthoringPath({
          skillName,
          sourcePath,
        }),
      );
    },
    [navigate, onClose],
  );

  const handleCreateWorkbench = useCallback(() => {
    const normalizedName = newSkillName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!normalizedName) {
      return;
    }
    setCreateDialogOpen(false);
    setNewSkillName("");
    onClose?.();
    void navigate(
      buildWorkspaceSkillAuthoringPath({
        skillName: normalizedName,
      }),
    );
  }, [navigate, newSkillName, onClose]);

  const categoryLabel = useCallback(
    (category: SkillScope) => formatSkillScopeLabel(category, locale),
    [locale],
  );

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(filter)) {
      setFilter(categories[0]!);
    }
  }, [categories, filter]);

  return (
    <>
      <div className="flex w-full flex-col gap-4">
        <header className="flex justify-between">
          <div className="flex gap-2">
            <Tabs
              defaultValue={categories[0] ?? DEFAULT_SKILL_SCOPE}
              value={filter}
              onValueChange={(value) => setFilter(value as SkillScope)}
            >
              <TabsList variant="line">
                {categories.map((category) => (
                  <TabsTrigger key={category} value={category}>
                    {categoryLabel(category)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div>
            <Button size="sm" onClick={handleCreateSkill}>
              <SparklesIcon className="size-4" />
              {t.settings.skills.createSkill}
            </Button>
          </div>
        </header>
        {filteredSkills.length === 0 && (
          <EmptySkill onCreateSkill={handleCreateSkill} />
        )}
        {filteredSkills.length > 0 &&
          filteredSkills.map((skill) => (
            <Item
              className="w-full"
              variant="outline"
              key={skill.source_path ?? skill.name}
            >
              <ItemContent>
                <ItemTitle>
                  <div className="flex items-center gap-2">{skill.name}</div>
                </ItemTitle>
                <ItemDescription className="line-clamp-4">
                  {getLocalizedSkillDescription(skill, locale)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    handleOpenWorkbench(skill.name, skill.source_path ?? undefined)
                  }
                >
                  <ExternalLinkIcon className="size-4" />
                  {workbenchText.openWorkbench}
                </Button>
                <Switch
                  checked={skill.enabled}
                  disabled={env.VITE_STATIC_WEBSITE_ONLY === "true"}
                  onCheckedChange={(checked) =>
                    enableSkill({ skillName: skill.name, enabled: checked })
                  }
                />
              </ItemActions>
            </Item>
          ))}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.settings.skills.createSkill}</DialogTitle>
            <DialogDescription>
              Choose a skill name and open the full workbench to edit `SKILL.md`,
              references, scripts, and assets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-muted-foreground text-sm">Skill name</div>
            <Input
              value={newSkillName}
              placeholder="contract-review"
              onChange={(event) => setNewSkillName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleCreateWorkbench} disabled={!newSkillName.trim()}>
              {workbenchText.openWorkbench}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptySkill({ onCreateSkill }: { onCreateSkill: () => void }) {
  const { t } = useI18n();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>{t.settings.skills.emptyTitle}</EmptyTitle>
        <EmptyDescription>
          {t.settings.skills.emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onCreateSkill}>{t.settings.skills.emptyButton}</Button>
      </EmptyContent>
    </Empty>
  );
}
