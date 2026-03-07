package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type fakeAgentRepo struct {
	agents map[string]*model.Agent
	err    error
}

func (f *fakeAgentRepo) FindByName(_ context.Context, name string) (*model.Agent, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.agents[name], nil
}

type fakeModelRepo struct {
	models map[string]*repository.ModelRecord
	err    error
}

func (f *fakeModelRepo) FindEnabledByName(_ context.Context, name string) (*repository.ModelRecord, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.models[name], nil
}

func TestLangGraphRuntimeInjectsModelConfigFromDB(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	modelConfig := map[string]interface{}{
		"use":               "langchain_openai:ChatOpenAI",
		"model":             "gpt-4.1",
		"supports_thinking": true,
	}
	modelConfigJSON, _ := json.Marshal(modelConfig)
	handler := NewLangGraphRuntimeHandler(
		&fakeAgentRepo{},
		&fakeModelRepo{
			models: map[string]*repository.ModelRecord{
				"gpt-4.1": {
					Name:       "gpt-4.1",
					ConfigJSON: modelConfigJSON,
				},
			},
		},
	)

	testUserID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{"input":{"messages":[]},"config":{"configurable":{"model_name":"gpt-4.1"}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	configurable := response["configurable"].(map[string]interface{})
	if got := configurable["model_name"]; got != "gpt-4.1" {
		t.Fatalf("expected model_name gpt-4.1, got %v", got)
	}
	if got := configurable["model"]; got != "gpt-4.1" {
		t.Fatalf("expected model gpt-4.1, got %v", got)
	}
	if got := configurable["user_id"]; got != testUserID.String() {
		t.Fatalf("expected user_id %s, got %v", testUserID, got)
	}

	runtimeModelConfig := configurable["model_config"].(map[string]interface{})
	if got := runtimeModelConfig["name"]; got != "gpt-4.1" {
		t.Fatalf("expected model_config.name gpt-4.1, got %v", got)
	}
}

func TestLangGraphRuntimeUsesAgentModelWhenModelNameMissing(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	agentModel := "gpt-4.1"
	modelConfigJSON, _ := json.Marshal(map[string]interface{}{
		"use":   "langchain_openai:ChatOpenAI",
		"model": "gpt-4.1",
	})
	handler := NewLangGraphRuntimeHandler(
		&fakeAgentRepo{
			agents: map[string]*model.Agent{
				"writer": {
					Name:  "writer",
					Model: &agentModel,
				},
			},
		},
		&fakeModelRepo{
			models: map[string]*repository.ModelRecord{
				"gpt-4.1": {
					Name:       "gpt-4.1",
					ConfigJSON: modelConfigJSON,
				},
			},
		},
	)

	router := gin.New()
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{"configurable":{"agent_name":"writer"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	configurable := response["configurable"].(map[string]interface{})
	if got := configurable["model_name"]; got != "gpt-4.1" {
		t.Fatalf("expected model_name gpt-4.1, got %v", got)
	}
}

func TestLangGraphRuntimeRejectsModelConflictWithAgent(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	agentModel := "gpt-4.1"
	handler := NewLangGraphRuntimeHandler(
		&fakeAgentRepo{
			agents: map[string]*model.Agent{
				"writer": {
					Name:  "writer",
					Model: &agentModel,
				},
			},
		},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
	)

	router := gin.New()
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	reqBody := `{"configurable":{"agent_name":"writer","model_name":"o3"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
