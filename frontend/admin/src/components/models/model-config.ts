import type { AdminModel } from "@/types";

export const DEFAULT_MODEL_PROVIDER = "anthropic";

const KNOWN_CONFIG_KEYS = new Set([
  "use",
  "model",
  "api_key",
  "base_url",
  "max_input_tokens",
  "supports_thinking",
  "supports_vision",
  "supports_reasoning_effort",
  "when_thinking_enabled",
]);

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
  const value = config[key];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  return "";
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
    throw new Error(`${label} must be valid JSON`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed;
}

export interface ModelFormValues {
  name: string;
  displayName: string;
  provider: string;
  enabled: boolean;
  use: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxInputTokens: string;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsReasoningEffort: boolean;
  whenThinkingEnabled: string;
  extraConfig: string;
}

export function getModelFormValues(model: AdminModel | null): ModelFormValues {
  const config = getModelConfig(model);
  const extraConfig = Object.fromEntries(
    Object.entries(config).filter(([key]) => !KNOWN_CONFIG_KEYS.has(key)),
  );

  return {
    name: model?.name ?? "",
    displayName: model?.display_name ?? "",
    provider: model?.provider ?? DEFAULT_MODEL_PROVIDER,
    enabled: model?.enabled ?? true,
    use: getConfigString(config, "use"),
    model: getConfigString(config, "model"),
    apiKey: getConfigString(config, "api_key"),
    baseUrl: getConfigString(config, "base_url"),
    maxInputTokens: getConfigPositiveInteger(config, "max_input_tokens"),
    supportsThinking: getConfigFlag(config, "supports_thinking"),
    supportsVision: getConfigFlag(config, "supports_vision"),
    supportsReasoningEffort: getConfigFlag(config, "supports_reasoning_effort"),
    whenThinkingEnabled: stringifyJson(config.when_thinking_enabled),
    extraConfig: stringifyJson(extraConfig),
  };
}

export function buildModelPayload(values: ModelFormValues): ModelMutationPayload {
  const configJson: Record<string, unknown> = {
    ...parseJsonObject(values.extraConfig, "Extra config"),
    use: values.use.trim(),
    model: values.model.trim(),
    api_key: values.apiKey.trim(),
    supports_thinking: values.supportsThinking,
    supports_vision: values.supportsVision,
    supports_reasoning_effort: values.supportsReasoningEffort,
  };

  const baseUrl = values.baseUrl.trim();
  if (baseUrl) {
    configJson.base_url = baseUrl;
  } else {
    delete configJson.base_url;
  }

  const maxInputTokens = values.maxInputTokens.trim();
  if (maxInputTokens) {
    const parsed = Number.parseInt(maxInputTokens, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Max input tokens must be a positive integer");
    }
    configJson.max_input_tokens = parsed;
  } else {
    delete configJson.max_input_tokens;
  }

  const whenThinkingEnabled = parseJsonObject(
    values.whenThinkingEnabled,
    "Thinking config",
  );
  if (Object.keys(whenThinkingEnabled).length > 0) {
    configJson.when_thinking_enabled = whenThinkingEnabled;
  } else {
    delete configJson.when_thinking_enabled;
  }

  return {
    name: values.name.trim(),
    display_name: values.displayName.trim() || null,
    provider: values.provider.trim(),
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
    badges.push("Thinking");
  }
  if (config.supports_vision === true) {
    badges.push("Vision");
  }
  if (config.supports_reasoning_effort === true) {
    badges.push("Effort");
  }
  if (
    isRecord(config.when_thinking_enabled) &&
    Object.keys(config.when_thinking_enabled).length > 0
  ) {
    badges.push("Thinking Config");
  }
  const maxInputTokens = config.max_input_tokens;
  if (
    typeof maxInputTokens === "number" &&
    Number.isInteger(maxInputTokens) &&
    maxInputTokens > 0
  ) {
    badges.push(`${Math.round(maxInputTokens / 1000)}K ctx`);
  }
  return badges;
}

export function getModelApiKey(model: AdminModel): string {
  return getConfigString(getModelConfig(model), "api_key");
}
