package handler

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/pkg/storage"
)

func TestValidateOwnedPublishedTokenAgentsAllowsOneOwnedProdAgent(t *testing.T) {
	t.Parallel()

	fsStore := storage.NewFS(t.TempDir())
	ownerUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "contract-reviewer", "prod", ownerUserID.String())

	authHandler := &AuthHandler{fs: fsStore}
	agents, err := authHandler.validateOwnedPublishedTokenAgents(
		ownerUserID,
		[]string{" Contract-Reviewer "},
	)
	if err != nil {
		t.Fatalf("validateOwnedPublishedTokenAgents() error = %v", err)
	}
	if len(agents) != 1 || agents[0] != "contract-reviewer" {
		t.Fatalf("validated agents = %v, want [contract-reviewer]", agents)
	}
}

func TestValidateOwnedPublishedTokenAgentsRejectsNonSingleAgentRequests(t *testing.T) {
	t.Parallel()

	authHandler := &AuthHandler{}
	_, err := authHandler.validateOwnedPublishedTokenAgents(uuid.New(), nil)
	if err == nil || !strings.Contains(err.Error(), "exactly one published agent") {
		t.Fatalf("validateOwnedPublishedTokenAgents(nil) error = %v, want single-agent validation", err)
	}

	_, err = authHandler.validateOwnedPublishedTokenAgents(
		uuid.New(),
		[]string{"reviewer-a", "reviewer-b"},
	)
	if err == nil || !strings.Contains(err.Error(), "exactly one published agent") {
		t.Fatalf("validateOwnedPublishedTokenAgents(multi) error = %v, want single-agent validation", err)
	}
}

func TestValidateOwnedPublishedTokenAgentsRejectsForeignOrNonProdAgents(t *testing.T) {
	t.Parallel()

	fsStore := storage.NewFS(t.TempDir())
	ownerUserID := uuid.New()
	viewerUserID := uuid.New()
	seedOwnedAgentArchive(t, fsStore, "contract-reviewer", "prod", ownerUserID.String())
	seedOwnedAgentArchive(t, fsStore, "draft-reviewer", "dev", ownerUserID.String())

	authHandler := &AuthHandler{fs: fsStore}

	_, err := authHandler.validateOwnedPublishedTokenAgents(
		viewerUserID,
		[]string{"contract-reviewer"},
	)
	if err == nil || !strings.Contains(err.Error(), "you can only create keys for prod agents you own") {
		t.Fatalf("foreign owner validation error = %v, want ownership rejection", err)
	}

	_, err = authHandler.validateOwnedPublishedTokenAgents(
		ownerUserID,
		[]string{"draft-reviewer"},
	)
	if err == nil || !strings.Contains(err.Error(), "published agent") {
		t.Fatalf("non-prod validation error = %v, want published-agent rejection", err)
	}
}
