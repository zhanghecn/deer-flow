package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
	"github.com/openagents/gateway/internal/config"
	"github.com/openagents/gateway/internal/handler"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/proxy"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/jwt"
	"github.com/openagents/gateway/pkg/storage"

	"github.com/gin-gonic/gin"
)

func main() {
	// Prefer shared root env, keep local .env as fallback.
	loadedEnv := false
	for _, envPath := range []string{"../../.env", ".env"} {
		if err := godotenv.Load(envPath); err == nil {
			loadedEnv = true
		}
	}
	if !loadedEnv {
		log.Printf("Note: .env file not found in ../../.env or .env; using environment variables")
	}

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

	// Find main config.yaml (for MCP config compatibility)
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
	modelRepo := repository.NewModelRepo(pool)
	threadRepo := repository.NewThreadRepo(pool)
	adminObservabilityRepo := repository.NewAdminObservabilityRepo(pool)
	llmKeyRepo := repository.NewLLMKeyRepo(pool)

	// Services
	agentSvc := service.NewAgentService(agentRepo, fs)
	skillSvc := service.NewSkillService(skillRepo, fs)

	// Handlers
	authH := handler.NewAuthHandler(userRepo, tokenRepo, jwtMgr, fs)
	agentH := handler.NewAgentHandler(agentSvc)
	skillH := handler.NewSkillHandler(skillSvc)
	modelH := handler.NewModelHandler(modelRepo)
	memoryH := handler.NewMemoryHandler(fs)
	mcpH := handler.NewMCPHandler(filepath.Dir(mainConfigPath))
	threadsH := handler.NewThreadsHandler(threadRepo)
	uploadsH := handler.NewUploadsHandler(fs)
	artifactsH := handler.NewArtifactsHandler(fs)
	openAPIH := handler.NewOpenAPIHandler(agentRepo, modelRepo, cfg.Upstream.LangGraphURL, fs)
	langGraphRuntimeH := handler.NewLangGraphRuntimeHandler()
	adminH := handler.NewAdminHandler(userRepo, adminObservabilityRepo, llmKeyRepo)

	// Compile proxy routes from gateway.yaml config
	loggingLevel := strings.ToLower(cfg.Logging.Level)
	proxyDebug := cfg.Logging.ProxyDebug || loggingLevel == "debug"
	var proxyRoutes []*proxy.Route
	for _, rc := range cfg.Proxy.Routes {
		injectBody := rc.InjectBody
		if rc.Prefix == "/api/langgraph" {
			// LangGraph route uses dedicated runtime injector middleware.
			injectBody = nil
		}
		route, err := proxy.NewRoute(proxy.RouteConfig{
			Prefix:        rc.Prefix,
			Upstream:      rc.Upstream,
			StripPrefix:   rc.StripPrefix,
			Auth:          rc.Auth,
			InjectHeaders: rc.InjectHeaders,
			InjectBody:    injectBody,
			Debug:         proxyDebug,
			LogHeaders:    cfg.Logging.ProxyLogHeaders,
		})
		if err != nil {
			log.Fatalf("Failed to create proxy route %s: %v", rc.Prefix, err)
		}
		proxyRoutes = append(proxyRoutes, route)
		log.Printf(
			"Proxy route: %s -> %s (auth=%s, strip=%v, debug=%v, log_headers=%v)",
			rc.Prefix,
			rc.Upstream,
			rc.Auth,
			rc.StripPrefix,
			proxyDebug,
			cfg.Logging.ProxyLogHeaders,
		)
	}

	// Router
	if loggingLevel == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	if cfg.Logging.AccessLog {
		r.Use(gin.Logger())
	}
	r.Use(gin.Recovery())
	r.Use(middleware.CORS())
	log.Printf(
		"Gateway logging: level=%s access_log=%v proxy_debug=%v proxy_log_headers=%v",
		cfg.Logging.Level,
		cfg.Logging.AccessLog,
		proxyDebug,
		cfg.Logging.ProxyLogHeaders,
	)

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "openagents-gateway"})
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
		api.GET("/agents/check", agentH.CheckName)
		api.POST("/agents", agentH.Create)
		api.GET("/agents/:name", agentH.Get)
		api.PUT("/agents/:name", agentH.Update)
		api.DELETE("/agents/:name", agentH.Delete)
		api.POST("/agents/:name/publish", agentH.Publish)
		api.GET("/agents/:name/export", agentH.Export)

		// Skills
		api.GET("/skills", skillH.List)
		api.POST("/skills", skillH.Create)
		api.POST("/skills/install", skillH.Install)
		api.PUT("/skills/:name", skillH.Update)
		api.DELETE("/skills/:name", skillH.Delete)
		api.POST("/skills/:name/publish", skillH.Publish)

		// Models
		api.GET("/models", modelH.List)

		// Memory
		api.GET("/memory", memoryH.Get)
		api.POST("/memory", memoryH.Update)

		// MCP
		api.GET("/mcp/config", mcpH.Get)
		api.PUT("/mcp/config", mcpH.Update)

		// Threads index (database-backed source of truth for sidebar/search)
		api.POST("/threads/search", threadsH.Search)

		// Uploads
		api.POST("/threads/:id/uploads", uploadsH.Upload)
		api.GET("/threads/:id/uploads/list", uploadsH.List)
		api.DELETE("/threads/:id/uploads/:filename", uploadsH.Delete)

		// Artifacts
		api.GET("/threads/:id/artifacts/*path", artifactsH.Serve)

		// Admin
		admin := api.Group("/admin")
		admin.Use(middleware.AdminOnly())
		{
			admin.GET("/users", adminH.ListUsers)
			admin.PATCH("/users/:id/role", adminH.UpdateUserRole)
			admin.DELETE("/users/:id", adminH.DeleteUser)
			admin.GET("/stats", adminH.GetStats)
			admin.GET("/traces", adminH.ListTraces)
			admin.GET("/traces/:trace_id/events", adminH.GetTraceEvents)
			admin.GET("/runtime/threads", adminH.ListRuntimeThreads)
			admin.GET("/runtime/checkpoint-status", adminH.GetCheckpointStatus)
			admin.GET("/llm-keys", adminH.ListLLMKeys)
			admin.POST("/llm-keys", adminH.CreateLLMKey)
			admin.PUT("/llm-keys/:id", adminH.UpdateLLMKey)
			admin.DELETE("/llm-keys/:id", adminH.DeleteLLMKey)
		}

	}

	// Register proxy routes from config (declarative, no code changes needed)
	for _, route := range proxyRoutes {
		isLangGraphRoute := route.Prefix() == "/api/langgraph"
		switch route.AuthType() {
		case "jwt":
			if isLangGraphRoute {
				r.Any(
					route.Prefix()+"/*path",
					middleware.JWTAuth(jwtMgr),
					langGraphRuntimeH.InjectRuntimeConfig(),
					route.Handler(),
				)
			} else {
				// Register under the JWT-protected api group
				r.Any(route.Prefix()+"/*path", middleware.JWTAuth(jwtMgr), route.Handler())
			}
		case "token":
			r.Any(route.Prefix()+"/*path", middleware.APITokenAuth(tokenRepo), route.Handler())
		default:
			r.Any(route.Prefix()+"/*path", route.Handler())
		}
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
	log.Printf("OpenAgents Gateway starting on %s", addr)
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
