package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type fakeRuntimeStorageRepo struct {
	bindings                   []model.RuntimeStorageThreadBinding
	checkpointSummary          model.RuntimeStorageCheckpointSummary
	checkpointThreadIDs        []string
	checkpointUsage            map[string]model.RuntimeStorageCheckpointUsage
	protection                 map[string]repository.RuntimeThreadProtection
	deletedCheckpointThreadIDs []string
}

func (f *fakeRuntimeStorageRepo) ListThreadBindings(context.Context) ([]model.RuntimeStorageThreadBinding, error) {
	return append([]model.RuntimeStorageThreadBinding(nil), f.bindings...), nil
}

func (f *fakeRuntimeStorageRepo) GetCheckpointSummary(context.Context) (model.RuntimeStorageCheckpointSummary, error) {
	return f.checkpointSummary, nil
}

func (f *fakeRuntimeStorageRepo) ListCheckpointThreadIDs(context.Context) ([]string, error) {
	return append([]string(nil), f.checkpointThreadIDs...), nil
}

func (f *fakeRuntimeStorageRepo) ListCheckpointUsage(
	_ context.Context,
	threadIDs []string,
) (map[string]model.RuntimeStorageCheckpointUsage, error) {
	result := make(map[string]model.RuntimeStorageCheckpointUsage, len(threadIDs))
	for _, threadID := range threadIDs {
		result[threadID] = f.checkpointUsage[threadID]
	}
	return result, nil
}

func (f *fakeRuntimeStorageRepo) DeleteCheckpointRows(_ context.Context, threadIDs []string) (int64, error) {
	f.deletedCheckpointThreadIDs = append(f.deletedCheckpointThreadIDs, threadIDs...)
	return int64(len(threadIDs)), nil
}

func (f *fakeRuntimeStorageRepo) ListThreadProtection(
	_ context.Context,
	threadIDs []string,
) (map[string]repository.RuntimeThreadProtection, error) {
	result := make(map[string]repository.RuntimeThreadProtection, len(threadIDs))
	for _, threadID := range threadIDs {
		result[threadID] = f.protection[threadID]
	}
	return result, nil
}

type fakeRuntimeStorageThreadRepo struct {
	deleted []string
}

func (f *fakeRuntimeStorageThreadRepo) DeleteByUser(_ context.Context, _ uuid.UUID, threadID string) error {
	f.deleted = append(f.deleted, threadID)
	return nil
}

func TestRuntimeStorageScanAggregatesUserAndThreadUsage(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	updatedAt := now.AddDate(0, 0, -181)
	userID := uuid.NewString()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, threadID), "agents", "dev", "cache.bin"), 128)
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, threadID), "workspace", "report.md"), 64)

	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			bindings: []model.RuntimeStorageThreadBinding{
				{
					ThreadID:  threadID,
					UserID:    userID,
					CreatedAt: &updatedAt,
					UpdatedAt: &updatedAt,
				},
			},
			checkpointSummary: model.RuntimeStorageCheckpointSummary{
				Enabled: true,
				Rows:    4,
				Bytes:   512,
			},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{
				threadID: {
					ThreadID: threadID,
					Checkpoints: model.RuntimeStorageCheckpointTableUsage{
						Rows:  3,
						Bytes: 300,
					},
					CheckpointWrites: model.RuntimeStorageCheckpointTableUsage{Rows: 1, Bytes: 80},
				},
			},
			protection: map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		"http://langgraph.invalid",
	)
	svc.now = func() time.Time { return now }

	summary, err := svc.Refresh(context.Background())
	if err != nil {
		t.Fatalf("refresh runtime storage: %v", err)
	}
	if summary.ThreadCount != 1 || summary.UserCount != 1 {
		t.Fatalf("summary counts = threads:%d users:%d, want 1/1", summary.ThreadCount, summary.UserCount)
	}
	if summary.Filesystem.RuntimeCacheBytes != 128 {
		t.Fatalf("runtime cache bytes = %d, want 128", summary.Filesystem.RuntimeCacheBytes)
	}

	users, err := svc.Users(context.Background(), false)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) != 1 || users[0].CleanupCandidateCount == 0 {
		t.Fatalf("expected one user with cleanup candidates, got %#v", users)
	}

	thread, ok, err := svc.ThreadDetail(context.Background(), threadID, false)
	if err != nil || !ok {
		t.Fatalf("thread detail ok=%v err=%v", ok, err)
	}
	if !thread.FullDeleteEligible {
		t.Fatalf("expected inactive thread to be eligible for whole-session delete")
	}
	if !containsString(thread.CandidateReasons, model.RuntimeStorageActionFullThreadDelete+":inactive_180d") {
		t.Fatalf("expected whole-session delete candidate, got %#v", thread.CandidateReasons)
	}
}

