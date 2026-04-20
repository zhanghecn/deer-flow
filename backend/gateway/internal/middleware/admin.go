package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func IsAdmin(c *gin.Context) bool {
	return strings.EqualFold(GetRole(c), "admin")
}

func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !IsAdmin(c) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			return
		}
		c.Next()
	}
}
