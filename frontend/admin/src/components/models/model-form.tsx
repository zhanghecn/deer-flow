import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { AdminModel } from "@/types";
import { toast } from "sonner";

import {
  buildModelPayload,
  getModelFormValues,
  type ModelFormValues,
} from "./model-config";

interface ModelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editModel: AdminModel | null;
  onSuccess: () => void;
}

const THINKING_CONFIG_TEMPLATE = `{
  "thinking": {
    "type": "enabled"
  }
}`;

const IDENTITY_FIELDS: Array<{
  key:
    | "name"
    | "displayName"
    | "provider"
    | "model"
    | "use";
  label: string;
  placeholder: string;
  description?: string;
  required?: boolean;
}> = [
  {
    key: "name",
    label: "Name",
    placeholder: "Internal model id",
    required: true,
  },
  {
    key: "displayName",
    label: "Display Name",
    placeholder: "Shown in admin and user-facing selectors",
  },
  {
    key: "provider",
    label: "Provider",
    placeholder: "Provider id, for example anthropic",
    required: true,
  },
  {
    key: "model",
    label: "Model",
    placeholder: "Provider model id",
    required: true,
  },
  {
    key: "use",
    label: "Runtime Class",
    placeholder: "Python path, for example langchain_openai:ChatOpenAI",
    required: true,
  },
];

const CONNECTION_FIELDS: Array<{
  key: "baseUrl";
  label: string;
  placeholder: string;
  description?: string;
  required?: boolean;
}> = [
  {
    key: "baseUrl",
    label: "Base URL",
    placeholder: "Optional custom endpoint",
  },
];

const CAPABILITY_FIELDS: Array<{
  key:
    | "enabled"
    | "supportsThinking"
    | "supportsVision"
    | "supportsReasoningEffort";
  label: string;
}> = [
  { key: "enabled", label: "Enabled" },
  { key: "supportsThinking", label: "Supports Thinking" },
  { key: "supportsVision", label: "Supports Vision" },
  { key: "supportsReasoningEffort", label: "Supports Reasoning Effort" },
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
  const isEdit = editModel !== null;
  const fieldNamePrefix = isEdit
    ? `admin-model-edit-${editModel?.name ?? "unknown"}-${formSession}`
    : `admin-model-create-${formSession}`;
  const formKey = `${editModel?.name ?? "create"}-${formSession}`;

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues(getModelFormValues(editModel));
    setActivePanel("essentials");
    setFormSession((current) => current + 1);
  }, [editModel, open]);

  function updateField<Key extends keyof ModelFormValues>(
    key: Key,
    value: ModelFormValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function applyThinkingPreset() {
    updateField("whenThinkingEnabled", THINKING_CONFIG_TEMPLATE);
  }

  function clearThinkingConfig() {
    updateField("whenThinkingEnabled", "");
  }

  function formatExtraConfig() {
    try {
      updateField("extraConfig", formatJsonObject(values.extraConfig));
      toast.success("Extra config formatted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid JSON");
    }
  }

  function clearExtraConfig() {
    updateField("extraConfig", "");
  }

  function renderTextField(
    field:
      | (typeof IDENTITY_FIELDS)[number]
      | (typeof CONNECTION_FIELDS)[number],
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
          placeholder={field.placeholder}
          required={field.required}
          value={values[field.key]}
          onChange={(event) => updateField(field.key, event.target.value)}
        />
      </Field>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let body;
    try {
      body = buildModelPayload(values);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid form");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editModel) {
        await api(`/api/admin/models/${encodeURIComponent(editModel.name)}`, {
          method: "PUT",
          body,
        });
        toast.success("Model updated");
      } else {
        await api("/api/admin/models", {
          method: "POST",
          body,
        });
        toast.success("Model created");
      }
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save model",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] w-[95vw] max-w-[980px] gap-0 overflow-hidden p-0 sm:w-[92vw]">
        <DialogHeader className="border-b bg-muted/30 px-5 py-4">
          <DialogTitle>{isEdit ? "Edit Model" : "Add Model"}</DialogTitle>
          <DialogDescription>
            Edit the runtime `models` table directly. Common fields are exposed
            as form controls, and JSON is reserved for provider-specific
            details.
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
                Essentials
              </PanelToggle>
              <PanelToggle
                active={activePanel === "advanced"}
                onClick={() => setActivePanel("advanced")}
              >
                Advanced JSON
              </PanelToggle>
            </div>

            {activePanel === "essentials" ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.95fr)]">
                <Section
                  title="Basics"
                  description="These fields identify the model and map it to the runtime class."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    {IDENTITY_FIELDS.map(renderTextField)}
                  </div>
                </Section>

                <div className="space-y-6">
                  <Section
                    title="Access"
                    description="Provider connection details stay separate from the identity fields."
                  >
                    <div className="space-y-4">
                      {CONNECTION_FIELDS.map(renderTextField)}
                      <Field
                        label="API Key"
                        description="Stored in models.config_json.api_key and used directly by the runtime."
                      >
                        <Input
                          autoComplete="new-password"
                          name={`${fieldNamePrefix}-api-key`}
                          placeholder="Provider key or $ENV_VAR"
                          required
                          value={values.apiKey}
                          onChange={(event) =>
                            updateField("apiKey", event.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </Section>

                  <Section
                    title="Capabilities"
                    description="Toggle the common runtime abilities without editing JSON by hand."
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
                </div>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <Section
                  title="Thinking Config"
                  description="Only applied when the model is invoked with thinking enabled."
                >
                  <Field label="JSON" description="Starts empty unless you choose a preset below.">
                    <EditorToolbar>
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={applyThinkingPreset}
                      >
                        Use Enabled Preset
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={clearThinkingConfig}
                      >
                        Clear
                      </Button>
                    </EditorToolbar>
                    <Textarea
                      autoComplete="off"
                      className={JSON_EDITOR_CLASS_NAME}
                      name={`${fieldNamePrefix}-thinking-config`}
                      placeholder={THINKING_CONFIG_TEMPLATE}
                      spellCheck={false}
                      value={values.whenThinkingEnabled}
                      onChange={(event) =>
                        updateField("whenThinkingEnabled", event.target.value)
                      }
                    />
                  </Field>
                </Section>

                <Section
                  title="Extra Config"
                  description="Use this for provider-specific keys such as timeout, output limits, or headers."
                >
                  <Field
                    label="JSON"
                    description="Fields already exposed above should stay out of this object."
                  >
                    <EditorToolbar>
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={formatExtraConfig}
                      >
                        Format JSON
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={clearExtraConfig}
                      >
                        Clear
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
              Cancel
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Create Model"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatJsonObject(source: string): string {
  const normalized = source.trim();
  if (!normalized) {
    return "";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("Extra config must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Extra config must be a JSON object");
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
      <Label>{label}</Label>
      {children}
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
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
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
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
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