func TestRuntimeStorageThreadsPageFiltersAndPaginates(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	oldAt := now.AddDate(0, 0, -40)
	newAt := now.AddDate(0, 0, -2)
	userID := uuid.NewString()
	otherUserID := uuid.NewString()
	firstThreadID := uuid.NewString()
	secondThreadID := uuid.NewString()
	otherThreadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, firstThreadID), "workspace", "a.bin"), 10)
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, secondThreadID), "workspace", "b.bin"), 30)
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(otherUserID, otherThreadID), "workspace", "c.bin"), 20)

	reviewer := "reviewer"
	planner := "planner"
	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			bindings: []model.RuntimeStorageThreadBinding{
				{ThreadID: firstThreadID, UserID: userID, AgentName: &reviewer, UpdatedAt: &oldAt},
				{ThreadID: secondThreadID, UserID: userID, AgentName: &planner, UpdatedAt: &oldAt},
				{ThreadID: otherThreadID, UserID: otherUserID, AgentName: &reviewer, UpdatedAt: &newAt},
			},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{},
			protection:      map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		"http://langgraph.invalid",
	)
	svc.now = func() time.Time { return now }

	page, err := svc.ThreadsPage(context.Background(), true, model.RuntimeStorageListOptions{
		UserID:       userID,
		Query:        "reviewer",
		InactiveDays: 30,
		Limit:        1,
		Offset:       0,
		SortBy:       "total_bytes",
	})
	if err != nil {
		t.Fatalf("threads page: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ThreadID != firstThreadID {
		t.Fatalf("unexpected paged threads: total=%d items=%#v", page.Total, page.Items)
	}
}

func TestRuntimeStorageUsersPageFiltersByChildThreads(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	oldAt := now.AddDate(0, 0, -45)
	newAt := now.AddDate(0, 0, -2)
	userID := uuid.NewString()
	otherUserID := uuid.NewString()
	targetThreadID := uuid.NewString()
	otherThreadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, targetThreadID), "workspace", "target.bin"), 10)
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(otherUserID, otherThreadID), "workspace", "other.bin"), 20)

	reviewer := "storage-reviewer"
	planner := "planner"
	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			bindings: []model.RuntimeStorageThreadBinding{
				{ThreadID: targetThreadID, UserID: userID, AgentName: &reviewer, UpdatedAt: &oldAt},
				{ThreadID: otherThreadID, UserID: otherUserID, AgentName: &planner, UpdatedAt: &newAt},
			},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{},
			protection:      map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		"http://langgraph.invalid",
	)
	svc.now = func() time.Time { return now }

	page, err := svc.UsersPage(context.Background(), true, model.RuntimeStorageListOptions{
		Query:        "storage-reviewer",
		InactiveDays: 30,
		Limit:        10,
	})
	if err != nil {
		t.Fatalf("users page: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].UserID != userID {
		t.Fatalf("unexpected users page: total=%d items=%#v", page.Total, page.Items)
	}
}

