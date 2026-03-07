package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		requestHeaders := strings.TrimSpace(c.GetHeader("Access-Control-Request-Headers"))
		if requestHeaders != "" {
			// Reflect requested headers so preflight can pass without maintaining a static allowlist.
			c.Header("Access-Control-Allow-Headers", requestHeaders)
		} else {
			c.Header("Access-Control-Allow-Headers", "*")
		}
		c.Header("Access-Control-Expose-Headers", "x-pagination-total, x-pagination-next, content-location")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
