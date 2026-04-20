package handler

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
)

type threadOwnerRepository interface {
	GetOwnerByThreadID(ctx context.Context, threadID string) (uuid.UUID, error)
}

func resolveEffectiveThreadUserID(
	ctx context.Context,
	c *gin.Context,
	repo threadOwnerRepository,
	threadID string,
) (uuid.UUID, error) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil || !middleware.IsAdmin(c) {
		return userID, nil
	}

	// Admin thread inspection must impersonate the owning user at the gateway ->
	// runtime boundary because thread bindings and workspace files are keyed by
	// the original owner, not by the admin operator running the inspection.
	return repo.GetOwnerByThreadID(ctx, threadID)
}