func TestRuntimeStorageScanKeepsCheckpointOnlyRowsOutOfDeleteCandidates(t *testing.T) {
	t.Parallel()

	threadID := uuid.NewString()
	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			checkpointThreadIDs: []string{threadID},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{
				threadID: {
					ThreadID:    threadID,
					Checkpoints: model.RuntimeStorageCheckpointTableUsage{Rows: 2, Bytes: 32},
				},
			},
			protection: map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		storage.NewFS(t.TempDir()),
		"http://langgraph.invalid",
	)

	summary, err := svc.Refresh(context.Background())
	if err != nil {
		t.Fatalf("refresh runtime storage: %v", err)
	}
	if summary.Checkpoint.Rows != 0 {
		t.Fatalf("checkpoint summary rows = %d, want repository summary default", summary.Checkpoint.Rows)
	}
	preview, err := svc.PreviewCleanup(context.Background(), model.RuntimeStorageCleanupRequest{
		Action: model.RuntimeStorageActionFullThreadDelete,
	})
	if err != nil {
		t.Fatalf("preview cleanup: %v", err)
	}
	if len(preview.Candidates) != 0 || len(preview.Refused) != 0 {
		t.Fatalf("checkpoint-only rows must not become whole-session deletes: %#v", preview)
	}
}

func TestRuntimeStorageCleanupPreviewDoesNotModifyThreadDirectory(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	updatedAt := now.AddDate(0, 0, -200)
	userID := uuid.NewString()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	threadPath := filepath.Join(fsStore.ThreadUserDataDirForUser(userID, threadID), "workspace", "state.md")
	writeSizedFile(t, threadPath, 32)

	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			bindings: []model.RuntimeStorageThreadBinding{
				{ThreadID: threadID, UserID: userID, UpdatedAt: &updatedAt},
			},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{},
			protection:      map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		"http://langgraph.invalid",
	)
	svc.now = func() time.Time { return now }

	preview, err := svc.PreviewCleanup(context.Background(), model.RuntimeStorageCleanupRequest{
		Action:    model.RuntimeStorageActionFullThreadDelete,
		ThreadIDs: []string{threadID},
	})
	if err != nil {
		t.Fatalf("preview cleanup: %v", err)
	}
	if len(preview.Candidates) != 1 || preview.TotalBytesReclaimable != 32 {
		t.Fatalf("unexpected preview: %#v", preview)
	}
	if _, err := os.Stat(threadPath); err != nil {
		t.Fatalf("preview modified thread path: %v", err)
	}
}

func TestRuntimeStorageFullDeleteUserPreviewReturnsRefusedReasons(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	updatedAt := now.AddDate(0, 0, -3)
	userID := uuid.NewString()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, threadID), "workspace", "recent.bin"), 16)

	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			bindings: []model.RuntimeStorageThreadBinding{
				{ThreadID: threadID, UserID: userID, UpdatedAt: &updatedAt},
			},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{},
			protection:      map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		"http://langgraph.invalid",
	)
	svc.now = func() time.Time { return now }

	preview, err := svc.PreviewCleanup(context.Background(), model.RuntimeStorageCleanupRequest{
		Action: model.RuntimeStorageActionFullThreadDelete,
		UserID: userID,
	})
	if err != nil {
		t.Fatalf("preview full delete: %v", err)
	}
	if len(preview.Candidates) != 0 || len(preview.Refused) != 1 {
		t.Fatalf("expected refused recent thread, got candidates=%#v refused=%#v", preview.Candidates, preview.Refused)
	}
	if !containsString(preview.Refused[0].ProtectionReasons, "recent_activity_180d") {
		t.Fatalf("expected recent activity protection, got %#v", preview.Refused[0].ProtectionReasons)
	}
}

func TestRuntimeStorageFullDeletePreviewProtectsAuthoringDrafts(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	updatedAt := now.AddDate(0, 0, -200)
	userID := uuid.NewString()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, threadID), "authoring", "agents", "dev", "reviewer", "AGENTS.md"), 24)

	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			bindings: []model.RuntimeStorageThreadBinding{
				{ThreadID: threadID, UserID: userID, UpdatedAt: &updatedAt},
			},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{},
			protection:      map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		"http://langgraph.invalid",
	)
	svc.now = func() time.Time { return now }

	preview, err := svc.PreviewCleanup(context.Background(), model.RuntimeStorageCleanupRequest{
		Action:    model.RuntimeStorageActionFullThreadDelete,
		ThreadIDs: []string{threadID},
	})
	if err != nil {
		t.Fatalf("preview full delete: %v", err)
	}
	if len(preview.Candidates) != 0 || len(preview.Refused) != 1 {
		t.Fatalf("expected refused full delete, got candidates=%#v refused=%#v", preview.Candidates, preview.Refused)
	}
	if !containsString(preview.Refused[0].ProtectionReasons, "authoring_draft") {
		t.Fatalf("expected authoring_draft protection, got %#v", preview.Refused[0].ProtectionReasons)
	}
}

