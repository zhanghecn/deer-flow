import type { AdminModel } from "@/types";
import { t } from "@/i18n";

export type ModelThinkingMode =
  | "inherit"
  | "enabled"
  | "adaptive"
  | "custom";

export type ModelThinkingShape = "anthropic" | "extra_body";

export interface ModelProviderPreset {
  id: string;
  label: string;
  description: string;
  provider: string;
  runtimeClass: string;
  apiKeyPlaceholder: string;
  baseUrlPlaceholder: string;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsEffort: boolean;
  thinkingShape: ModelThinkingShape;
  aliases?: string[];
}

const ANTHROPIC_RUNTIME_CLASS = "langchain_anthropic:ChatAnthropic";
const KNOWN_DIRECT_THINKING_TYPES = new Set(["enabled", "adaptive"]);

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Best for GPT and most OpenAI-compatible APIs.",
    provider: "openai",
    runtimeClass: "langchain_openai:ChatOpenAI",
    apiKeyPlaceholder: "$OPENAI_API_KEY",
    baseUrlPlaceholder: "Leave empty for the official OpenAI endpoint",
    supportsThinking: true,
    supportsVision: true,
    supportsEffort: true,
    thinkingShape: "extra_body",
    aliases: ["openai-compatible", "openai_compatible"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude-style APIs with built-in thinking support.",
    provider: "anthropic",
    runtimeClass: "langchain_anthropic:ChatAnthropic",
    apiKeyPlaceholder: "$ANTHROPIC_API_KEY",
    baseUrlPlaceholder: "Leave empty for the official Anthropic endpoint",
    supportsThinking: true,
    supportsVision: true,
    supportsEffort: false,
    thinkingShape: "anthropic",
    aliases: ["anthropic-compatible", "anthropic_compatible"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini models through the Google GenAI integration.",
    provider: "google",
    runtimeClass: "langchain_google_genai:ChatGoogleGenerativeAI",
    apiKeyPlaceholder: "$GOOGLE_API_KEY",
    baseUrlPlaceholder: "Usually not needed for Gemini",
    supportsThinking: true,
    supportsVision: true,
    supportsEffort: false,
    thinkingShape: "extra_body",
    aliases: ["gemini", "google-genai", "google_genai"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek models via the dedicated LangChain provider.",
    provider: "deepseek",
    runtimeClass: "langchain_deepseek:ChatDeepSeek",
    apiKeyPlaceholder: "$DEEPSEEK_API_KEY",
    baseUrlPlaceholder: "Leave empty for the official DeepSeek endpoint",
    supportsThinking: true,
    supportsVision: false,
    supportsEffort: false,
    thinkingShape: "extra_body",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Fill provider and runtime class manually.",
    provider: "",
    runtimeClass: "",
    apiKeyPlaceholder: "Provider key or $ENV_VAR",
    baseUrlPlaceholder: "Optional custom endpoint",
    supportsThinking: false,
    supportsVision: false,
    supportsEffort: false,
    thinkingShape: "extra_body",
  },
];

export const DEFAULT_MODEL_PRESET_ID = "openai";

const KNOWN_CONFIG_KEYS = new Set([
  "use",
  "model",
  "api_key",
  "base_url",
  "max_input_tokens",
  // Keep the legacy key reserved so editing an older row drops the stale
  // runtime-only field instead of re-emitting it through advanced JSON.
  "reasoning_effort",
  "supports_thinking",
  "supports_vision",
  // Keep the retired profile key reserved so the admin editor rewrites older
  // rows onto the canonical contract instead of preserving two names.
  "supports_reasoning_effort",
  "supports_effort",
  "when_thinking_enabled",
]);

const MODEL_PROVIDER_PRESET_MAP = new Map(
  MODEL_PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
);

export const DEFAULT_MODEL_PROVIDER = (
  MODEL_PROVIDER_PRESET_MAP.get(DEFAULT_MODEL_PRESET_ID)
  ?? MODEL_PROVIDER_PRESET_MAP.get("custom")
  ?? MODEL_PROVIDER_PRESETS[0]
).provider;

export interface ModelMutationPayload {
  name: string;
  display_name: string | null;
  provider: string;
  enabled: boolean;
  config_json: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getModelConfig(model: Pick<AdminModel, "config_json"> | null): Record<string, unknown> {
  return isRecord(model?.config_json) ? model.config_json : {};
}

function getConfigString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function getConfigFlag(config: Record<string, unknown>, key: string): boolean {
  return config[key] === true;
}

function getConfigPositiveInteger(
  config: Record<string, unknown>,
  key: string,
): string {
  return stringifyPositiveInteger(config[key]);
}

function stringifyJson(value: unknown): string {
  if (value == null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

function parseJsonObject(source: string, label: string): Record<string, unknown> {
  const normalized = source.trim();
  if (!normalized) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(t("{label} must be valid JSON", { label }));
  }

  if (!isRecord(parsed)) {
    throw new Error(t("{label} must be a JSON object", { label }));
  }

  return parsed;
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeLookupKey(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[\s_]+/g, "-");
}

function stringifyPositiveInteger(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  return "";
}

function parsePositiveInteger(source: string, label: string): number {
  const normalized = source.trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!normalized || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(t("{label} must be a positive integer", { label }));
  }
  return parsed;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function slugifySegment(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildAutoModelName(provider: string, model: string): string {
  // Keep generated ids stable and reviewable so operators can predict the row
  // name without having to inspect hidden client-side UUIDs.
  return [provider, model].map(slugifySegment).filter(Boolean).join("-");
}

function getPresetAliasSet(preset: ModelProviderPreset): Set<string> {
  return new Set([
    normalizeLookupKey(preset.id),
    normalizeLookupKey(preset.provider),
    ...(preset.aliases ?? []).map(normalizeLookupKey),
  ]);
}

function inferModelPresetId(model: AdminModel | null): string {
  if (!model) {
    return DEFAULT_MODEL_PRESET_ID;
  }

  const config = getModelConfig(model);
  const providerKey = normalizeLookupKey(model.provider);
  const runtimeClass = normalizeText(getConfigString(config, "use"));

  const matchedPreset = MODEL_PROVIDER_PRESETS.find((preset) => {
    if (preset.id === "custom") {
      return false;
    }

    if (runtimeClass !== preset.runtimeClass) {
      return false;
    }

    return getPresetAliasSet(preset).has(providerKey);
  });

  return matchedPreset?.id ?? "custom";
}

function getPresetSeedValues(
  preset: ModelProviderPreset,
): Pick<
  ModelFormValues,
  | "provider"
  | "use"
  | "thinkingShape"
  | "supportsThinking"
  | "supportsVision"
  | "supportsEffort"
> {
  return {
    provider: preset.provider,
    use: preset.runtimeClass,
    thinkingShape: preset.thinkingShape,
    supportsThinking: preset.supportsThinking,
    supportsVision: preset.supportsVision,
    supportsEffort: preset.supportsEffort,
  };
}

export interface ModelFormValues {
  presetId: string;
  name: string;
  displayName: string;
  provider: string;
  enabled: boolean;
  use: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxInputTokens: string;
  thinkingShape: ModelThinkingShape;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsEffort: boolean;
  thinkingMode: ModelThinkingMode;
  thinkingBudgetTokens: string;
  customThinkingConfig: string;
  extraConfig: string;
}

export interface ResolvedModelFormValues {
  preset: ModelProviderPreset;
  name: string;
  displayName: string;
  provider: string;
  runtimeClass: string;
  model: string;
  generatedName: boolean;
  generatedDisplayName: boolean;
  inferredProvider: boolean;
  inferredRuntimeClass: boolean;
}

export function getModelProviderPreset(presetId: string): ModelProviderPreset {
  return (
    MODEL_PROVIDER_PRESET_MAP.get(presetId)
    ?? MODEL_PROVIDER_PRESET_MAP.get(DEFAULT_MODEL_PRESET_ID)
    ?? MODEL_PROVIDER_PRESETS[0]
  );
}

export function applyModelProviderPreset(
  values: ModelFormValues,
  presetId: string,
): ModelFormValues {
  const preset = getModelProviderPreset(presetId);
  return {
    ...values,
    presetId,
    ...getPresetSeedValues(preset),
  };
}

function resolveDefaultThinkingShape(
  preset: ModelProviderPreset,
  runtimeClass: string,
): ModelThinkingShape {
  if (normalizeText(runtimeClass) === ANTHROPIC_RUNTIME_CLASS) {
    return "anthropic";
  }
  return preset.thinkingShape;
}

function decodeThinkingConfig(
  preset: ModelProviderPreset,
  runtimeClass: string,
  thinkingConfig: unknown,
): Pick<
  ModelFormValues,
  | "thinkingMode"
  | "thinkingBudgetTokens"
  | "thinkingShape"
  | "customThinkingConfig"
> {
  const thinkingShape = resolveDefaultThinkingShape(preset, runtimeClass);
  const customThinkingConfig = stringifyJson(thinkingConfig);

  if (!isRecord(thinkingConfig) || Object.keys(thinkingConfig).length === 0) {
    return {
      thinkingMode: "inherit",
      thinkingBudgetTokens: "",
      thinkingShape,
      customThinkingConfig: "",
    };
  }

  // Preserve unknown provider-specific payloads verbatim so editing a model
  // does not silently discard working thinking settings we cannot render yet.
  const anthropicThinking = thinkingConfig.thinking;
  if (isRecord(anthropicThinking)) {
    const thinkingType = anthropicThinking.type;
    const budgetTokens = anthropicThinking.budget_tokens ?? anthropicThinking.budgetTokens;
    if (
      typeof thinkingType === "string"
      && KNOWN_DIRECT_THINKING_TYPES.has(thinkingType)
      && hasOnlyKeys(thinkingConfig, ["thinking"])
      && hasOnlyKeys(anthropicThinking, ["type", "budget_tokens", "budgetTokens"])
      && (budgetTokens === undefined || stringifyPositiveInteger(budgetTokens) !== "")
    ) {
      return {
        thinkingMode: thinkingType as ModelThinkingMode,
        thinkingBudgetTokens:
          thinkingType === "enabled" ? stringifyPositiveInteger(budgetTokens) : "",
        thinkingShape: "anthropic",
        customThinkingConfig,
      };
    }
  }

  const extraBody = thinkingConfig.extra_body;
  if (isRecord(extraBody) && isRecord(extraBody.thinking)) {
    const extraBodyThinking = extraBody.thinking;
    const thinkingType = extraBodyThinking.type;
    const budgetTokens = extraBodyThinking.budget_tokens ?? extraBodyThinking.budgetTokens;
    if (
      typeof thinkingType === "string"
      && KNOWN_DIRECT_THINKING_TYPES.has(thinkingType)
      && hasOnlyKeys(thinkingConfig, ["extra_body"])
      && hasOnlyKeys(extraBody, ["thinking"])
      && hasOnlyKeys(extraBodyThinking, ["type", "budget_tokens", "budgetTokens"])
      && (budgetTokens === undefined || stringifyPositiveInteger(budgetTokens) !== "")
    ) {
      return {
        thinkingMode: thinkingType as ModelThinkingMode,
        thinkingBudgetTokens:
          thinkingType === "enabled" ? stringifyPositiveInteger(budgetTokens) : "",
        thinkingShape: "extra_body",
        customThinkingConfig,
      };
    }
  }

  return {
    thinkingMode: "custom",
    thinkingBudgetTokens: "",
    thinkingShape,
    customThinkingConfig,
  };
}

export function buildThinkingConfigTemplate(shape: ModelThinkingShape): string {
  if (shape === "anthropic") {
    return `{
  "thinking": {
    "type": "enabled"
  }
}`;
  }

  return `{
  "extra_body": {
    "thinking": {
      "type": "enabled"
    }
  }
}`;
}

export function getModelFormValues(model: AdminModel | null): ModelFormValues {
  const presetId = inferModelPresetId(model);
  const preset = getModelProviderPreset(presetId);
  const config = getModelConfig(model);
  const extraConfig = Object.fromEntries(
    Object.entries(config).filter(([key]) => !KNOWN_CONFIG_KEYS.has(key)),
  );

  if (!model) {
    return {
      presetId,
      name: "",
      displayName: "",
      enabled: true,
      model: "",
      apiKey: "",
      baseUrl: "",
      maxInputTokens: "",
      thinkingMode: "inherit",
      thinkingBudgetTokens: "",
      customThinkingConfig: "",
      extraConfig: "",
      ...getPresetSeedValues(preset),
    };
  }

  const runtimeClass = getConfigString(config, "use") || preset.runtimeClass;
  const thinkingSettings = decodeThinkingConfig(
    preset,
    runtimeClass,
    config.when_thinking_enabled,
  );

  return {
    presetId,
    name: model.name,
    displayName: model.display_name ?? "",
    provider: model.provider || preset.provider,
    enabled: model.enabled,
    use: runtimeClass,
    model: getConfigString(config, "model"),
    apiKey: getConfigString(config, "api_key"),
    baseUrl: getConfigString(config, "base_url"),
    maxInputTokens: getConfigPositiveInteger(config, "max_input_tokens"),
    ...thinkingSettings,
    supportsThinking: getConfigFlag(config, "supports_thinking"),
    supportsVision: getConfigFlag(config, "supports_vision"),
    supportsEffort: getConfigFlag(config, "supports_effort"),
    extraConfig: stringifyJson(extraConfig),
  };
}

export function resolveModelFormValues(
  values: ModelFormValues,
): ResolvedModelFormValues {
  const preset = getModelProviderPreset(values.presetId);
  const model = normalizeText(values.model);
  const provider = normalizeText(values.provider) || preset.provider;
  const runtimeClass = normalizeText(values.use) || preset.runtimeClass;
  const explicitName = normalizeText(values.name);
  const explicitDisplayName = normalizeText(values.displayName);
  const generatedName = explicitName === "";
  const generatedDisplayName = explicitDisplayName === "";

  return {
    preset,
    name: explicitName || buildAutoModelName(provider, model),
    displayName: explicitDisplayName || model,
    provider,
    runtimeClass,
    model,
    generatedName,
    generatedDisplayName,
    inferredProvider: normalizeText(values.provider) === "",
    inferredRuntimeClass: normalizeText(values.use) === "",
  };
}

export function buildModelPayload(values: ModelFormValues): ModelMutationPayload {
  const resolved = resolveModelFormValues(values);
  const configJson: Record<string, unknown> = {
    ...parseJsonObject(values.extraConfig, "Extra config"),
    model: resolved.model,
    api_key: values.apiKey.trim(),
    supports_thinking: values.supportsThinking,
    supports_vision: values.supportsVision,
    supports_effort: values.supportsEffort,
  };

  if (resolved.runtimeClass) {
    configJson.use = resolved.runtimeClass;
  } else {
    delete configJson.use;
  }

  const baseUrl = values.baseUrl.trim();
  if (baseUrl) {
    configJson.base_url = baseUrl;
  } else {
    delete configJson.base_url;
  }

  const maxInputTokens = values.maxInputTokens.trim();
  if (maxInputTokens) {
    configJson.max_input_tokens = parsePositiveInteger(
      maxInputTokens,
      t("Max input tokens"),
    );
  } else {
    delete configJson.max_input_tokens;
  }

  if (values.supportsThinking) {
    let whenThinkingEnabled: Record<string, unknown> = {};

    if (values.thinkingMode === "custom") {
      whenThinkingEnabled = parseJsonObject(
        values.customThinkingConfig,
        "Thinking config",
      );
    } else if (values.thinkingMode !== "inherit") {
      const thinkingPayload: Record<string, unknown> = {
        type: values.thinkingMode,
      };
      if (values.thinkingMode === "enabled" && values.thinkingBudgetTokens.trim()) {
        thinkingPayload.budget_tokens = parsePositiveInteger(
          values.thinkingBudgetTokens,
          t("Thinking budget tokens"),
        );
      }

      if (values.thinkingShape === "anthropic") {
        whenThinkingEnabled = { thinking: thinkingPayload };
      } else {
        whenThinkingEnabled = {
          extra_body: {
            thinking: thinkingPayload,
          },
        };
      }
    }

    if (Object.keys(whenThinkingEnabled).length > 0) {
      configJson.when_thinking_enabled = whenThinkingEnabled;
    } else {
      delete configJson.when_thinking_enabled;
    }
  } else {
    delete configJson.when_thinking_enabled;
  }

  return {
    name: resolved.name,
    display_name: resolved.displayName || null,
    provider: resolved.provider,
    enabled: values.enabled,
    config_json: configJson,
  };
}

export function buildExistingModelPayload(
  model: AdminModel,
  overrides: Partial<ModelMutationPayload> = {},
): ModelMutationPayload {
  return {
    name: model.name,
    display_name: model.display_name ?? null,
    provider: model.provider,
    enabled: model.enabled,
    config_json: getModelConfig(model),
    ...overrides,
  };
}

export function filterModels(
  models: AdminModel[] | null,
  query: string,
): AdminModel[] | null {
  if (!models) {
    return null;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return models;
  }

  return models.filter((model) =>
    [
      model.name,
      model.display_name ?? "",
      model.provider,
      getRuntimeModelLabel(model),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

export function getRuntimeModelLabel(model: AdminModel): string {
  const runtimeModel = getModelConfig(model).model;
  if (typeof runtimeModel === "string" && runtimeModel.trim()) {
    return runtimeModel;
  }
  return model.name;
}

export function getModelCapabilityBadges(model: AdminModel): string[] {
  const config = getModelConfig(model);
  const badges: string[] = [];
  if (config.supports_thinking === true) {
    badges.push(t("Thinking"));
  }
  if (config.supports_vision === true) {
    badges.push(t("Vision"));
  }
  if (config.supports_effort === true) {
    badges.push(t("Effort"));
  }
  if (
    isRecord(config.when_thinking_enabled) &&
    Object.keys(config.when_thinking_enabled).length > 0
  ) {
    badges.push(t("Thinking Config"));
  }
  const maxInputTokens = config.max_input_tokens;
  if (
    typeof maxInputTokens === "number" &&
    Number.isInteger(maxInputTokens) &&
    maxInputTokens > 0
  ) {
    badges.push(
      t("{count}K ctx", {
        count: Math.round(maxInputTokens / 1000),
      }),
    );
  }
  return badges;
}

export function getModelApiKey(model: AdminModel): string {
  return getConfigString(getModelConfig(model), "api_key");
}
