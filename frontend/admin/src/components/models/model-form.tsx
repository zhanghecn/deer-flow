import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ChevronRight, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { AdminModel } from "@/types";
import { toast } from "sonner";

import {
  applyModelProviderPreset,
  buildModelPayload,
  buildThinkingConfigTemplate,
  getModelFormValues,
  MODEL_PROVIDER_PRESETS,
  resolveModelFormValues,
  type ModelFormValues,
  type ModelThinkingMode,
} from "./model-config";

interface ModelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editModel: AdminModel | null;
  onSuccess: () => void;
}

const OVERRIDE_FIELDS: Array<{
  key:
    | "name"
    | "displayName"
    | "provider"
    | "use";
  label: string;
  placeholder: string;
  description?: string;
  required?: boolean;
}> = [
  {
    key: "name",
    label: "Name",
    placeholder: "Auto-generated from provider and model",
    description: "Optional override for the internal row id.",
  },
  {
    key: "displayName",
    label: "Display Name",
    placeholder: "Defaults to the provider model id",
    description: "Optional label shown in selectors.",
  },
  {
    key: "provider",
    label: "Provider",
    placeholder: "Filled from the selected template",
    description: "Optional override when you want a custom provider label.",
  },
  {
    key: "use",
    label: "Runtime Class",
    placeholder: "Filled from the selected template",
    description: "Leave blank to use the template runtime class.",
  },
];

const CAPABILITY_FIELDS: Array<{
  key:
    | "enabled"
    | "supportsThinking"
    | "supportsVision"
    | "supportsEffort";
  label: string;
}> = [
  { key: "enabled", label: "Enabled" },
  { key: "supportsThinking", label: "Supports Thinking" },
  { key: "supportsVision", label: "Supports Vision" },
  { key: "supportsEffort", label: "Supports Effort" },
];

const THINKING_MODE_OPTIONS: Array<{
  value: Exclude<ModelThinkingMode, "custom">;
  label: string;
}> = [
  { value: "inherit", label: "Auto" },
  { value: "enabled", label: "Enabled" },
  { value: "adaptive", label: "Adaptive" },
];

const JSON_EDITOR_CLASS_NAME =
  "min-h-[220px] resize-y font-mono text-[12px] leading-6 sm:min-h-[260px]";

