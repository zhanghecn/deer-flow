package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/deer-flow/gateway/internal/config"
	"github.com/deer-flow/gateway/internal/handler"
	"github.com/deer-flow/gateway/internal/middleware"
	"github.com/deer-flow/gateway/internal/proxy"
	"github.com/deer-flow/gateway/internal/repository"
	"github.com/deer-flow/gateway/internal/service"
	"github.com/deer-flow/gateway/pkg/jwt"
	"github.com/deer-flow/gateway/pkg/storage"
	"github.com/gin-gonic/gin"
)

func main() {
	// Load gateway config
	cfgPath := os.Getenv("GATEWAY_CONFIG_PATH")
	if cfgPath == "" {
		cfgPath = "gateway.yaml"
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Resolve base dir relative to project root
	baseDir := cfg.Storage.BaseDir
	if !filepath.IsAbs(baseDir) {
		homeDir, _ := os.UserHomeDir()
		baseDir = filepath.Join(homeDir, baseDir)
	}

	// Find main config.yaml (for model list compatibility)
	mainConfigPath := findMainConfig()

	// Initialize database
	pool, err := repository.NewPool(cfg.Database.DSN())
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	// Initialize components
	jwtMgr := jwt.NewManager(cfg.JWT.Secret, cfg.JWT.ExpireHour)
	fs := storage.NewFS(baseDir)

	// Repositories
	userRepo := repository.NewUserRepo(pool)
	tokenRepo := repository.NewAPITokenRepo(pool)
	agentRepo := repository.NewAgentRepo(pool)
	skillRepo := repository.NewSkillRepo(pool)

	// Services
	agentSvc := service.NewAgentService(agentRepo, fs)
	skillSvc := service.NewSkillService(skillRepo, fs)

	// Handlers
	authH := handler.NewAuthHandler(userRepo, tokenRepo, jwtMgr, fs)
	agentH := handler.NewAgentHandler(agentSvc)
	skillH := handler.NewSkillHandler(skillSvc)
	modelH := handler.NewModelHandler(mainConfigPath)
	memoryH := handler.NewMemoryHandler(fs)
	mcpH := handler.NewMCPHandler(filepath.Dir(mainConfigPath))
	uploadsH := handler.NewUploadsHandler(fs)
	artifactsH := handler.NewArtifactsHandler(fs)
	openAPIH := handler.NewOpenAPIHandler(agentRepo, cfg.Upstream.LangGraphURL, fs)

	// LangGraph proxy
	lgProxy, err := proxy.NewLangGraphProxy(cfg.Upstream.LangGraphURL)
	if err != nil {
		log.Fatalf("Failed to create LangGraph proxy: %v", err)
	}

	// Router
	r := gin.Default()
	r.Use(middleware.CORS())

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "deer-flow-gateway"})
	})

	// Public auth routes
	auth := r.Group("/api/auth")
	{
		auth.POST("/register", authH.Register)
		auth.POST("/login", authH.Login)
	}

	// Protected API routes (JWT)
	api := r.Group("/api")
	api.Use(middleware.JWTAuth(jwtMgr))
	{
		// Token management
		api.GET("/auth/tokens", authH.ListTokens)
		api.POST("/auth/tokens", authH.CreateToken)
		api.DELETE("/auth/tokens/:id", authH.DeleteToken)

		// Agents
		api.GET("/agents", agentH.List)
		api.POST("/agents", agentH.Create)
		api.GET("/agents/:name", agentH.Get)
		api.PUT("/agents/:name", agentH.Update)
		api.DELETE("/agents/:name", agentH.Delete)
		api.POST("/agents/:name/publish", agentH.Publish)
		api.GET("/agents/:name/export", agentH.Export)

		// Skills
		api.GET("/skills", skillH.List)
		api.POST("/skills", skillH.Create)
		api.PUT("/skills/:name", skillH.Update)
		api.DELETE("/skills/:name", skillH.Delete)
		api.POST("/skills/:name/publish", skillH.Publish)

		// Models
		api.GET("/models", modelH.List)

		// Memory
		api.GET("/memory", memoryH.Get)
		api.POST("/memory", memoryH.Update)

		// MCP
		api.GET("/mcp", mcpH.Get)
		api.PUT("/mcp", mcpH.Update)

		// Uploads
		api.POST("/threads/:id/uploads", uploadsH.Upload)
		api.GET("/threads/:id/uploads", uploadsH.List)
		api.DELETE("/threads/:id/uploads", uploadsH.Delete)

		// Artifacts
		api.GET("/threads/:id/artifacts/*path", artifactsH.Serve)

		// LangGraph proxy (all methods)
		api.Any("/langgraph/*path", lgProxy.Handler())
	}

	// Open API routes (API Token auth)
	open := r.Group("/open/v1")
	open.Use(middleware.APITokenAuth(tokenRepo))
	{
		open.POST("/agents/:name/chat", openAPIH.Chat)
		open.POST("/agents/:name/stream", openAPIH.Stream)
		open.GET("/agents/:name/threads/:tid/artifacts/*path", openAPIH.GetArtifact)
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	log.Printf("DeerFlow Gateway starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func findMainConfig() string {
	candidates := []string{
		"../config.yaml",
		"config.yaml",
		"../../config.yaml",
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			abs, _ := filepath.Abs(p)
			return abs
		}
	}
	return "config.yaml"
}
