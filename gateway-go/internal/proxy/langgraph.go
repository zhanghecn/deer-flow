package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/deer-flow/gateway/internal/middleware"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type LangGraphProxy struct {
	target *url.URL
	proxy  *httputil.ReverseProxy
}

func NewLangGraphProxy(targetURL string) (*LangGraphProxy, error) {
	target, err := url.Parse(targetURL)
	if err != nil {
		return nil, err
	}

	proxy := httputil.NewSingleHostReverseProxy(target)

	// Customize director to inject user_id into configurable
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
	}

	// Support SSE streaming
	proxy.FlushInterval = -1

	return &LangGraphProxy{target: target, proxy: proxy}, nil
}

// Handler returns a gin handler that proxies to LangGraph with user_id injection.
func (p *LangGraphProxy) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := middleware.GetUserID(c)

		// For POST/PUT requests, inject user_id into configurable
		if c.Request.Method == http.MethodPost || c.Request.Method == http.MethodPut {
			p.injectUserID(c, userID)
		}

		// Rewrite path: /api/langgraph/xxx -> /xxx
		c.Request.URL.Path = c.Param("path")
		if c.Request.URL.Path == "" {
			c.Request.URL.Path = "/"
		}

		p.proxy.ServeHTTP(c.Writer, c.Request)
	}
}

func (p *LangGraphProxy) injectUserID(c *gin.Context, userID uuid.UUID) {
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
		// Not JSON, pass through as-is
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		return
	}

	// Inject user_id into configurable
	configurable, _ := data["configurable"].(map[string]interface{})
	if configurable == nil {
		configurable = make(map[string]interface{})
	}
	configurable["user_id"] = userID.String()
	data["configurable"] = configurable

	modified, err := json.Marshal(data)
	if err != nil {
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		return
	}

	c.Request.Body = io.NopCloser(bytes.NewReader(modified))
	c.Request.ContentLength = int64(len(modified))
}
