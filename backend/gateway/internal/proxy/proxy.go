package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/httpx"
	"github.com/openagents/gateway/internal/middleware"
)

const upstreamErrorBodyLogLimit = 4096

type replayReadCloser struct {
	io.Reader
	io.Closer
}

// RouteConfig is a single declarative proxy route from gateway.yaml.
type RouteConfig struct {
	Prefix        string            `yaml:"prefix"`
	Upstream      string            `yaml:"upstream"`
	StripPrefix   bool              `yaml:"strip_prefix"`
	Auth          string            `yaml:"auth"`           // "jwt", "token", "none"
	InjectHeaders map[string]string `yaml:"inject_headers"` // headers to forward
	InjectBody    map[string]string `yaml:"inject_body"`    // fields to inject into JSON body, e.g. {"configurable.user_id": "{{.UserID}}"}
	DisableProxy  bool              `yaml:"disable_proxy"`
	Debug         bool
	LogHeaders    bool
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
	if cfg.DisableProxy {
		// Internal stack routes such as /api/langgraph must stay on the direct
		// service-to-service path instead of inheriting host proxy variables.
		rp.Transport = httpx.NewInternalTransport()
	} else {
		rp.Transport = http.DefaultTransport
	}

	originalDirector := rp.Director
	rp.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
	}

	// SSE/streaming: flush immediately
	rp.FlushInterval = -1
	rp.ModifyResponse = func(resp *http.Response) error {
		// Gateway owns CORS policy. Strip upstream CORS headers to avoid duplicated
		// values like "Access-Control-Allow-Origin: *, *" that browsers reject.
		stripCORSHeaders(resp.Header)
		maybeTransformLangGraphHistoryResponse(resp)
		if resp.StatusCode >= http.StatusBadRequest {
			logUpstreamRejection(cfg, resp)
		}

		if cfg.Debug {
			log.Printf(
				"[proxy][resp] route=%s upstream=%s method=%s path=%s status=%d content_length=%d",
				cfg.Prefix,
				cfg.Upstream,
				resp.Request.Method,
				resp.Request.URL.Path,
				resp.StatusCode,
				resp.ContentLength,
			)
		}
		return nil
	}
	rp.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		log.Printf(
			"[proxy][error] route=%s upstream=%s method=%s path=%s raw_query=%s err=%v",
			cfg.Prefix,
			cfg.Upstream,
			req.Method,
			req.URL.Path,
			req.URL.RawQuery,
			err,
		)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		if cfg.Debug {
			_, _ = w.Write([]byte(
				fmt.Sprintf("{\"error\":\"bad gateway\",\"detail\":%q}", err.Error()),
			))
			return
		}
		_, _ = w.Write([]byte("{\"error\":\"bad gateway\"}"))
	}

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
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			if recovered == http.ErrAbortHandler {
				if r.cfg.Debug {
					log.Printf(
						"[proxy][client-abort] route=%s upstream=%s method=%s path=%s raw_query=%s",
						r.cfg.Prefix,
						r.cfg.Upstream,
						c.Request.Method,
						c.Request.URL.Path,
						c.Request.URL.RawQuery,
					)
				}
				return
			}
			panic(recovered)
		}()

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

		if r.cfg.Debug {
			log.Printf(
				"[proxy][req] route=%s upstream=%s method=%s path=%s raw_query=%s content_length=%d",
				r.cfg.Prefix,
				r.cfg.Upstream,
				c.Request.Method,
				c.Request.URL.Path,
				c.Request.URL.RawQuery,
				c.Request.ContentLength,
			)
			if r.cfg.LogHeaders {
				log.Printf("[proxy][req][headers] %s", redactHeaders(c.Request.Header))
			}
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
	contentType := c.ContentType()
	if contentType != "application/json" {
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return
	}
	c.Request.Body.Close()
	if len(body) == 0 {
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		return
	}

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

func redactHeaders(headers http.Header) string {
	safe := make(http.Header, len(headers))
	for k, values := range headers {
		if strings.EqualFold(k, "authorization") || strings.EqualFold(k, "cookie") {
			safe[k] = []string{"<redacted>"}
			continue
		}
		safe[k] = values
	}
	data, err := json.Marshal(safe)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func stripCORSHeaders(headers http.Header) {
	headers.Del("Access-Control-Allow-Origin")
	headers.Del("Access-Control-Allow-Methods")
	headers.Del("Access-Control-Allow-Headers")
	headers.Del("Access-Control-Allow-Credentials")
	headers.Del("Access-Control-Expose-Headers")
	headers.Del("Access-Control-Max-Age")
	headers.Del("Access-Control-Allow-Private-Network")
}

func logUpstreamRejection(cfg RouteConfig, resp *http.Response) {
	requestID := firstHeaderValue(resp.Header, "x-request-id", "request-id")
	method := "-"
	path := "-"
	if resp != nil && resp.Request != nil {
		if resp.Request.Method != "" {
			method = resp.Request.Method
		}
		if resp.Request.URL != nil && resp.Request.URL.Path != "" {
			path = resp.Request.URL.Path
		}
	}

	detail, truncated := extractUpstreamErrorDetail(resp, upstreamErrorBodyLogLimit)
	if detail == "" {
		log.Printf(
			"[proxy][upstream-reject] route=%s upstream=%s method=%s path=%s status=%d request_id=%s",
			cfg.Prefix,
			cfg.Upstream,
			method,
			path,
			resp.StatusCode,
			requestID,
		)
		return
	}

	if truncated {
		detail += " ...(truncated)"
	}
	log.Printf(
		"[proxy][upstream-reject] route=%s upstream=%s method=%s path=%s status=%d request_id=%s detail=%q",
		cfg.Prefix,
		cfg.Upstream,
		method,
		path,
		resp.StatusCode,
		requestID,
		detail,
	)
}

func extractUpstreamErrorDetail(resp *http.Response, limit int) (string, bool) {
	if resp == nil || resp.Body == nil || limit <= 0 {
		return "", false
	}

	contentEncoding := strings.TrimSpace(resp.Header.Get("Content-Encoding"))
	if contentEncoding != "" && !strings.EqualFold(contentEncoding, "identity") {
		return "", false
	}

	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if strings.Contains(contentType, "text/event-stream") {
		return "", false
	}
	if contentType != "" && !strings.Contains(contentType, "application/json") && !strings.HasPrefix(contentType, "text/") {
		return "", false
	}

	originalBody := resp.Body
	sampled, err := io.ReadAll(io.LimitReader(originalBody, int64(limit+1)))
	if err != nil {
		return fmt.Sprintf("<failed to read upstream error body: %v>", err), false
	}
	if len(sampled) == 0 {
		return "", false
	}

	truncated := len(sampled) > limit
	if truncated {
		resp.Body = &replayReadCloser{
			Reader: io.MultiReader(bytes.NewReader(sampled), originalBody),
			Closer: originalBody,
		}
		return strings.TrimSpace(string(sampled[:limit])), true
	}

	_ = originalBody.Close()
	resp.Body = io.NopCloser(bytes.NewReader(sampled))
	resp.ContentLength = int64(len(sampled))
	resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(sampled)))
	return strings.TrimSpace(string(sampled)), false
}

func firstHeaderValue(header http.Header, names ...string) string {
	for _, name := range names {
		value := strings.TrimSpace(header.Get(name))
		if value != "" {
			return value
		}
	}
	return "-"
}
