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

func newConfiguredHandler(t *testing.T, agentRepo agentFinder, modelRepo modelFinder) *LangGraphRuntimeHandler {
	t.Helper()
	handler, err := NewLangGraphRuntimeHandlerWithPatterns(
		agentRepo,
		modelRepo,
		[]string{
			"/threads/*/runs",
			"/threads/*/runs/stream",
			"/threads/*/runs/wait",
		},
		[]string{
			"/threads/*/history",
		},
	)
	if err != nil {
		t.Fatalf("unexpected constructor error: %v", err)
	}
	return handler
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
	handler := newConfiguredHandler(t,
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
	handler := newConfiguredHandler(t,
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
	handler := newConfiguredHandler(t,
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

func TestLangGraphHistoryAllowsMissingModelAndInjectsUserID(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := newConfiguredHandler(t,
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
	)

	testUserID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{"limit":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/history", bytes.NewBufferString(reqBody))
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
	if got := configurable["user_id"]; got != testUserID.String() {
		t.Fatalf("expected user_id %s, got %v", testUserID, got)
	}
}

func TestLangGraphCancelRunDoesNotRequireModel(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := newConfiguredHandler(t,
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
	)

	testUserID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs/r1/cancel", bytes.NewBufferString(reqBody))
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
	if got := configurable["user_id"]; got != testUserID.String() {
		t.Fatalf("expected user_id %s, got %v", testUserID, got)
	}
}

func TestLangGraphCronDoesNotRequireModel(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := newConfiguredHandler(t,
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
	)

	testUserID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/runs/cancel", bytes.NewBufferString(reqBody))
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
	if got := configurable["user_id"]; got != testUserID.String() {
		t.Fatalf("expected user_id %s, got %v", testUserID, got)
	}
}

func TestLangGraphRuntimeCustomPatternApplied(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler, err := NewLangGraphRuntimeHandlerWithPatterns(
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
		[]string{"/runs/*"},
		nil,
	)
	if err != nil {
		t.Fatalf("unexpected constructor error: %v", err)
	}

	router := gin.New()
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	reqBody := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/runs/cancel", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestLangGraphRuntimeRejectsInvalidPattern(t *testing.T) {
	t.Parallel()
	_, err := NewLangGraphRuntimeHandlerWithPatterns(
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
		[]string{"[invalid"},
		nil,
	)
	if err == nil {
		t.Fatalf("expected invalid pattern error")
	}
}

func TestLangGraphRuntimeRejectsEmptyRequiredPatterns(t *testing.T) {
	t.Parallel()
	_, err := NewLangGraphRuntimeHandlerWithPatterns(
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
		nil,
		nil,
	)
	if err == nil {
		t.Fatalf("expected empty required path error")
	}
}

func TestLangGraphThreadSearchInjectsMetadataUserID(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := newConfiguredHandler(t,
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
	)

	testUserID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{"limit":10}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/search", bytes.NewBufferString(reqBody))
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

	metadata := response["metadata"].(map[string]interface{})
	if got := metadata["user_id"]; got != testUserID.String() {
		t.Fatalf("expected metadata.user_id %s, got %v", testUserID, got)
	}

	configurable := response["configurable"].(map[string]interface{})
	if got := configurable["user_id"]; got != testUserID.String() {
		t.Fatalf("expected configurable.user_id %s, got %v", testUserID, got)
	}
}

func TestLangGraphThreadSearchRejectsMismatchedMetadataUserID(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := newConfiguredHandler(t,
		&fakeAgentRepo{},
		&fakeModelRepo{models: map[string]*repository.ModelRecord{}},
	)

	testUserID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	reqBody := `{"metadata":{"user_id":"00000000-0000-0000-0000-000000000000"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/search", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
