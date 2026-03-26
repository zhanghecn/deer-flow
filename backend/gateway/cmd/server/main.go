package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/openagents/gateway/internal/bootstrap"
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
	if err := bootstrap.LoadSharedEnv(); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Fatalf("Failed to load root .env: %v", err)
		}
		log.Printf(
			"Note: root .env file not found at %s; using environment variables",
			bootstrap.SharedEnvPath(),
		)
	}

	// Load gateway config
	cfgPath := os.Getenv("GATEWAY_CONFIG_PATH")
	if cfgPath == "" {
		cfgPath = bootstrap.GatewayConfigPath()
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Align with the Python runtime: relative OPENAGENTS_HOME paths resolve
	// from the project root, while shared skills live in a sibling skills/ dir.
	baseDir := storage.ResolveBaseDir(cfg.Storage.BaseDir)

	extensionsConfigPath := bootstrap.ExtensionsConfigPath()

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
	modelRepo := repository.NewModelRepo(pool)
	threadRepo := repository.NewThreadRepo(pool)
	knowledgeRepo := repository.NewKnowledgeRepo(pool)
	adminObservabilityRepo := repository.NewAdminObservabilityRepo(pool)

	// Services
	agentSvc := service.NewAgentService(fs)
	skillSvc := service.NewSkillService(fs)

	// Handlers
	authH := handler.NewAuthHandler(userRepo, tokenRepo, jwtMgr, fs)
	agentH := handler.NewAgentHandler(agentSvc, fs, tokenRepo)
	skillH := handler.NewSkillHandler(skillSvc, fs, extensionsConfigPath)
	modelH := handler.NewModelHandler(modelRepo)
	memoryH := handler.NewMemoryHandler(fs)
	mcpH := handler.NewMCPHandler(extensionsConfigPath)
	threadsH := handler.NewThreadsHandler(threadRepo, cfg.Upstream.LangGraphURL, fs)
	uploadsH := handler.NewUploadsHandler(fs)
	artifactsH := handler.NewArtifactsHandler(fs)
	knowledgeH := handler.NewKnowledgeHandler(knowledgeRepo, fs)
	onlyOfficeH := handler.NewOnlyOfficeHandler(fs, handler.OnlyOfficeConfig{
		ServerURL:    cfg.OnlyOffice.ServerURL,
		PublicAppURL: cfg.OnlyOffice.PublicAppURL,
		JWTSecret:    resolveOnlyOfficeJWTSecret(),
	})
	openAPIH := handler.NewOpenAPIHandler(modelRepo, cfg.Upstream.LangGraphURL, fs)
	langGraphRuntimeH := handler.NewLangGraphRuntimeHandler()
	adminH := handler.NewAdminHandler(userRepo, adminObservabilityRepo, modelRepo)

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

	office := r.Group("/api/office")
	{
		office.GET("/threads/:id/files/:head/*tail", onlyOfficeH.File)
		office.POST("/threads/:id/callback/:head/*tail", onlyOfficeH.Callback)
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
		api.POST("/agents/:name/export/demo", agentH.ExportDemo)

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
		api.DELETE("/threads", threadsH.ClearAll)
		api.DELETE("/threads/:id", threadsH.Delete)
		api.GET("/threads/:id/runtime", threadsH.GetRuntime)
		api.PATCH("/threads/:id/title", threadsH.UpdateTitle)

		// Uploads
		api.POST("/threads/:id/uploads", uploadsH.Upload)
		api.GET("/threads/:id/uploads/list", uploadsH.List)
		api.DELETE("/threads/:id/uploads/:filename", uploadsH.Delete)

		// Knowledge bases
		api.GET("/knowledge/bases", knowledgeH.ListLibrary)
		api.POST("/knowledge/bases", knowledgeH.CreateLibraryBase)
		api.DELETE("/knowledge/bases/:knowledge_base_id", knowledgeH.DeleteBase)
		api.PATCH("/knowledge/bases/:knowledge_base_id/settings", knowledgeH.UpdateBaseSettings)
		api.GET("/knowledge/documents/:document_id/file", knowledgeH.VisibleDocumentFile)
		api.GET("/knowledge/documents/:document_id/tree", knowledgeH.VisibleDocumentTree)
		api.GET("/knowledge/documents/:document_id/build-events", knowledgeH.VisibleDocumentBuildEvents)
		api.GET("/knowledge/documents/:document_id/debug", knowledgeH.DocumentDebug)
		api.GET("/threads/:id/knowledge/bases", knowledgeH.List)
		api.POST("/threads/:id/knowledge/bases", knowledgeH.Create)
		api.POST("/threads/:id/knowledge/bases/:knowledge_base_id/attach", knowledgeH.AttachBase)
		api.DELETE("/threads/:id/knowledge/bases/:knowledge_base_id/attach", knowledgeH.DetachBase)
		api.POST("/threads/:id/knowledge/index-uploaded", knowledgeH.IndexUploaded)
		api.GET("/threads/:id/knowledge/documents/:document_id/tree", knowledgeH.DocumentTree)
		api.GET("/threads/:id/knowledge/documents/:document_id/build-events", knowledgeH.DocumentBuildEvents)

		// Artifacts
		api.GET("/threads/:id/artifacts/list", artifactsH.List)
		api.GET("/threads/:id/artifacts/:head/*tail", artifactsH.Serve)
		api.GET("/threads/:id/office-config/:head/*tail", onlyOfficeH.Config)

		// Admin
		admin := api.Group("/admin")
		admin.Use(middleware.AdminOnly())
		{
			admin.GET("/users", adminH.ListUsers)
			admin.PATCH("/users/:id/role", adminH.UpdateUserRole)
			admin.DELETE("/users/:id", adminH.DeleteUser)
			admin.GET("/stats", adminH.GetStats)
			admin.GET("/models", adminH.ListModels)
			admin.POST("/models", adminH.CreateModel)
			admin.PUT("/models/:name", adminH.UpdateModel)
			admin.DELETE("/models/:name", adminH.DeleteModel)
			admin.GET("/traces", adminH.ListTraces)
			admin.GET("/traces/:trace_id/events", adminH.GetTraceEvents)
			admin.GET("/runtime/threads", adminH.ListRuntimeThreads)
			admin.GET("/runtime/checkpoint-status", adminH.GetCheckpointStatus)
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
		open.GET("/agents/:name/threads/:tid/artifacts/:head/*tail", openAPIH.GetArtifact)
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	log.Printf("Gateway storage base_dir resolved to %s", baseDir)
	log.Printf("OpenAgents Gateway starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func resolveOnlyOfficeJWTSecret() string {
	secret := strings.TrimSpace(os.Getenv("ONLYOFFICE_JWT_SECRET"))
	if secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("JWT_SECRET"))
}
