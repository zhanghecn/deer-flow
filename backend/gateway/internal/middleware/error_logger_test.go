package middleware

import (
	"bytes"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestErrorLoggerLogsAttachedErrorsWithoutQuerySecrets(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(originalOutput)

	router := gin.New()
	router.Use(RequestErrorLogger())
	router.GET("/boom", func(c *gin.Context) {
		// Handlers keep control of the client response but attach the original
		// error so the global request boundary can persist the real reason.
		c.Error(errors.New("database exploded"))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/boom?api_key=secret-token", nil)
	router.ServeHTTP(recorder, request)

	output := logs.String()
	if !strings.Contains(output, "database exploded") {
		t.Fatalf("expected attached error in log, got %q", output)
	}
	if strings.Contains(output, "secret-token") || strings.Contains(output, "api_key") {
		t.Fatalf("log leaked query secret: %q", output)
	}
}

func TestRequestErrorLoggerIgnoresSuccessfulRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(originalOutput)

	router := gin.New()
	router.Use(RequestErrorLogger())
	router.GET("/ok", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ok", nil)
	router.ServeHTTP(recorder, request)

	if logs.Len() != 0 {
		t.Fatalf("expected no log output, got %q", logs.String())
	}
}

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}