func TestRuntimeStorageManualFullDeletePreviewAllowsRecentThread(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	updatedAt := now.AddDate(0, 0, -1)
	userID := uuid.NewString()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID, threadID), "workspace", "state.md"), 12)

	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{
			bindings: []model.RuntimeStorageThreadBinding{
				{ThreadID: threadID, UserID: userID, UpdatedAt: &updatedAt},
			},
			checkpointUsage: map[string]model.RuntimeStorageCheckpointUsage{},
			protection:      map[string]repository.RuntimeThreadProtection{},
		},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		"http://langgraph.invalid",
	)
	svc.now = func() time.Time { return now }

	preview, err := svc.PreviewCleanup(context.Background(), model.RuntimeStorageCleanupRequest{
		Action:    model.RuntimeStorageActionFullThreadDelete,
		ThreadIDs: []string{threadID},
	})
	if err != nil {
		t.Fatalf("preview manual full delete: %v", err)
	}
	if len(preview.Candidates) != 1 || len(preview.Refused) != 0 {
		t.Fatalf("expected manual delete candidate, got candidates=%#v refused=%#v", preview.Candidates, preview.Refused)
	}
	if containsString(preview.Candidates[0].ProtectionReasons, "recent_activity_180d") {
		t.Fatalf("manual preview should not be blocked by age, got %#v", preview.Candidates[0].ProtectionReasons)
	}
}

func TestRuntimeStorageFullDeleteRemovesOrphanDirectoryWithOwner(t *testing.T) {
	t.Parallel()

	userID := uuid.New()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	threadPath := filepath.Join(fsStore.ThreadUserDataDirForUser(userID.String(), threadID), "workspace", "orphan.txt")
	writeSizedFile(t, threadPath, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/threads/"+threadID {
			t.Fatalf("unexpected runtime request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{},
		&fakeRuntimeStorageThreadRepo{},
		fsStore,
		server.URL,
	)

	if err := svc.fullThreadDelete(context.Background(), userID.String(), threadID); err != nil {
		t.Fatalf("full orphan delete: %v", err)
	}
	if _, err := os.Stat(fsStore.ThreadDirForUser(userID.String(), threadID)); !os.IsNotExist(err) {
		t.Fatalf("expected orphan thread directory removed, stat err=%v", err)
	}
}

func TestRuntimeStorageFullDeletePrunesRuntimeCheckpoints(t *testing.T) {
	t.Parallel()

	userID := uuid.New()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID.String(), threadID), "workspace", "state.txt"), 8)
	threadRepo := &fakeRuntimeStorageThreadRepo{}
	runtimeDeleteCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodDelete && r.URL.Path == "/threads/"+threadID:
			if got := r.Header.Get("X-User-ID"); got != userID.String() {
				t.Fatalf("runtime delete user header = %q, want %q", got, userID.String())
			}
			runtimeDeleteCount++
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected runtime request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()
	repo := &fakeRuntimeStorageRepo{}
	svc := NewRuntimeStorageService(
		repo,
		threadRepo,
		fsStore,
		server.URL,
	)

	if err := svc.fullThreadDelete(context.Background(), userID.String(), threadID); err != nil {
		t.Fatalf("full thread delete: %v", err)
	}
	if runtimeDeleteCount != 1 {
		t.Fatalf("expected one runtime delete, got %d", runtimeDeleteCount)
	}
	if len(repo.deletedCheckpointThreadIDs) != 1 || repo.deletedCheckpointThreadIDs[0] != threadID {
		t.Fatalf("expected checkpoint delete for %s, got %#v", threadID, repo.deletedCheckpointThreadIDs)
	}
	if len(threadRepo.deleted) != 1 || threadRepo.deleted[0] != threadID {
		t.Fatalf("expected binding delete for %s, got %#v", threadID, threadRepo.deleted)
	}
	if _, err := os.Stat(fsStore.ThreadDirForUser(userID.String(), threadID)); !os.IsNotExist(err) {
		t.Fatalf("expected thread directory removed, stat err=%v", err)
	}
}

