package config

import (
	"testing"
	"time"
)

func TestLoadNovelAgentDefaultsToSafeDemoMode(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	t.Setenv("NOVEL_AGENT_ENABLED", "")
	t.Setenv("NOVEL_AGENT_PROVIDER", "")
	t.Setenv("NOVEL_AGENT_MODEL_A", "")
	t.Setenv("NOVEL_AGENT_MODEL_B", "")
	t.Setenv("NOVEL_AGENT_MODEL_C", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.NovelAgent.Enabled {
		t.Fatal("NovelAgent.Enabled = true, want false")
	}
	if cfg.NovelAgent.Provider != "deepseek" {
		t.Fatalf("NovelAgent.Provider = %q, want deepseek", cfg.NovelAgent.Provider)
	}
	if cfg.NovelAgent.ModelA != "deepseek-flash" || cfg.NovelAgent.ModelB != "deepseek-flash" || cfg.NovelAgent.ModelC != "deepseek-flash" {
		t.Fatalf("unexpected default role models: %#v", cfg.NovelAgent)
	}
	if cfg.NovelAgent.RequestTimeout != 120*time.Second {
		t.Fatalf("NovelAgent.RequestTimeout = %s, want 2m", cfg.NovelAgent.RequestTimeout)
	}
}

func TestLoadNovelAgentReusesExistingDeepSeekKey(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "configured-key")
	t.Setenv("NOVEL_AGENT_ENABLED", "")
	t.Setenv("NOVEL_AGENT_MODEL_A", "")
	t.Setenv("NOVEL_AGENT_MODEL_B", "")
	t.Setenv("NOVEL_AGENT_MODEL_C", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if !cfg.NovelAgent.Enabled {
		t.Fatal("NovelAgent.Enabled = false, want true when the shared DeepSeek key exists")
	}
	if cfg.DeepSeek.APIKey != "configured-key" {
		t.Fatalf("DeepSeek.APIKey = %q, want the shared configured key", cfg.DeepSeek.APIKey)
	}
	if cfg.NovelAgent.ModelA != "deepseek-flash" || cfg.NovelAgent.ModelB != "deepseek-flash" || cfg.NovelAgent.ModelC != "deepseek-flash" {
		t.Fatalf("unexpected default role models: %#v", cfg.NovelAgent)
	}
}

func TestLoadNovelAgentReadsRoleSpecificConfiguration(t *testing.T) {
	t.Setenv("NOVEL_AGENT_ENABLED", "true")
	t.Setenv("NOVEL_AGENT_PROVIDER", "DeepSeek")
	t.Setenv("NOVEL_AGENT_MODEL_A", "planner-model")
	t.Setenv("NOVEL_AGENT_MODEL_B", "writer-model")
	t.Setenv("NOVEL_AGENT_MODEL_C", "reviewer-model")
	t.Setenv("NOVEL_AGENT_REQUEST_TIMEOUT_MS", "5000")
	t.Setenv("NOVEL_AGENT_MAX_RETRIES", "3")
	t.Setenv("NOVEL_AGENT_MAX_INPUT_BYTES", "1234")
	t.Setenv("NOVEL_AGENT_MAX_OUTPUT_TOKENS", "321")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if !cfg.NovelAgent.Enabled || cfg.NovelAgent.Provider != "deepseek" {
		t.Fatalf("unexpected enabled/provider: %#v", cfg.NovelAgent)
	}
	if cfg.NovelAgent.ModelA != "planner-model" || cfg.NovelAgent.ModelB != "writer-model" || cfg.NovelAgent.ModelC != "reviewer-model" {
		t.Fatalf("unexpected role models: %#v", cfg.NovelAgent)
	}
	if cfg.NovelAgent.RequestTimeout != 5*time.Second || cfg.NovelAgent.MaxRetries != 3 || cfg.NovelAgent.MaxInputBytes != 1234 || cfg.NovelAgent.MaxOutputTokens != 321 {
		t.Fatalf("unexpected limits: %#v", cfg.NovelAgent)
	}
}
