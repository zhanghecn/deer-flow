package middleware

import (
	"log"

	"github.com/gin-gonic/gin"
)

// RequestErrorLogger records errors that handlers attach with c.Error(err).
// This is the common request-boundary hook for unexpected business/runtime
// errors; panic stack traces remain owned by Gin's Recovery middleware.
func RequestErrorLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) == 0 {
			return
		}
		route := c.FullPath()
		if route == "" {
			route = c.Request.URL.Path
		}
		for _, entry := range c.Errors {
			if entry == nil || entry.Err == nil {
				continue
			}
			// Log the route path, not the raw query string, so diagnostics do
			// not accidentally persist credentials passed by a client.
			log.Printf(
				"request error: method=%s route=%s status=%d client_ip=%s err=%v",
				c.Request.Method,
				route,
				c.Writer.Status(),
				c.ClientIP(),
				entry.Err,
			)
		}
	}
}