func TestRuntimeStorageCleanupJobRefreshesStaleSnapshot(t *testing.T) {
	t.Parallel()

	userID := uuid.New()
	threadID := uuid.NewString()
	fsStore := storage.NewFS(t.TempDir())
	repo := &fakeRuntimeStorageRepo{}
	threadRepo := &fakeRuntimeStorageThreadRepo{}
	deleted := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/threads/"+threadID {
			t.Fatalf("unexpected runtime request %s %s", r.Method, r.URL.Path)
		}
		deleted <- struct{}{}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	svc := NewRuntimeStorageService(repo, threadRepo, fsStore, server.URL)

	if _, err := svc.Refresh(context.Background()); err != nil {
		t.Fatalf("seed empty snapshot: %v", err)
	}

	updatedAt := time.Now().UTC()
	repo.bindings = []model.RuntimeStorageThreadBinding{
		{ThreadID: threadID, UserID: userID.String(), UpdatedAt: &updatedAt},
	}
	writeSizedFile(t, filepath.Join(fsStore.ThreadUserDataDirForUser(userID.String(), threadID), "workspace", "state.txt"), 8)

	job, err := svc.CreateCleanupJob(
		context.Background(),
		uuid.NewString(),
		model.RuntimeStorageCleanupRequest{
			Action:    model.RuntimeStorageActionFullThreadDelete,
			ThreadIDs: []string{threadID},
		},
	)
	if err != nil {
		t.Fatalf("create cleanup job: %v", err)
	}
	if len(job.Items) != 1 || job.Items[0].ThreadID != threadID {
		t.Fatalf("expected refreshed cleanup item for %s, got %#v", threadID, job.Items)
	}

	select {
	case <-deleted:
	case <-time.After(time.Second):
		t.Fatalf("cleanup job did not call runtime delete for refreshed thread")
	}
}

func TestRuntimeStorageCleanupPoliciesOnlyExposeWholeThreadDelete(t *testing.T) {
	t.Parallel()

	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{},
		&fakeRuntimeStorageThreadRepo{},
		storage.NewFS(t.TempDir()),
		"http://langgraph.invalid",
	)

	policies, err := svc.CleanupPolicies(context.Background())
	if err != nil {
		t.Fatalf("list cleanup policies: %v", err)
	}
	if len(policies) != 1 || policies[0].Action != model.RuntimeStorageActionFullThreadDelete {
		t.Fatalf("cleanup policies = %#v, want only full_thread_delete", policies)
	}

	_, err = svc.UpdateCleanupPolicy(
		context.Background(),
		"partial_session_mutation",
		model.RuntimeStorageCleanupPolicyUpdate{},
	)
	if err == nil {
		t.Fatalf("expected partial cleanup policy update to be rejected")
	}
}

func TestRuntimeStorageCleanupJobsRejectPartialSessionActions(t *testing.T) {
	t.Parallel()

	svc := NewRuntimeStorageService(
		&fakeRuntimeStorageRepo{},
		&fakeRuntimeStorageThreadRepo{},
		storage.NewFS(t.TempDir()),
		"http://langgraph.invalid",
	)

	_, err := svc.CreateCleanupJob(
		context.Background(),
		uuid.NewString(),
		model.RuntimeStorageCleanupRequest{
			Action: "partial_session_mutation",
		},
	)
	if err == nil {
		t.Fatalf("expected partial cleanup job to be rejected")
	}
}

func writeSizedFile(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
