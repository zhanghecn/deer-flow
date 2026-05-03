package model

import "testing"

func TestNormalizeLegacyReasoningConfigRecognizesDeepSeekV4(t *testing.T) {
	t.Parallel()

	normalized, changed := NormalizeLegacyReasoningConfig(map[string]interface{}{
		"use":               deepSeekRuntimeClass,
		"model":             "deepseek-v4-pro",
		"supports_thinking": true,
	})

	if !changed {
		t.Fatal("expected legacy config to be normalized")
	}
	reasoning, ok := normalized["reasoning"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected reasoning config, got %#v", normalized["reasoning"])
	}
	if reasoning["contract"] != ReasoningContractDeepSeek || reasoning["default_level"] != "auto" {
		t.Fatalf("unexpected DeepSeek reasoning config: %#v", reasoning)
	}
}

func TestNormalizeLegacyReasoningConfigSkipsDeepSeekNoneVariant(t *testing.T) {
	t.Parallel()

	normalized, changed := NormalizeLegacyReasoningConfig(map[string]interface{}{
		"use":               deepSeekRuntimeClass,
		"model":             "deepseek-v4-pro-none",
		"supports_thinking": true,
	})

	if !changed {
		t.Fatal("expected legacy config to be normalized")
	}
	if _, ok := normalized["reasoning"]; ok {
		t.Fatalf("expected no reasoning config for none variant, got %#v", normalized["reasoning"])
	}
}
