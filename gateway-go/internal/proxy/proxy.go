package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/openagents/gateway/internal/middleware"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RouteConfig is a single declarative proxy route from gateway.yaml.
type RouteConfig struct {
	Prefix        string            `yaml:"prefix"`
	Upstream      string            `yaml:"upstream"`
	StripPrefix   bool              `yaml:"strip_prefix"`
	Auth          string            `yaml:"auth"`           // "jwt", "token", "none"
	InjectHeaders map[string]string `yaml:"inject_headers"` // headers to forward
	InjectBody    map[string]string `yaml:"inject_body"`    // fields to inject into JSON body, e.g. {"configurable.user_id": "{{.UserID}}"}
}

// Route is a compiled proxy route ready to serve requests.
type Route struct {
	cfg    RouteConfig
	target *url.URL
	proxy  *httputil.ReverseProxy
}

// NewRoute creates a compiled route from config.
func NewRoute(cfg RouteConfig) (*Route, error) {
	target, err := url.Parse(cfg.Upstream)
	if err != nil {
		return nil, err
	}

	rp := httputil.NewSingleHostReverseProxy(target)

	originalDirector := rp.Director
	rp.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
	}

	// SSE/streaming: flush immediately
	rp.FlushInterval = -1

	return &Route{cfg: cfg, target: target, proxy: rp}, nil
}

// Prefix returns the route's path prefix for registration.
func (r *Route) Prefix() string {
	return r.cfg.Prefix
}

// AuthType returns the route's auth type ("jwt", "token", or "none").
func (r *Route) AuthType() string {
	if r.cfg.Auth == "" {
		return "none"
	}
	return r.cfg.Auth
}

// Handler returns a Gin handler that proxies requests to the upstream.
func (r *Route) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Strip prefix
		if r.cfg.StripPrefix && r.cfg.Prefix != "" {
			path := strings.TrimPrefix(c.Request.URL.Path, r.cfg.Prefix)
			if path == "" {
				path = "/"
			}
			c.Request.URL.Path = path
		}

		// Inject headers
		for header, tmpl := range r.cfg.InjectHeaders {
			if value := resolveTemplate(tmpl, c); value != "" {
				c.Request.Header.Set(header, value)
			}
		}

		// Inject body fields (e.g. configurable.user_id for LangGraph)
		if len(r.cfg.InjectBody) > 0 && (c.Request.Method == http.MethodPost || c.Request.Method == http.MethodPut) {
			r.injectBody(c)
		}

		r.proxy.ServeHTTP(c.Writer, c.Request)
	}
}

// injectBody injects fields into the JSON request body.
// This is the gateway's job — like Spring Gateway Filter injecting user context.
// Python/LangGraph is completely unaware of this.
func (r *Route) injectBody(c *gin.Context) {
	if c.Request.Body == nil {
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return
	}
	c.Request.Body.Close()

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		return
	}

	for path, tmpl := range r.cfg.InjectBody {
		value := resolveTemplate(tmpl, c)
		if value != "" {
			setNestedField(data, path, value)
		}
	}

	modified, err := json.Marshal(data)
	if err != nil {
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(modified))
	c.Request.ContentLength = int64(len(modified))
}

// setNestedField sets a value at a dot-separated path.
// e.g. "configurable.user_id" → data["configurable"]["user_id"] = value
func setNestedField(data map[string]interface{}, path string, value interface{}) {
	parts := strings.Split(path, ".")
	current := data
	for i, part := range parts {
		if i == len(parts)-1 {
			current[part] = value
			return
		}
		next, ok := current[part].(map[string]interface{})
		if !ok {
			next = make(map[string]interface{})
			current[part] = next
		}
		current = next
	}
}

// resolveTemplate replaces {{.Field}} placeholders with values from Gin context.
func resolveTemplate(tmpl string, c *gin.Context) string {
	result := tmpl
	if strings.Contains(result, "{{.UserID}}") {
		userID := middleware.GetUserID(c)
		if userID != uuid.Nil {
			result = strings.ReplaceAll(result, "{{.UserID}}", userID.String())
		} else {
			result = strings.ReplaceAll(result, "{{.UserID}}", "")
		}
	}
	if strings.Contains(result, "{{.Role}}") {
		result = strings.ReplaceAll(result, "{{.Role}}", middleware.GetRole(c))
	}
	return result
}