export function ModelForm({
  open,
  onOpenChange,
  editModel,
  onSuccess,
}: ModelFormProps) {
  const [values, setValues] = useState<ModelFormValues>(
    getModelFormValues(editModel),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formSession, setFormSession] = useState(0);
  const [activePanel, setActivePanel] = useState<"essentials" | "advanced">(
    "essentials",
  );
  const [showOverrides, setShowOverrides] = useState(false);
  const isEdit = editModel !== null;
  const fieldNamePrefix = isEdit
    ? `admin-model-edit-${editModel?.name ?? "unknown"}-${formSession}`
    : `admin-model-create-${formSession}`;
  const formKey = `${editModel?.name ?? "create"}-${formSession}`;
  const showsCustomThinkingEditor = values.thinkingMode === "custom";
  const showsThinkingBudget = values.supportsThinking
    && values.thinkingMode === "enabled";
  const thinkingPayloadLabel = values.thinkingShape === "anthropic"
    ? t("Anthropic-style `thinking` payload")
    : t("OpenAI-compatible `extra_body.thinking` payload");

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues(getModelFormValues(editModel));
    setActivePanel("essentials");
    setShowOverrides(editModel !== null);
    setFormSession((current) => current + 1);
  }, [editModel, open]);

  const resolvedValues = useMemo(
    () => resolveModelFormValues(values),
    [values],
  );

  function updateField<Key extends keyof ModelFormValues>(
    key: Key,
    value: ModelFormValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleThinkingModeChange(mode: ModelThinkingMode) {
    setValues((current) => ({
      ...current,
      thinkingMode: mode,
      customThinkingConfig:
        mode === "custom" && !current.customThinkingConfig.trim()
          ? buildThinkingConfigTemplate(current.thinkingShape)
          : current.customThinkingConfig,
    }));
  }

  function formatCustomThinkingConfig() {
    try {
      updateField(
        "customThinkingConfig",
        formatJsonObject(values.customThinkingConfig, t("Thinking config")),
      );
      toast.success(t("Thinking config formatted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Invalid JSON"));
    }
  }

  function resetCustomThinkingConfig() {
    setValues((current) => ({
      ...current,
      thinkingMode: "inherit",
      customThinkingConfig: "",
    }));
  }

  function formatExtraConfig() {
    try {
      updateField(
        "extraConfig",
        formatJsonObject(values.extraConfig, t("Extra Config")),
      );
      toast.success(t("Extra config formatted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Invalid JSON"));
    }
  }

  function clearExtraConfig() {
    updateField("extraConfig", "");
  }

  function renderTextField(
    field: (typeof OVERRIDE_FIELDS)[number],
  ) {
    return (
      <Field
        key={field.key}
        description={field.description}
        label={field.label}
      >
        <Input
          autoComplete="off"
          name={`${fieldNamePrefix}-${field.key}`}
          placeholder={t(field.placeholder)}
          required={field.required}
          value={values[field.key]}
          onChange={(event) => updateField(field.key, event.target.value)}
        />
      </Field>
    );
  }

  function handlePresetChange(presetId: string) {
    setValues((current) => applyModelProviderPreset(current, presetId));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let body;
    try {
      body = buildModelPayload(values);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Invalid form"));
      return;
    }

    setIsSubmitting(true);
    try {
      if (editModel) {
        await api(`/api/admin/models/${encodeURIComponent(editModel.name)}`, {
          method: "PUT",
          body,
        });
        toast.success(t("Model updated"));
      } else {
        await api("/api/admin/models", {
          method: "POST",
          body,
        });
        toast.success(t("Model created"));
      }
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to save model"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] w-[95vw] max-w-[980px] gap-0 overflow-hidden p-0 sm:w-[92vw]">
        <DialogHeader className="border-b bg-muted/30 px-5 py-4">
          <DialogTitle>{isEdit ? t("Edit Model") : t("Add Model")}</DialogTitle>
          <DialogDescription>
            {t(
              "Edit the runtime `models` table directly. Common fields are exposed as form controls, and JSON is reserved for provider-specific details.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          key={formKey}
          autoComplete="off"
          className="flex max-h-[calc(82vh-76px)] flex-col"
          onSubmit={handleSubmit}
        >
          <div className="hidden" aria-hidden="true">
            <input autoComplete="username" tabIndex={-1} />
            <input autoComplete="new-password" tabIndex={-1} type="password" />
          </div>
          <div className="space-y-5 overflow-y-auto px-5 py-4">
            <div className="inline-flex w-fit rounded-lg bg-muted p-1">
              <PanelToggle
                active={activePanel === "essentials"}
                onClick={() => setActivePanel("essentials")}
              >
                {t("Essentials")}
              </PanelToggle>
              <PanelToggle
                active={activePanel === "advanced"}
                onClick={() => setActivePanel("advanced")}
              >
                {t("Advanced JSON")}
              </PanelToggle>
            </div>

            {activePanel === "essentials" ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.95fr)]">
                <div className="space-y-6">
                  <Section
                    title={t("Quick Setup")}
                    description={t("Pick a provider template first. It fills the runtime class and common capability defaults for you.")}
                  >
                    <Field
                      label={t("Provider Template")}
                      description={t("You can still override the internal fields later if you need something custom.")}
                    >
                      <Select
                        value={values.presetId}
                        onValueChange={handlePresetChange}
                      >
                        <SelectTrigger
                          aria-label={t("Provider Template")}
                          name={`${fieldNamePrefix}-preset`}
                        >
                          <SelectValue placeholder={t("Select a provider template")} />
                        </SelectTrigger>
                        <SelectContent>
                          {MODEL_PROVIDER_PRESETS.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {t(preset.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <div className="space-y-3 rounded-xl border bg-background/70 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <Sparkles className="h-3.5 w-3.5" />
                          {t(resolvedValues.preset.label)}
                        </Badge>
                        {resolvedValues.provider ? (
                          <Badge variant="outline">
                            {t("Provider")}: {resolvedValues.provider}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(resolvedValues.preset.description)}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {resolvedValues.runtimeClass
                          ? resolvedValues.runtimeClass
                          : t("Runtime class will stay manual until you fill it below.")}
                      </p>
                    </div>
                  </Section>

                  <Section
                    title={t("Model Access")}
                    description={t("Most users only need these fields to create a usable model entry.")}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field
                        label={t("Model")}
                        description={t("Provider-side model id, for example gpt-5 or claude-sonnet-4-5.")}
                      >
                        <Input
                          autoComplete="off"
                          name={`${fieldNamePrefix}-model`}
                          placeholder={t("Provider model id")}
                          required
                          value={values.model}
                          onChange={(event) =>
                            updateField("model", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label={t("API Key")}
                        description={t("Stored in models.config_json.api_key and used directly by the runtime.")}
                      >
                        <Input
                          autoComplete="new-password"
                          name={`${fieldNamePrefix}-api-key`}
                          placeholder={t(resolvedValues.preset.apiKeyPlaceholder)}
                          required
                          value={values.apiKey}
                          onChange={(event) =>
                            updateField("apiKey", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label={t("Base URL")}
                        description={t("Only needed when you route the provider through a custom endpoint or compatible gateway.")}
                      >
                        <Input
                          autoComplete="off"
                          name={`${fieldNamePrefix}-baseUrl`}
                          placeholder={t(resolvedValues.preset.baseUrlPlaceholder)}
                          value={values.baseUrl}
                          onChange={(event) =>
                            updateField("baseUrl", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label={t("Max Input Tokens")}
                        description={t("Required if you want fraction-based summarization and context-window percentages to work for this model.")}
                      >
                        <Input
                          autoComplete="off"
                          inputMode="numeric"
                          min={1}
                          name={`${fieldNamePrefix}-max-input-tokens`}
                          placeholder={t("For example 200000")}
                          type="number"
                          value={values.maxInputTokens}
                          onChange={(event) =>
                            updateField("maxInputTokens", event.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </Section>

                  <Section
                    title={t("Internal Overrides")}
                    description={t("Leave these blank to keep the template-generated defaults.")}
                  >
                    <Collapsible open={showOverrides} onOpenChange={setShowOverrides}>
                      <CollapsibleTrigger asChild>
                        <Button
                          className="justify-between"
                          type="button"
                          variant="outline"
                        >
                          <span>
                            {showOverrides
                              ? t("Hide internal fields")
                              : t("Customize internal fields")}
                          </span>
                          <ChevronRight
                            className={[
                              "h-4 w-4 transition-transform",
                              showOverrides ? "rotate-90" : "",
                            ].join(" ")}
                          />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          {OVERRIDE_FIELDS.map(renderTextField)}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </Section>
                </div>

                <div className="space-y-6">
                  <Section
                    title={t("Resolved Entry")}
                    description={t("These are the values that will be written if you save right now.")}
                  >
                    <div className="space-y-3 rounded-xl border bg-background/70 p-4">
                      <ResolvedField
                        generated={resolvedValues.generatedName}
                        label={t("Name")}
                        value={
                          resolvedValues.name
                            || t("Will be generated after you enter a model id")
                        }
                      />
                      <ResolvedField
                        generated={resolvedValues.generatedDisplayName}
                        label={t("Display Name")}
                        value={
                          resolvedValues.displayName
                            || t("Will default to the provider model id")
                        }
                      />
                      <ResolvedField
                        generated={resolvedValues.inferredProvider}
                        label={t("Provider")}
                        value={
                          resolvedValues.provider
                            || t("Provider template or manual value required")
                        }
                      />
                      <ResolvedField
                        generated={resolvedValues.inferredRuntimeClass}
                        label={t("Runtime Class")}
                        mono
                        value={
                          resolvedValues.runtimeClass
                            || t("Provider template or manual value required")
                        }
                      />
                    </div>
                  </Section>

                  <Section
                    title={t("Capabilities")}
                    description={t("Toggle the common runtime abilities without editing JSON by hand.")}
                  >
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                      {CAPABILITY_FIELDS.map((field) => (
                        <SwitchField
                          key={field.key}
                          checked={values[field.key]}
                          label={field.label}
                          onCheckedChange={(checked) =>
                            updateField(field.key, checked)
                          }
                        />
                      ))}
                    </div>
                  </Section>

                  <Section
                    title={t("Thinking Defaults")}
                    description={t("Common thinking behavior is configured here directly, so you do not need to write `when_thinking_enabled` JSON by hand.")}
                  >
                    <div className="space-y-4">
                      <Field
                        label={t("Thinking Mode")}
                        description={
                          values.supportsThinking
                            ? t("Pick how the runtime should populate `config_json.when_thinking_enabled` for this model.")
                            : t("Turn on Supports Thinking above to configure thinking defaults.")
                        }
                      >
                        <Select
                          disabled={!values.supportsThinking}
                          value={values.thinkingMode}
                          onValueChange={(value) =>
                            handleThinkingModeChange(value as ModelThinkingMode)
                          }
                        >
                          <SelectTrigger
                            aria-label={t("Thinking Mode")}
                            name={`${fieldNamePrefix}-thinking-mode`}
                          >
                            <SelectValue placeholder={t("Select thinking mode")} />
                          </SelectTrigger>
                          <SelectContent>
                            {THINKING_MODE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {t(option.label)}
                              </SelectItem>
                            ))}
                            <SelectItem value="custom">
                              {t("Custom JSON")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>

                      <div className="rounded-lg border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                        {t("Payload Shape")}: {thinkingPayloadLabel}
                      </div>

                      {showsThinkingBudget ? (
                        <Field
                          label={t("Thinking Budget Tokens")}
                          description={t("Optional token budget written into the thinking payload when mode is Enabled.")}
                        >
                          <Input
                            autoComplete="off"
                            disabled={!values.supportsThinking}
                            inputMode="numeric"
                            min={1}
                            name={`${fieldNamePrefix}-thinking-budget`}
                            placeholder={t("For example 16000")}
                            type="number"
                            value={values.thinkingBudgetTokens}
                            onChange={(event) =>
                              updateField("thinkingBudgetTokens", event.target.value)
                            }
                          />
                        </Field>
                      ) : null}
                      <p className="rounded-lg border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                        {values.supportsEffort
                          ? t("Effort is chosen per run in workspace and public API requests. It is no longer stored in the model profile.")
                          : t("Turn on Supports Effort above if this provider accepts per-run effort levels.")}
                      </p>

                      {showsCustomThinkingEditor ? (
                        <p className="rounded-lg border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                          {t("This model uses a custom thinking payload. It will be preserved unless you switch back to a standard mode.")}
                        </p>
                      ) : null}
                    </div>
                  </Section>
                </div>
              </div>
            ) : (
              <div className={showsCustomThinkingEditor ? "grid gap-5 sm:grid-cols-2" : ""}>
                {showsCustomThinkingEditor ? (
                  <Section
                    title={t("Custom Thinking JSON")}
                    description={t("Only needed when your provider expects a thinking payload that the direct controls cannot express.")}
                  >
                    <Field
                      label={t("JSON")}
                      description={t("Stored in `config_json.when_thinking_enabled` exactly as written.")}
                    >
                      <EditorToolbar>
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={formatCustomThinkingConfig}
                        >
                          {t("Format JSON")}
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={resetCustomThinkingConfig}
                        >
                          {t("Clear")}
                        </Button>
                      </EditorToolbar>
                      <Textarea
                        autoComplete="off"
                        className={JSON_EDITOR_CLASS_NAME}
                        name={`${fieldNamePrefix}-custom-thinking-config`}
                        placeholder={buildThinkingConfigTemplate(values.thinkingShape)}
                        spellCheck={false}
                        value={values.customThinkingConfig}
                        onChange={(event) =>
                          updateField("customThinkingConfig", event.target.value)
                        }
                      />
                    </Field>
                  </Section>
                ) : null}
                <Section
                  title={t("Extra Config")}
                  description={t("Use this for provider-specific keys such as timeout, output limits, or headers.")}
                >
                  <Field
                    label={t("JSON")}
                    description={t("Fields already exposed above should stay out of this object.")}
                  >
                    <EditorToolbar>
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={formatExtraConfig}
                      >
                        {t("Format JSON")}
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={clearExtraConfig}
                      >
                        {t("Clear")}
                      </Button>
                    </EditorToolbar>
                    <Textarea
                      autoComplete="off"
                      className={JSON_EDITOR_CLASS_NAME}
                      name={`${fieldNamePrefix}-extra-config`}
                      placeholder={'{\n  "temperature": 0,\n  "max_tokens": 8192\n}'}
                      spellCheck={false}
                      value={values.extraConfig}
                      onChange={(event) =>
                        updateField("extraConfig", event.target.value)
                      }
                    />
                  </Field>
                </Section>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t bg-background px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting
                ? t("Saving...")
                : isEdit
                  ? t("Save Changes")
                  : t("Create Model")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatJsonObject(source: string, label: string): string {
  const normalized = source.trim();
  if (!normalized) {
    return "";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(t("{label} must be valid JSON", { label }));
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(t("{label} must be a JSON object", { label }));
  }

  return JSON.stringify(parsed, null, 2);
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{t(label)}</Label>
      {children}
      {description ? (
        <p className="text-xs text-muted-foreground">{t(description)}</p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-muted/15 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t(title)}</h3>
        <p className="text-sm text-muted-foreground">{t(description)}</p>
      </div>
      {children}
    </section>
  );
}

function EditorToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function PanelToggle({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        "rounded-md px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ResolvedField({
  generated,
  label,
  mono = false,
  value,
}: {
  generated: boolean;
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <Badge variant={generated ? "secondary" : "outline"}>
          {generated ? t("Auto") : t("Manual")}
        </Badge>
      </div>
      <div
        className={[
          "rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground",
          mono ? "break-all font-mono" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function SwitchField({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <Label>{t(label)}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
