import type { AdminModel } from "@/types";
import { t } from "@/i18n";

export type ModelReasoningLevel = "auto" | "low" | "medium" | "high" | "max";
export type ModelReasoningContract =
  | "openai_responses"
  | "anthropic_thinking"
  | "gemini_budget"
  | "gemini_level"
  | "deepseek_reasoner";

const MODEL_REASONING_LEVELS: ModelReasoningLevel[] = [
  "auto",
  "low",
  "medium",
  "high",
  "max",
];
const MODEL_REASONING_LEVEL_SET = new Set<ModelReasoningLevel>(
  MODEL_REASONING_LEVELS,
);
const MODEL_REASONING_CONTRACT_SET = new Set<ModelReasoningContract>([
  "openai_responses",
  "anthropic_thinking",
  "gemini_budget",
  "gemini_level",
  "deepseek_reasoner",
]);

export interface ModelProviderPreset {
  id: string;
  label: string;
  description: string;
  provider: string;
  runtimeClass: string;
  apiKeyPlaceholder: string;
  baseUrlPlaceholder: string;
  supportsReasoning: boolean;
  supportsVision: boolean;
  aliases?: string[];
}

const OPENAI_RUNTIME_CLASS = "langchain_openai:ChatOpenAI";
const ANTHROPIC_RUNTIME_CLASS = "langchain_anthropic:ChatAnthropic";
const GEMINI_RUNTIME_CLASS = "langchain_google_genai:ChatGoogleGenerativeAI";
const DEEPSEEK_RUNTIME_CLASS = "langchain_deepseek:ChatDeepSeek";

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Best for GPT and most OpenAI-compatible APIs.",
    provider: "openai",
    runtimeClass: OPENAI_RUNTIME_CLASS,
    apiKeyPlaceholder: "$OPENAI_API_KEY",
    baseUrlPlaceholder: "Leave empty for the official OpenAI endpoint",
    supportsReasoning: true,
    supportsVision: true,
    aliases: ["openai-compatible", "openai_compatible"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude-style APIs with built-in thinking support.",
    provider: "anthropic",
    runtimeClass: ANTHROPIC_RUNTIME_CLASS,
    apiKeyPlaceholder: "$ANTHROPIC_API_KEY",
    baseUrlPlaceholder: "Leave empty for the official Anthropic endpoint",
    supportsReasoning: true,
    supportsVision: true,
    aliases: ["anthropic-compatible", "anthropic_compatible"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini models through the Google GenAI integration.",
    provider: "google",
    runtimeClass: GEMINI_RUNTIME_CLASS,
    apiKeyPlaceholder: "$GOOGLE_API_KEY",
    baseUrlPlaceholder: "Usually not needed for Gemini",
    supportsReasoning: true,
    supportsVision: true,
    aliases: ["gemini", "google-genai", "google_genai"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "Reasoning is model-selected for DeepSeek reasoner variants, not configured through a generic payload toggle.",
    provider: "deepseek",
    runtimeClass: DEEPSEEK_RUNTIME_CLASS,
    apiKeyPlaceholder: "$DEEPSEEK_API_KEY",
    baseUrlPlaceholder: "Leave empty for the official DeepSeek endpoint",
    supportsReasoning: false,
    supportsVision: false,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Fill provider and runtime class manually.",
    provider: "",
    runtimeClass: "",
    apiKeyPlaceholder: "Provider key or $ENV_VAR",
    baseUrlPlaceholder: "Optional custom endpoint",
    supportsReasoning: false,
    supportsVision: false,
  },
];

export const DEFAULT_MODEL_PRESET_ID = "openai";

const KNOWN_CONFIG_KEYS = new Set([
  "use",
  "model",
  "api_key",
  "base_url",
  "max_input_tokens",
  "supports_vision",
  "reasoning",
  // Keep retired keys reserved so opening an older row rewrites it onto the
  // canonical reasoning contract instead of echoing stale fields back out.
  "reasoning_effort",
  "supports_reasoning_effort",
  "supports_thinking",
  "supports_effort",
  "when_thinking_enabled",
]);

const MODEL_PROVIDER_PRESET_MAP = new Map(
  MODEL_PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
);

export interface ModelMutationPayload {
  name: string;
  display_name: string | null;
  provider: string;
  enabled: boolean;
  config_json: Record<string, unknown>;
}

export interface CanonicalReasoningConfig {
  contract: ModelReasoningContract;
  defaultLevel: ModelReasoningLevel;
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
  supportsVision: boolean;
  supportsReasoning: boolean;
  reasoningDefaultLevel: ModelReasoningLevel;
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

function isModelReasoningLevel(value: unknown): value is ModelReasoningLevel {
  return (
    typeof value === "string"
    && MODEL_REASONING_LEVEL_SET.has(value as ModelReasoningLevel)
  );
}

function isModelReasoningContract(
  value: unknown,
): value is ModelReasoningContract {
  return (
    typeof value === "string"
    && MODEL_REASONING_CONTRACT_SET.has(value as ModelReasoningContract)
  );
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
  | "supportsReasoning"
  | "supportsVision"
  | "reasoningDefaultLevel"
> {
  return {
    provider: preset.provider,
    use: preset.runtimeClass,
    supportsReasoning: preset.supportsReasoning,
    supportsVision: preset.supportsVision,
    reasoningDefaultLevel: "auto",
  };
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

function inferReasoningContract(
  runtimeClass: string,
  model: string,
): ModelReasoningContract | null {
  const normalizedRuntimeClass = normalizeText(runtimeClass);
  const normalizedModel = normalizeText(model).toLowerCase();

  if (normalizedRuntimeClass === OPENAI_RUNTIME_CLASS) {
    return "openai_responses";
  }
  if (normalizedRuntimeClass === ANTHROPIC_RUNTIME_CLASS) {
    return "anthropic_thinking";
  }
  if (normalizedRuntimeClass === GEMINI_RUNTIME_CLASS) {
    return normalizedModel.startsWith("gemini-3")
      ? "gemini_level"
      : "gemini_budget";
  }
  if (normalizedRuntimeClass === DEEPSEEK_RUNTIME_CLASS) {
    return normalizedModel.includes("reasoner")
      || normalizedModel.startsWith("deepseek-r1")
      ? "deepseek_reasoner"
      : null;
  }
  return null;
}

function mapLegacyBudgetToLevel(value: unknown): ModelReasoningLevel | null {
  const budget =
    typeof value === "number" && Number.isInteger(value) ? value : null;
  if (budget == null || budget <= 0) {
    return null;
  }
  if (budget <= 2_000) {
    return "low";
  }
  if (budget <= 8_000) {
    return "medium";
  }
  if (budget <= 16_000) {
    return "high";
  }
  return "max";
}

function getLegacyThinkingConfig(
  config: Record<string, unknown>,
): Record<string, unknown> | null {
  const thinkingConfig = config.when_thinking_enabled;
  if (!isRecord(thinkingConfig)) {
    return null;
  }

  if (isRecord(thinkingConfig.thinking)) {
    return thinkingConfig.thinking;
  }

  const extraBody = thinkingConfig.extra_body;
  if (!isRecord(extraBody) || !isRecord(extraBody.thinking)) {
    return null;
  }

  return extraBody.thinking;
}

function getLegacyReasoning(
  config: Record<string, unknown>,
): CanonicalReasoningConfig | null {
  const contract = inferReasoningContract(
    getConfigString(config, "use"),
    getConfigString(config, "model"),
  );
  if (!contract) {
    return null;
  }

  let defaultLevel: ModelReasoningLevel = "auto";
  const rawReasoningEffort = config.reasoning_effort;
  if (typeof rawReasoningEffort === "string") {
    const normalized = rawReasoningEffort.trim().toLowerCase();
    if (isModelReasoningLevel(normalized)) {
      defaultLevel = normalized;
    }
  }

  const legacyThinking = getLegacyThinkingConfig(config);
  if (legacyThinking) {
    const thinkingType =
      typeof legacyThinking.type === "string"
        ? legacyThinking.type.trim().toLowerCase()
        : "";
    if (thinkingType === "adaptive") {
      defaultLevel = "auto";
    }
    const budgetLevel = mapLegacyBudgetToLevel(
      legacyThinking.budget_tokens ?? legacyThinking.budgetTokens,
    );
    if (budgetLevel) {
      defaultLevel = budgetLevel;
    }
  }

  return {
    contract,
    defaultLevel: contract === "deepseek_reasoner" ? "auto" : defaultLevel,
  };
}

function getCanonicalReasoning(
  config: Record<string, unknown>,
): CanonicalReasoningConfig | null {
  if (isRecord(config.reasoning)) {
    const contract = config.reasoning.contract;
    const defaultLevel = config.reasoning.default_level;
    if (
      isModelReasoningContract(contract)
      && isModelReasoningLevel(defaultLevel)
    ) {
      return {
        contract,
        defaultLevel,
      };
    }
  }

  if (
    config.supports_thinking === true
    || config.supports_effort === true
    || isRecord(config.when_thinking_enabled)
  ) {
    return getLegacyReasoning(config);
  }
  return null;
}

export function getModelFormValues(model: AdminModel | null): ModelFormValues {
  const presetId = inferModelPresetId(model);
  const preset = getModelProviderPreset(presetId);
  const config = getModelConfig(model);
  const extraConfig = Object.fromEntries(
    Object.entries(config).filter(([key]) => !KNOWN_CONFIG_KEYS.has(key)),
  );
  const reasoning = getCanonicalReasoning(config);

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
      extraConfig: "",
      ...getPresetSeedValues(preset),
    };
  }

  const runtimeClass = getConfigString(config, "use") || preset.runtimeClass;
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
    supportsVision: getConfigFlag(config, "supports_vision"),
    supportsReasoning: reasoning !== null,
    reasoningDefaultLevel: reasoning?.defaultLevel ?? "auto",
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
    supports_vision: values.supportsVision,
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

  if (values.supportsReasoning) {
    const contract = inferReasoningContract(
      resolved.runtimeClass,
      resolved.model,
    );
    if (!contract) {
      throw new Error(
        t(
          "Cannot infer a reasoning contract for this runtime class and model. Choose a supported provider template or turn reasoning off.",
        ),
      );
    }
    configJson.reasoning = {
      contract,
      default_level:
        contract === "deepseek_reasoner"
          ? "auto"
          : values.reasoningDefaultLevel,
    };
  } else {
    delete configJson.reasoning;
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
  const reasoning = getCanonicalReasoning(config);
  if (reasoning) {
    badges.push(t("Reasoning"));
    badges.push(
      t("Reasoning {level}", {
        level: reasoning.defaultLevel.toUpperCase(),
      }),
    );
  }
  if (config.supports_vision === true) {
    badges.push(t("Vision"));
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
