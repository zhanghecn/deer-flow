package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/httpx"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

const (
	defaultRuntimeStorageScanInterval = 15 * time.Minute
	defaultRuntimeStoragePolicyTick   = time.Minute
	defaultRuntimeStorageJobLimit     = 200
	defaultRuntimeStorageDeleteDays   = 180
)

type RuntimeStorageRepository interface {
	ListThreadBindings(context.Context) ([]model.RuntimeStorageThreadBinding, error)
	GetCheckpointSummary(context.Context) (model.RuntimeStorageCheckpointSummary, error)
	ListCheckpointThreadIDs(context.Context) ([]string, error)
	ListCheckpointUsage(context.Context, []string) (map[string]model.RuntimeStorageCheckpointUsage, error)
	DeleteCheckpointRows(context.Context, []string) (int64, error)
	ListThreadProtection(context.Context, []string) (map[string]repository.RuntimeThreadProtection, error)
}

type RuntimeStorageThreadBindingRepo interface {
	DeleteByUser(context.Context, uuid.UUID, string) error
}

type RuntimeStoragePolicyStore interface {
	ListRuntimeStorageCleanupPolicies(context.Context) ([]model.RuntimeStorageCleanupPolicy, error)
	UpsertRuntimeStorageCleanupPolicy(context.Context, model.RuntimeStorageCleanupPolicy) error
}

type RuntimeStorageService struct {
	repo         RuntimeStorageRepository
	threadRepo   RuntimeStorageThreadBindingRepo
	fs           *storage.FS
	langGraphURL string
	httpClient   *http.Client
	now          func() time.Time

	mu       sync.RWMutex
	snapshot *runtimeStorageSnapshot
	jobs     map[string]*model.RuntimeStorageCleanupJob
	policies map[string]model.RuntimeStorageCleanupPolicy
}

type runtimeStorageSnapshot struct {
	scan       model.RuntimeStorageScanStatus
	summary    model.RuntimeStorageSummary
	users      []model.RuntimeStorageUserUsage
	userDetail map[string]model.RuntimeStorageUserDetail
	threads    []model.RuntimeStorageThreadUsage
	threadByID map[string]model.RuntimeStorageThreadUsage
}

func NewRuntimeStorageService(
	repo RuntimeStorageRepository,
	threadRepo RuntimeStorageThreadBindingRepo,
	fs *storage.FS,
	langGraphURL string,
) *RuntimeStorageService {
	return &RuntimeStorageService{
		repo:         repo,
		threadRepo:   threadRepo,
		fs:           fs,
		langGraphURL: strings.TrimRight(langGraphURL, "/"),
		httpClient:   httpx.NewInternalHTTPClient(2 * time.Minute),
		now:          time.Now,
		jobs:         map[string]*model.RuntimeStorageCleanupJob{},
		policies:     defaultRuntimeStorageCleanupPolicies(),
	}
}

func (s *RuntimeStorageService) StartBackgroundScanner(ctx context.Context) {
	ticker := time.NewTicker(defaultRuntimeStorageScanInterval)
	go func() {
		defer ticker.Stop()
		if _, err := s.Refresh(ctx); err != nil {
			log.Printf("runtime storage: initial scan failed: %v", err)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := s.Refresh(ctx); err != nil {
					log.Printf("runtime storage: background scan failed: %v", err)
				}
			}
		}
	}()
}

func (s *RuntimeStorageService) StartCleanupPolicyScheduler(ctx context.Context) {
	ticker := time.NewTicker(defaultRuntimeStoragePolicyTick)
	go func() {
		defer ticker.Stop()
		if _, err := s.CleanupPolicies(ctx); err != nil {
			log.Printf("runtime storage: loading cleanup policies failed: %v", err)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runDueCleanupPolicies(ctx)
			}
		}
	}()
}

func (s *RuntimeStorageService) Refresh(ctx context.Context) (model.RuntimeStorageSummary, error) {
	startedAt := s.now().UTC()
	s.mu.Lock()
	if s.snapshot == nil {
		s.snapshot = &runtimeStorageSnapshot{}
	}
	s.snapshot.scan = model.RuntimeStorageScanStatus{
		Status:        "running",
		LastStartedAt: &startedAt,
	}
	s.mu.Unlock()

	snapshot, err := s.scan(ctx, startedAt)
	finishedAt := s.now().UTC()
	if err != nil {
		s.mu.Lock()
		if s.snapshot != nil {
			s.snapshot.scan.Status = "failed"
			s.snapshot.scan.Error = err.Error()
		}
		s.mu.Unlock()
		return model.RuntimeStorageSummary{}, err
	}
	snapshot.scan.Status = "ok"
	snapshot.scan.LastStartedAt = &startedAt
	snapshot.scan.LastSuccessAt = &finishedAt
	snapshot.summary.Scan = snapshot.scan

	s.mu.Lock()
	s.snapshot = snapshot
	s.mu.Unlock()
	return snapshot.summary, nil
}

func (s *RuntimeStorageService) Summary(ctx context.Context, refresh bool) (model.RuntimeStorageSummary, error) {
	if refresh {
		return s.Refresh(ctx)
	}
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return model.RuntimeStorageSummary{}, err
	}
	return snapshot.summary, nil
}

func (s *RuntimeStorageService) Users(ctx context.Context, refresh bool) ([]model.RuntimeStorageUserUsage, error) {
	if refresh {
		if _, err := s.Refresh(ctx); err != nil {
			return nil, err
		}
	}
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	return append([]model.RuntimeStorageUserUsage(nil), snapshot.users...), nil
}

func (s *RuntimeStorageService) UsersPage(
	ctx context.Context,
	refresh bool,
	opts model.RuntimeStorageListOptions,
) (model.RuntimeStorageUserPage, error) {
	if refresh {
		if _, err := s.Refresh(ctx); err != nil {
			return model.RuntimeStorageUserPage{}, err
		}
	}
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return model.RuntimeStorageUserPage{}, err
	}

	limit, offset := normalizeRuntimeStoragePage(opts.Limit, opts.Offset)
	query := strings.ToLower(strings.TrimSpace(opts.Query))
	items := make([]model.RuntimeStorageUserUsage, 0, len(snapshot.users))
	for _, user := range snapshot.users {
		detail := snapshot.userDetail[user.UserID]
		// User rows are the tree roots, so filtering must consider child threads
		// without forcing the admin UI to download every session for large tenants.
		if !runtimeStorageUserMatchesFilters(user, detail.Threads, query, opts.InactiveDays) {
			continue
		}
		items = append(items, user)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return compareRuntimeStorageUsers(items[i], items[j], opts.SortBy)
	})
	total := len(items)
	items = sliceRuntimeStorageUsers(items, limit, offset)
	return model.RuntimeStorageUserPage{
		Items:  items,
		Limit:  limit,
		Offset: offset,
		Total:  total,
	}, nil
}

func (s *RuntimeStorageService) UserDetail(
	ctx context.Context,
	userID string,
	refresh bool,
) (model.RuntimeStorageUserDetail, bool, error) {
	if refresh {
		if _, err := s.Refresh(ctx); err != nil {
			return model.RuntimeStorageUserDetail{}, false, err
		}
	}
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return model.RuntimeStorageUserDetail{}, false, err
	}
	item, ok := snapshot.userDetail[strings.TrimSpace(userID)]
	return item, ok, nil
}

func (s *RuntimeStorageService) Threads(ctx context.Context, refresh bool) ([]model.RuntimeStorageThreadUsage, error) {
	if refresh {
		if _, err := s.Refresh(ctx); err != nil {
			return nil, err
		}
	}
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	return append([]model.RuntimeStorageThreadUsage(nil), snapshot.threads...), nil
}

func (s *RuntimeStorageService) ThreadsPage(
	ctx context.Context,
	refresh bool,
	opts model.RuntimeStorageListOptions,
) (model.RuntimeStorageThreadPage, error) {
	if refresh {
		if _, err := s.Refresh(ctx); err != nil {
			return model.RuntimeStorageThreadPage{}, err
		}
	}
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return model.RuntimeStorageThreadPage{}, err
	}

	limit, offset := normalizeRuntimeStoragePage(opts.Limit, opts.Offset)
	query := strings.ToLower(strings.TrimSpace(opts.Query))
	userID := strings.TrimSpace(opts.UserID)
	items := make([]model.RuntimeStorageThreadUsage, 0, len(snapshot.threads))
	for _, thread := range snapshot.threads {
		if userID != "" && thread.UserID != userID {
			continue
		}
		if opts.InactiveDays > 0 && thread.InactiveDays < opts.InactiveDays {
			continue
		}
		if query != "" && !runtimeStorageThreadMatches(thread, query) {
			continue
		}
		items = append(items, thread)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return compareRuntimeStorageThreads(items[i], items[j], opts.SortBy)
	})
	total := len(items)
	items = sliceRuntimeStorageThreads(items, limit, offset)
	return model.RuntimeStorageThreadPage{
		Items:  items,
		Limit:  limit,
		Offset: offset,
		Total:  total,
	}, nil
}

func (s *RuntimeStorageService) ThreadDetail(
	ctx context.Context,
	threadID string,
	refresh bool,
) (model.RuntimeStorageThreadUsage, bool, error) {
	if refresh {
		if _, err := s.Refresh(ctx); err != nil {
			return model.RuntimeStorageThreadUsage{}, false, err
		}
	}
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return model.RuntimeStorageThreadUsage{}, false, err
	}
	item, ok := snapshot.threadByID[strings.TrimSpace(threadID)]
	return item, ok, nil
}

func (s *RuntimeStorageService) PreviewCleanup(
	ctx context.Context,
	req model.RuntimeStorageCleanupRequest,
) (model.RuntimeStorageCleanupPreview, error) {
	snapshot, err := s.ensureSnapshot(ctx)
	if err != nil {
		return model.RuntimeStorageCleanupPreview{}, err
	}
	return s.buildCleanupPreview(snapshot, req)
}

func (s *RuntimeStorageService) CreateCleanupJob(
	ctx context.Context,
	adminUserID string,
	req model.RuntimeStorageCleanupRequest,
) (model.RuntimeStorageCleanupJob, error) {
	action, err := normalizeCleanupAction(req.Action)
	if err != nil {
		return model.RuntimeStorageCleanupJob{}, err
	}
	req.Action = action
	// Destructive jobs must use a fresh filesystem/database view. The regular
	// page snapshot is intentionally cached, but deleting from a stale snapshot
	// can make a just-created thread look like thread_not_found.
	if _, err := s.Refresh(ctx); err != nil {
		return model.RuntimeStorageCleanupJob{}, err
	}
	preview, err := s.PreviewCleanup(ctx, req)
	if err != nil {
		return model.RuntimeStorageCleanupJob{}, err
	}
	now := s.now().UTC()
	job := model.RuntimeStorageCleanupJob{
		ID:          uuid.NewString(),
		AdminUserID: adminUserID,
		Action:      preview.Action,
		Status:      model.RuntimeStorageJobPending,
		Request:     req,
		Preview:     preview,
		Items:       make([]model.RuntimeStorageCleanupJobItem, 0, len(preview.Candidates)),
		CreatedAt:   now,
	}
	for _, candidate := range preview.Candidates {
		job.Items = append(job.Items, model.RuntimeStorageCleanupJobItem{
			ThreadID:              candidate.ThreadID,
			UserID:                candidate.UserID,
			Action:                candidate.Action,
			Status:                model.RuntimeStorageJobPending,
			BytesPlanned:          candidate.BytesReclaimable,
			CheckpointRowsPlanned: candidate.CheckpointRows,
		})
	}

	s.mu.Lock()
	clonedJob := cloneRuntimeStorageJob(job)
	s.jobs[job.ID] = &clonedJob
	s.mu.Unlock()

	go s.executeCleanupJob(context.Background(), job.ID)
	return job, nil
}

func (s *RuntimeStorageService) GetCleanupJob(jobID string) (model.RuntimeStorageCleanupJob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.jobs[strings.TrimSpace(jobID)]
	if !ok {
		return model.RuntimeStorageCleanupJob{}, false
	}
	return cloneRuntimeStorageJob(*job), true
}

func (s *RuntimeStorageService) CleanupPolicies(
	ctx context.Context,
) ([]model.RuntimeStorageCleanupPolicy, error) {
	s.loadCleanupPolicies(ctx)
	now := s.now().UTC()

	s.mu.RLock()
	policies := make([]model.RuntimeStorageCleanupPolicy, 0, len(s.policies))
	for _, policy := range s.policies {
		policy.NextRunAt = nextCleanupPolicyRun(policy, now)
		policies = append(policies, policy)
	}
	s.mu.RUnlock()

	sort.SliceStable(policies, func(i, j int) bool { return policies[i].Action < policies[j].Action })
	return policies, nil
}

func (s *RuntimeStorageService) UpdateCleanupPolicy(
	ctx context.Context,
	actionRaw string,
	update model.RuntimeStorageCleanupPolicyUpdate,
) (model.RuntimeStorageCleanupPolicy, error) {
	action, err := normalizeCleanupAction(actionRaw)
	if err != nil {
		return model.RuntimeStorageCleanupPolicy{}, err
	}
	s.loadCleanupPolicies(ctx)

	s.mu.Lock()
	policy := s.policies[action]
	if update.Enabled != nil {
		policy.Enabled = *update.Enabled
	}
	if update.DryRun != nil {
		policy.DryRun = *update.DryRun
	}
	if update.InactiveDays != nil {
		if *update.InactiveDays <= 0 {
			s.mu.Unlock()
			return model.RuntimeStorageCleanupPolicy{}, fmt.Errorf("inactive_days must be positive")
		}
		policy.InactiveDays = *update.InactiveDays
	}
	if update.Schedule != nil {
		schedule := strings.TrimSpace(*update.Schedule)
		if !validCleanupSchedule(schedule) {
			s.mu.Unlock()
			return model.RuntimeStorageCleanupPolicy{}, fmt.Errorf("unsupported cleanup schedule")
		}
		policy.Schedule = schedule
	}
	if update.RunAt != nil {
		runAt := strings.TrimSpace(*update.RunAt)
		if !validCleanupRunAt(runAt) {
			s.mu.Unlock()
			return model.RuntimeStorageCleanupPolicy{}, fmt.Errorf("run_at must use HH:MM")
		}
		policy.RunAt = runAt
	}
	if update.Limit != nil {
		if *update.Limit <= 0 || *update.Limit > defaultRuntimeStorageJobLimit {
			s.mu.Unlock()
			return model.RuntimeStorageCleanupPolicy{}, fmt.Errorf("limit must be between 1 and %d", defaultRuntimeStorageJobLimit)
		}
		policy.Limit = *update.Limit
	}
	updatedAt := s.now().UTC()
	policy.UpdatedAt = &updatedAt
	s.policies[action] = policy
	s.mu.Unlock()

	s.persistCleanupPolicy(ctx, policy)
	policy.NextRunAt = nextCleanupPolicyRun(policy, s.now().UTC())
	return policy, nil
}

func (s *RuntimeStorageService) ensureSnapshot(ctx context.Context) (*runtimeStorageSnapshot, error) {
	s.mu.RLock()
	snapshot := s.snapshot
	s.mu.RUnlock()
	if snapshot != nil && snapshot.scan.Status == "ok" {
		return snapshot, nil
	}
	if _, err := s.Refresh(ctx); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshot, nil
}

func (s *RuntimeStorageService) scan(
	ctx context.Context,
	scanTime time.Time,
) (*runtimeStorageSnapshot, error) {
	bindings, err := s.repo.ListThreadBindings(ctx)
	if err != nil {
		return nil, err
	}
	bindingByThreadID := make(map[string]model.RuntimeStorageThreadBinding, len(bindings))
	threadIDs := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		bindingByThreadID[binding.ThreadID] = binding
		threadIDs = append(threadIDs, binding.ThreadID)
	}

	checkpointSummary, err := s.repo.GetCheckpointSummary(ctx)
	if err != nil {
		return nil, err
	}
	checkpointThreadIDs, err := s.repo.ListCheckpointThreadIDs(ctx)
	if err != nil {
		return nil, err
	}
	allCheckpointUsageIDs := mergeRuntimeStorageThreadIDs(threadIDs, checkpointThreadIDs)
	checkpointUsage, err := s.repo.ListCheckpointUsage(ctx, allCheckpointUsageIDs)
	if err != nil {
		return nil, err
	}
	protection, err := s.repo.ListThreadProtection(ctx, threadIDs)
	if err != nil {
		return nil, err
	}

	threads := make([]model.RuntimeStorageThreadUsage, 0, len(bindings))
	seenThreadDirs := map[string]struct{}{}
	for _, binding := range bindings {
		directories, err := s.scanThreadDir(binding.UserID, binding.ThreadID, false)
		if err != nil {
			return nil, err
		}
		item := s.buildThreadUsage(
			scanTime,
			binding,
			directories,
			checkpointUsage[binding.ThreadID],
			protection[binding.ThreadID],
		)
		threads = append(threads, item)
		seenThreadDirs[runtimeStorageThreadDirKey(binding.UserID, binding.ThreadID)] = struct{}{}
	}

	orphanThreads, err := s.scanOrphanThreadDirs(scanTime, seenThreadDirs)
	if err != nil {
		return nil, err
	}
	threads = append(threads, orphanThreads...)
	sort.SliceStable(threads, func(i, j int) bool {
		return compareThreadUsage(threads[i], threads[j])
	})

	users, userDetail := buildUserUsage(threads)
	baseUsage, _, _ := scanUsage(s.fs.BaseDir())
	filesystem := model.RuntimeStorageFilesystemSummary{
		BaseDirBytes: baseUsage.Bytes,
		FileCount:    baseUsage.FileCount,
		DirCount:     baseUsage.DirCount,
	}
	if stats, ok := filesystemStats(s.fs.BaseDir()); ok {
		filesystem.DiskUsagePercent = stats.diskUsagePercent
		filesystem.InodeUsagePercent = stats.inodeUsagePercent
	}
	for _, thread := range threads {
		filesystem.ThreadBytes += thread.FilesystemBytes
		filesystem.RuntimeCacheBytes += thread.RuntimeCacheBytes
	}

	threadByID := make(map[string]model.RuntimeStorageThreadUsage, len(threads))
	candidateCounts := map[string]int64{model.RuntimeStorageActionFullThreadDelete: 0}
	var orphanThreadCount int64
	for _, thread := range threads {
		threadByID[thread.ThreadID] = thread
		if thread.OrphanFSCandidate {
			orphanThreadCount++
		}
		for _, reason := range thread.CandidateReasons {
			if strings.HasPrefix(reason, model.RuntimeStorageActionFullThreadDelete) {
				candidateCounts[model.RuntimeStorageActionFullThreadDelete]++
			}
		}
	}

	topUsers := append([]model.RuntimeStorageUserUsage(nil), users...)
	sort.SliceStable(topUsers, func(i, j int) bool {
		return topUsers[i].TotalBytes > topUsers[j].TotalBytes
	})
	if len(topUsers) > 5 {
		topUsers = topUsers[:5]
	}
	topThreads := append([]model.RuntimeStorageThreadUsage(nil), threads...)
	sort.SliceStable(topThreads, func(i, j int) bool {
		return topThreads[i].TotalBytes > topThreads[j].TotalBytes
	})
	if len(topThreads) > 5 {
		topThreads = topThreads[:5]
	}

	summary := model.RuntimeStorageSummary{
		ThreadCount:       int64(len(bindings)),
		UserCount:         int64(len(users)),
		OrphanThreadCount: orphanThreadCount,
		CandidateCounts:   candidateCounts,
		Filesystem:        filesystem,
		Checkpoint:        checkpointSummary,
		TopUsers:          topUsers,
		TopThreads:        topThreads,
		RecentJobs:        s.recentJobs(5),
	}

	return &runtimeStorageSnapshot{
		summary:    summary,
		users:      users,
		userDetail: userDetail,
		threads:    threads,
		threadByID: threadByID,
	}, nil
}

func (s *RuntimeStorageService) scanThreadDir(
	userID string,
	threadID string,
	orphan bool,
) (model.RuntimeStorageDirectoryBreakdown, error) {
	threadRoot := s.fs.ThreadDirForUser(userID, threadID)
	threadRootUsage, threadRootTime, err := scanUsage(threadRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return model.RuntimeStorageDirectoryBreakdown{MissingOnDisk: true}, nil
		}
		return model.RuntimeStorageDirectoryBreakdown{}, err
	}

	userDataRoot := s.fs.ThreadUserDataDirForUser(userID, threadID)
	userDataUsage, _, _ := scanUsage(userDataRoot)
	workspace, _, _ := scanUsage(filepath.Join(userDataRoot, "workspace"))
	uploads, _, _ := scanUsage(filepath.Join(userDataRoot, "uploads"))
	outputs, _, _ := scanUsage(filepath.Join(userDataRoot, "outputs"))
	authoring, _, _ := scanUsage(filepath.Join(userDataRoot, "authoring"))
	runtimeAgents, _, _ := scanUsage(s.fs.ThreadRuntimeAgentsDirForUser(userID, threadID))
	knownUserDataBytes := workspace.Bytes + uploads.Bytes + outputs.Bytes + authoring.Bytes + runtimeAgents.Bytes

	return model.RuntimeStorageDirectoryBreakdown{
		ThreadRoot:     threadRootUsage,
		Workspace:      workspace,
		Uploads:        uploads,
		Outputs:        outputs,
		Authoring:      authoring,
		RuntimeAgents:  runtimeAgents,
		OtherUserData:  model.RuntimeStorageDirectoryUsage{Bytes: maxInt64(userDataUsage.Bytes-knownUserDataBytes, 0)},
		OrphanOnDisk:   orphan,
		OldestModified: threadRootTime.oldest,
		LatestModified: threadRootTime.latest,
	}, nil
}

func (s *RuntimeStorageService) scanOrphanThreadDirs(
	scanTime time.Time,
	known map[string]struct{},
) ([]model.RuntimeStorageThreadUsage, error) {
	userEntries, err := os.ReadDir(s.fs.UsersDir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	items := make([]model.RuntimeStorageThreadUsage, 0)
	for _, userEntry := range userEntries {
		if !userEntry.IsDir() {
			continue
		}
		userID := userEntry.Name()
		threadEntries, err := os.ReadDir(s.fs.UserThreadsDir(userID))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, entry := range threadEntries {
			if !entry.IsDir() {
				continue
			}
			threadID := entry.Name()
			if _, exists := known[runtimeStorageThreadDirKey(userID, threadID)]; exists {
				continue
			}
			directories, err := s.scanThreadDir(userID, threadID, true)
			if err != nil {
				return nil, err
			}
			lastUsedAt := directories.LatestModified
			daysInactive := inactiveDays(scanTime, lastUsedAt)
			candidateReasons := []string{}
			if daysInactive >= defaultRuntimeStorageDeleteDays {
				candidateReasons = append(candidateReasons, model.RuntimeStorageActionFullThreadDelete+":orphan_inactive_180d")
			}
			item := model.RuntimeStorageThreadUsage{
				RuntimeStorageThreadBinding: model.RuntimeStorageThreadBinding{
					ThreadID: threadID,
					UserID:   userID,
				},
				LastUsedAt:         lastUsedAt,
				InactiveDays:       daysInactive,
				Directories:        directories,
				FilesystemBytes:    directories.ThreadRoot.Bytes,
				RuntimeCacheBytes:  directories.RuntimeAgents.Bytes,
				TotalBytes:         directories.ThreadRoot.Bytes,
				FileCount:          directories.ThreadRoot.FileCount,
				DirCount:           directories.ThreadRoot.DirCount,
				OrphanFSCandidate:  true,
				CandidateReasons:   candidateReasons,
				ProtectionReasons:  []string{},
				FullDeleteEligible: daysInactive >= defaultRuntimeStorageDeleteDays,
			}
			items = append(items, item)
		}
	}
	return items, nil
}

func runtimeStorageThreadDirKey(userID string, threadID string) string {
	return userID + "\x00" + threadID
}

func (s *RuntimeStorageService) buildThreadUsage(
	scanTime time.Time,
	binding model.RuntimeStorageThreadBinding,
	directories model.RuntimeStorageDirectoryBreakdown,
	checkpoint model.RuntimeStorageCheckpointUsage,
	protection repository.RuntimeThreadProtection,
) model.RuntimeStorageThreadUsage {
	lastUsedAt := binding.UpdatedAt
	if lastUsedAt == nil {
		lastUsedAt = directories.LatestModified
	}
	item := model.RuntimeStorageThreadUsage{
		RuntimeStorageThreadBinding: binding,
		LastUsedAt:                  lastUsedAt,
		InactiveDays:                inactiveDays(scanTime, lastUsedAt),
		Directories:                 directories,
		Checkpoint:                  checkpoint,
		FilesystemBytes:             directories.ThreadRoot.Bytes,
		RuntimeCacheBytes:           directories.RuntimeAgents.Bytes,
		CheckpointBytes:             checkpoint.TotalBytes(),
		FileCount:                   directories.ThreadRoot.FileCount,
		DirCount:                    directories.ThreadRoot.DirCount,
		CandidateReasons:            []string{},
		ProtectionReasons:           []string{},
	}
	item.TotalBytes = item.FilesystemBytes + item.CheckpointBytes
	if protection.HasRunningTrace {
		item.ProtectionReasons = append(item.ProtectionReasons, "active_run")
	}
	if protection.HasInterrupt {
		item.ProtectionReasons = append(item.ProtectionReasons, "interrupt")
	}
	if directoryHasContent(directories.Authoring) {
		// Treat any thread-local authoring draft as unsaved unless the explicit
		// save flow has removed it; this favors preserving user edits over
		// reclaiming space aggressively.
		item.ProtectionReasons = append(item.ProtectionReasons, "authoring_draft")
	}
	item.FullDeleteEligible = item.InactiveDays >= defaultRuntimeStorageDeleteDays && len(item.ProtectionReasons) == 0
	if item.FullDeleteEligible {
		item.CandidateReasons = append(item.CandidateReasons, model.RuntimeStorageActionFullThreadDelete+":inactive_180d")
	}
	return item
}

func (s *RuntimeStorageService) buildCleanupPreview(
	snapshot *runtimeStorageSnapshot,
	req model.RuntimeStorageCleanupRequest,
) (model.RuntimeStorageCleanupPreview, error) {
	action, err := normalizeCleanupAction(req.Action)
	if err != nil {
		return model.RuntimeStorageCleanupPreview{}, err
	}
	inactiveDaysThreshold := normalizeCleanupInactiveDays(req.InactiveDays)
	limit := req.Limit
	if limit <= 0 || limit > defaultRuntimeStorageJobLimit {
		limit = defaultRuntimeStorageJobLimit
	}

	manualSelection := len(req.ThreadIDs) > 0
	selected := s.selectPreviewThreads(snapshot, req, inactiveDaysThreshold)
	preview := model.RuntimeStorageCleanupPreview{
		Action:      action,
		Candidates:  []model.RuntimeStorageCleanupCandidate{},
		Refused:     []model.RuntimeStorageCleanupCandidate{},
		GeneratedAt: s.now().UTC(),
	}

	for _, thread := range selected {
		candidate := buildCleanupCandidate(action, thread, inactiveDaysThreshold, manualSelection)
		if candidate.Eligible {
			if len(preview.Candidates) >= limit {
				break
			}
			preview.Candidates = append(preview.Candidates, candidate)
			preview.TotalBytesReclaimable += candidate.BytesReclaimable
			preview.TotalCheckpointRows += candidate.CheckpointRows
			continue
		}
		if len(preview.Refused) < limit {
			preview.Refused = append(preview.Refused, candidate)
		}
	}
	return preview, nil
}

func (s *RuntimeStorageService) selectPreviewThreads(
	snapshot *runtimeStorageSnapshot,
	req model.RuntimeStorageCleanupRequest,
	inactiveDaysThreshold int,
) []model.RuntimeStorageThreadUsage {
	if len(req.ThreadIDs) > 0 {
		items := make([]model.RuntimeStorageThreadUsage, 0, len(req.ThreadIDs))
		seen := map[string]struct{}{}
		for _, rawThreadID := range req.ThreadIDs {
			threadID := strings.TrimSpace(rawThreadID)
			if threadID == "" {
				continue
			}
			if _, exists := seen[threadID]; exists {
				continue
			}
			seen[threadID] = struct{}{}
			if thread, ok := snapshot.threadByID[threadID]; ok {
				items = append(items, thread)
			} else {
				items = append(items, model.RuntimeStorageThreadUsage{
					RuntimeStorageThreadBinding: model.RuntimeStorageThreadBinding{ThreadID: threadID},
					ProtectionReasons:           []string{"thread_not_found"},
				})
			}
		}
		return items
	}

	userID := strings.TrimSpace(req.UserID)
	items := make([]model.RuntimeStorageThreadUsage, 0)
	for _, thread := range snapshot.threads {
		if userID != "" && thread.UserID != userID {
			continue
		}
		// Global scheduled previews stay age-bounded so a large tenant does not
		// make one policy tick walk every recent session. User-scoped previews
		// still include refused rows so an operator can see why deletion is
		// blocked.
		if userID == "" && thread.InactiveDays < inactiveDaysThreshold {
			continue
		}
		items = append(items, thread)
	}
	return items
}

func buildCleanupCandidate(
	action string,
	thread model.RuntimeStorageThreadUsage,
	inactiveDaysThreshold int,
	manualSelection bool,
) model.RuntimeStorageCleanupCandidate {
	candidate := model.RuntimeStorageCleanupCandidate{
		ThreadID:          thread.ThreadID,
		UserID:            thread.UserID,
		Action:            action,
		ProtectionReasons: append([]string(nil), thread.ProtectionReasons...),
		Eligible:          false,
	}
	if thread.ThreadID == "" {
		candidate.ProtectionReasons = append(candidate.ProtectionReasons, "thread_not_found")
		return candidate
	}
	if strings.TrimSpace(thread.UserID) == "" {
		candidate.ProtectionReasons = append(candidate.ProtectionReasons, "missing_thread_owner")
	}
	if !manualSelection && thread.InactiveDays < inactiveDaysThreshold {
		candidate.ProtectionReasons = append(
			candidate.ProtectionReasons,
			fmt.Sprintf("recent_activity_%dd", inactiveDaysThreshold),
		)
	}

	candidate.Reason = "delete runtime thread, gateway binding if present, and files"
	candidate.BytesReclaimable = thread.TotalBytes
	candidate.CheckpointRows = thread.Checkpoint.TotalRows()
	candidate.Eligible = len(candidate.ProtectionReasons) == 0 &&
		(manualSelection || thread.FullDeleteEligible)
	return candidate
}

func mergeRuntimeStorageThreadIDs(groups ...[]string) []string {
	seen := map[string]struct{}{}
	merged := make([]string, 0)
	for _, group := range groups {
		for _, raw := range group {
			threadID := strings.TrimSpace(raw)
			if threadID == "" {
				continue
			}
			if _, exists := seen[threadID]; exists {
				continue
			}
			seen[threadID] = struct{}{}
			merged = append(merged, threadID)
		}
	}
	return merged
}

func (s *RuntimeStorageService) executeCleanupJob(ctx context.Context, jobID string) {
	startedAt := s.now().UTC()
	s.updateJob(jobID, func(job *model.RuntimeStorageCleanupJob) {
		job.Status = model.RuntimeStorageJobRunning
		job.StartedAt = &startedAt
	})

	successCount := 0
	for index := range s.currentJobItems(jobID) {
		itemIndex := index
		s.updateJob(jobID, func(job *model.RuntimeStorageCleanupJob) {
			job.Items[itemIndex].Status = model.RuntimeStorageJobRunning
		})

		item, err := s.executeCleanupItem(ctx, jobID, itemIndex)
		finishedAt := s.now().UTC()
		s.updateJob(jobID, func(job *model.RuntimeStorageCleanupJob) {
			job.Items[itemIndex] = item
			job.Items[itemIndex].FinishedAt = &finishedAt
			if err != nil {
				job.Items[itemIndex].Status = model.RuntimeStorageJobFailed
				job.Items[itemIndex].Error = err.Error()
			} else {
				job.Items[itemIndex].Status = model.RuntimeStorageJobCompleted
				successCount++
			}
		})
	}

	finishedAt := s.now().UTC()
	s.updateJob(jobID, func(job *model.RuntimeStorageCleanupJob) {
		job.FinishedAt = &finishedAt
		switch {
		case len(job.Items) == 0:
			job.Status = model.RuntimeStorageJobCompleted
		case successCount == len(job.Items):
			job.Status = model.RuntimeStorageJobCompleted
		case successCount == 0:
			job.Status = model.RuntimeStorageJobFailed
			job.Error = "all cleanup items failed"
		default:
			job.Status = model.RuntimeStorageJobPartial
		}
	})

	if _, err := s.Refresh(ctx); err != nil {
		log.Printf("runtime storage: post-cleanup refresh failed for job %s: %v", jobID, err)
	}
}

func (s *RuntimeStorageService) executeCleanupItem(
	ctx context.Context,
	jobID string,
	itemIndex int,
) (model.RuntimeStorageCleanupJobItem, error) {
	job, ok := s.GetCleanupJob(jobID)
	if !ok || itemIndex >= len(job.Items) {
		return model.RuntimeStorageCleanupJobItem{}, fmt.Errorf("cleanup job item missing")
	}
	item := job.Items[itemIndex]
	switch item.Action {
	case model.RuntimeStorageActionFullThreadDelete:
		if err := s.fullThreadDelete(ctx, item.UserID, item.ThreadID); err != nil {
			return item, err
		}
		item.BytesFreed = item.BytesPlanned
		item.CheckpointRowsDeleted = item.CheckpointRowsPlanned
	default:
		return item, fmt.Errorf("unsupported cleanup action %q", item.Action)
	}
	return item, nil
}

func (s *RuntimeStorageService) fullThreadDelete(
	ctx context.Context,
	userIDRaw string,
	threadID string,
) error {
	if strings.TrimSpace(userIDRaw) == "" {
		return fmt.Errorf("thread owner is required for whole-session delete")
	}
	userID, err := uuid.Parse(strings.TrimSpace(userIDRaw))
	if err != nil {
		return fmt.Errorf("invalid thread owner id: %w", err)
	}
	if err := s.deleteRuntimeThread(ctx, userID, threadID); err != nil {
		return err
	}
	// LangGraph's thread DELETE does not guarantee checkpoint table cleanup in
	// every runtime version. Delete checkpoint rows explicitly before the
	// gateway binding disappears so admin storage reset jobs leave no dangling
	// database rows for the same thread_id.
	if _, err := s.repo.DeleteCheckpointRows(ctx, []string{threadID}); err != nil {
		return fmt.Errorf("delete checkpoint rows: %w", err)
	}
	if err := s.threadRepo.DeleteByUser(ctx, userID, threadID); err != nil && err != pgx.ErrNoRows {
		return err
	}
	// Keep the existing product deletion order: LangGraph runtime first,
	// gateway-owned binding second, host thread directory last. Filesystem
	// cleanup is deliberately after DB deletion so a runtime failure cannot
	// leave a half-deleted binding that the user interface still opens.
	if err := s.fs.DeleteThreadDirForUser(userID.String(), threadID); err != nil {
		return fmt.Errorf("delete thread directory: %w", err)
	}
	return nil
}

func (s *RuntimeStorageService) deleteRuntimeThread(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) error {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodDelete,
		s.langGraphURL+"/threads/"+url.PathEscape(threadID),
		nil,
	)
	if err != nil {
		return err
	}
	req.Header.Set("X-User-ID", userID.String())
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return fmt.Errorf(
		"langgraph delete thread %s failed with status %d: %s",
		threadID,
		resp.StatusCode,
		strings.TrimSpace(string(body)),
	)
}

func (s *RuntimeStorageService) updateJob(
	jobID string,
	update func(*model.RuntimeStorageCleanupJob),
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[jobID]
	if !ok {
		return
	}
	update(job)
}

func (s *RuntimeStorageService) currentJobItems(jobID string) []model.RuntimeStorageCleanupJobItem {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.jobs[jobID]
	if !ok {
		return nil
	}
	return append([]model.RuntimeStorageCleanupJobItem(nil), job.Items...)
}

func (s *RuntimeStorageService) recentJobs(limit int) []model.RuntimeStorageCleanupJob {
	s.mu.RLock()
	defer s.mu.RUnlock()
	jobs := make([]model.RuntimeStorageCleanupJob, 0, len(s.jobs))
	for _, job := range s.jobs {
		jobs = append(jobs, cloneRuntimeStorageJob(*job))
	}
	sort.SliceStable(jobs, func(i, j int) bool {
		return jobs[i].CreatedAt.After(jobs[j].CreatedAt)
	})
	if len(jobs) > limit {
		jobs = jobs[:limit]
	}
	return jobs
}

func (s *RuntimeStorageService) loadCleanupPolicies(ctx context.Context) {
	store, ok := s.repo.(RuntimeStoragePolicyStore)
	if !ok {
		return
	}
	policies, err := store.ListRuntimeStorageCleanupPolicies(ctx)
	if err != nil {
		log.Printf("runtime storage: failed to load cleanup policies: %v", err)
		return
	}
	if len(policies) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, policy := range policies {
		action, err := normalizeCleanupAction(policy.Action)
		if err != nil {
			continue
		}
		policy.Action = action
		if policy.InactiveDays <= 0 {
			policy.InactiveDays = normalizeCleanupInactiveDays(0)
		}
		if !validCleanupSchedule(policy.Schedule) {
			policy.Schedule = "daily"
		}
		if !validCleanupRunAt(policy.RunAt) {
			policy.RunAt = "03:00"
		}
		if policy.Limit <= 0 || policy.Limit > defaultRuntimeStorageJobLimit {
			policy.Limit = defaultRuntimeStorageJobLimit
		}
		s.policies[action] = policy
	}
}

func (s *RuntimeStorageService) persistCleanupPolicy(
	ctx context.Context,
	policy model.RuntimeStorageCleanupPolicy,
) {
	store, ok := s.repo.(RuntimeStoragePolicyStore)
	if !ok {
		return
	}
	if err := store.UpsertRuntimeStorageCleanupPolicy(ctx, policy); err != nil {
		log.Printf("runtime storage: failed to persist cleanup policy %s: %v", policy.Action, err)
	}
}

func (s *RuntimeStorageService) runDueCleanupPolicies(ctx context.Context) {
	now := s.now().UTC()
	policies, err := s.CleanupPolicies(ctx)
	if err != nil {
		log.Printf("runtime storage: cleanup policy load failed: %v", err)
		return
	}
	for _, policy := range policies {
		nextRunAt := nextCleanupPolicyRun(policy, now)
		if !policy.Enabled || nextRunAt == nil || nextRunAt.After(now) {
			continue
		}
		s.runCleanupPolicy(ctx, policy)
	}
}

func (s *RuntimeStorageService) runCleanupPolicy(
	ctx context.Context,
	policy model.RuntimeStorageCleanupPolicy,
) {
	req := model.RuntimeStorageCleanupRequest{
		Action:       policy.Action,
		InactiveDays: policy.InactiveDays,
		Limit:        policy.Limit,
	}
	now := s.now().UTC()
	preview, err := s.PreviewCleanup(ctx, req)
	if err != nil {
		policy.LastRunAt = &now
		policy.LastError = err.Error()
		s.updateCleanupPolicyState(ctx, policy)
		return
	}
	policy.LastRunAt = &now
	policy.LastPreviewAt = &now
	policy.LastPreviewCandidates = int64(len(preview.Candidates))
	policy.LastPreviewBytes = preview.TotalBytesReclaimable
	policy.LastError = ""

	// Scheduled policies intentionally run previews first. Operators must switch
	// the policy out of dry-run before the scheduler creates destructive jobs.
	if policy.DryRun || len(preview.Candidates) == 0 {
		s.updateCleanupPolicyState(ctx, policy)
		return
	}
	job, err := s.CreateCleanupJob(ctx, "system", req)
	if err != nil {
		policy.LastError = err.Error()
	} else {
		policy.LastJobID = job.ID
	}
	s.updateCleanupPolicyState(ctx, policy)
}

func (s *RuntimeStorageService) updateCleanupPolicyState(
	ctx context.Context,
	policy model.RuntimeStorageCleanupPolicy,
) {
	updatedAt := s.now().UTC()
	policy.UpdatedAt = &updatedAt
	s.mu.Lock()
	s.policies[policy.Action] = policy
	s.mu.Unlock()
	s.persistCleanupPolicy(ctx, policy)
}

func normalizeCleanupAction(action string) (string, error) {
	if strings.TrimSpace(action) != model.RuntimeStorageActionFullThreadDelete {
		return "", fmt.Errorf("unsupported cleanup action")
	}
	return model.RuntimeStorageActionFullThreadDelete, nil
}

func normalizeCleanupInactiveDays(requested int) int {
	if requested > 0 {
		return requested
	}
	return defaultRuntimeStorageDeleteDays
}

func defaultRuntimeStorageCleanupPolicies() map[string]model.RuntimeStorageCleanupPolicy {
	policies := map[string]model.RuntimeStorageCleanupPolicy{}
	for _, action := range []string{model.RuntimeStorageActionFullThreadDelete} {
		policies[action] = model.RuntimeStorageCleanupPolicy{
			Action:       action,
			Enabled:      false,
			DryRun:       true,
			InactiveDays: normalizeCleanupInactiveDays(0),
			Schedule:     "daily",
			RunAt:        "03:00",
			Limit:        defaultRuntimeStorageJobLimit,
		}
	}
	return policies
}

func validCleanupSchedule(schedule string) bool {
	switch strings.TrimSpace(schedule) {
	case "hourly", "daily", "weekly":
		return true
	default:
		return false
	}
}

func validCleanupRunAt(value string) bool {
	_, err := time.Parse("15:04", strings.TrimSpace(value))
	return err == nil
}

func nextCleanupPolicyRun(
	policy model.RuntimeStorageCleanupPolicy,
	now time.Time,
) *time.Time {
	if !policy.Enabled {
		return nil
	}
	lastRunAt := policy.LastRunAt
	if lastRunAt == nil {
		runAt := scheduledTimeForDate(policy, now)
		if runAt.After(now) {
			return &runAt
		}
		return &now
	}

	var next time.Time
	switch policy.Schedule {
	case "hourly":
		next = lastRunAt.Add(time.Hour)
	case "weekly":
		next = lastRunAt.AddDate(0, 0, 7)
	default:
		next = lastRunAt.AddDate(0, 0, 1)
	}
	if next.Before(now) && policy.Schedule != "hourly" {
		today := scheduledTimeForDate(policy, now)
		if today.After(now) {
			next = today
		} else if policy.Schedule == "weekly" {
			next = today.AddDate(0, 0, 7)
		} else {
			next = today.AddDate(0, 0, 1)
		}
	}
	return &next
}

func scheduledTimeForDate(
	policy model.RuntimeStorageCleanupPolicy,
	date time.Time,
) time.Time {
	runAt, err := time.Parse("15:04", policy.RunAt)
	if err != nil {
		runAt, _ = time.Parse("15:04", "03:00")
	}
	return time.Date(
		date.Year(),
		date.Month(),
		date.Day(),
		runAt.Hour(),
		runAt.Minute(),
		0,
		0,
		time.UTC,
	)
}

func normalizeRuntimeStoragePage(limit int, offset int) (int, int) {
	if limit <= 0 {
		limit = 50
	}
	if limit > defaultRuntimeStorageJobLimit {
		limit = defaultRuntimeStorageJobLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func sliceRuntimeStorageUsers(
	items []model.RuntimeStorageUserUsage,
	limit int,
	offset int,
) []model.RuntimeStorageUserUsage {
	if offset >= len(items) {
		return []model.RuntimeStorageUserUsage{}
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return append([]model.RuntimeStorageUserUsage(nil), items[offset:end]...)
}

func sliceRuntimeStorageThreads(
	items []model.RuntimeStorageThreadUsage,
	limit int,
	offset int,
) []model.RuntimeStorageThreadUsage {
	if offset >= len(items) {
		return []model.RuntimeStorageThreadUsage{}
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return append([]model.RuntimeStorageThreadUsage(nil), items[offset:end]...)
}

func runtimeStorageUserMatches(user model.RuntimeStorageUserUsage, query string) bool {
	values := []string{
		user.UserID,
		runtimeStorageStringValue(user.UserName),
		runtimeStorageStringValue(user.UserEmail),
		user.LargestThreadID,
	}
	return strings.Contains(strings.ToLower(strings.Join(values, " ")), query)
}

func runtimeStorageUserMatchesFilters(
	user model.RuntimeStorageUserUsage,
	threads []model.RuntimeStorageThreadUsage,
	query string,
	inactiveDays int,
) bool {
	if query == "" && inactiveDays <= 0 {
		return true
	}
	userMatchesQuery := query == "" || runtimeStorageUserMatches(user, query)
	if inactiveDays <= 0 {
		if userMatchesQuery {
			return true
		}
		for _, thread := range threads {
			if runtimeStorageThreadMatches(thread, query) {
				return true
			}
		}
		return false
	}
	for _, thread := range threads {
		if thread.InactiveDays < inactiveDays {
			continue
		}
		if userMatchesQuery || query == "" || runtimeStorageThreadMatches(thread, query) {
			return true
		}
	}
	return false
}

func runtimeStorageThreadMatches(thread model.RuntimeStorageThreadUsage, query string) bool {
	values := []string{
		thread.ThreadID,
		thread.UserID,
		runtimeStorageStringValue(thread.UserName),
		runtimeStorageStringValue(thread.UserEmail),
		runtimeStorageStringValue(thread.AgentName),
		runtimeStorageStringValue(thread.ModelName),
		strings.Join(thread.CandidateReasons, " "),
		strings.Join(thread.ProtectionReasons, " "),
	}
	return strings.Contains(strings.ToLower(strings.Join(values, " ")), query)
}

func runtimeStorageStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func compareRuntimeStorageUsers(
	a model.RuntimeStorageUserUsage,
	b model.RuntimeStorageUserUsage,
	sortBy string,
) bool {
	switch strings.TrimSpace(sortBy) {
	case "filesystem_bytes":
		return a.FilesystemBytes > b.FilesystemBytes
	case "checkpoint_bytes":
		return a.CheckpointBytes > b.CheckpointBytes
	case "runtime_cache_bytes":
		return a.RuntimeCacheBytes > b.RuntimeCacheBytes
	case "last_used_at":
		return timePtrAfter(a.LastUsedAt, b.LastUsedAt, a.UserID, b.UserID)
	case "thread_count":
		return a.ThreadCount > b.ThreadCount
	default:
		return a.TotalBytes > b.TotalBytes
	}
}

func compareRuntimeStorageThreads(
	a model.RuntimeStorageThreadUsage,
	b model.RuntimeStorageThreadUsage,
	sortBy string,
) bool {
	switch strings.TrimSpace(sortBy) {
	case "filesystem_bytes":
		return a.FilesystemBytes > b.FilesystemBytes
	case "checkpoint_bytes":
		return a.CheckpointBytes > b.CheckpointBytes
	case "runtime_cache_bytes":
		return a.RuntimeCacheBytes > b.RuntimeCacheBytes
	case "last_used_at":
		return timePtrAfter(a.LastUsedAt, b.LastUsedAt, a.ThreadID, b.ThreadID)
	case "thread_count":
		return a.ThreadID < b.ThreadID
	default:
		return a.TotalBytes > b.TotalBytes
	}
}

func timePtrAfter(a *time.Time, b *time.Time, aID string, bID string) bool {
	if a == nil && b == nil {
		return aID < bID
	}
	if a == nil {
		return false
	}
	if b == nil {
		return true
	}
	if a.Equal(*b) {
		return aID < bID
	}
	return a.After(*b)
}

func buildUserUsage(
	threads []model.RuntimeStorageThreadUsage,
) ([]model.RuntimeStorageUserUsage, map[string]model.RuntimeStorageUserDetail) {
	byUser := map[string]*model.RuntimeStorageUserDetail{}
	for _, thread := range threads {
		if thread.UserID == "" {
			continue
		}
		detail, exists := byUser[thread.UserID]
		if !exists {
			detail = &model.RuntimeStorageUserDetail{
				User: model.RuntimeStorageUserUsage{
					UserID:    thread.UserID,
					UserName:  thread.UserName,
					UserEmail: thread.UserEmail,
				},
			}
			byUser[thread.UserID] = detail
		}
		detail.Threads = append(detail.Threads, thread)
		user := &detail.User
		user.ThreadCount++
		user.FilesystemBytes += thread.FilesystemBytes
		user.RuntimeCacheBytes += thread.RuntimeCacheBytes
		user.CheckpointBytes += thread.CheckpointBytes
		user.TotalBytes += thread.TotalBytes
		if thread.TotalBytes > user.LargestThreadBytes {
			user.LargestThreadBytes = thread.TotalBytes
			user.LargestThreadID = thread.ThreadID
		}
		if thread.LastUsedAt != nil && (user.LastUsedAt == nil || thread.LastUsedAt.After(*user.LastUsedAt)) {
			user.LastUsedAt = thread.LastUsedAt
		}
		if len(thread.CandidateReasons) > 0 {
			user.CleanupCandidateCount++
		}
	}

	details := make(map[string]model.RuntimeStorageUserDetail, len(byUser))
	users := make([]model.RuntimeStorageUserUsage, 0, len(byUser))
	for userID, detail := range byUser {
		sort.SliceStable(detail.Threads, func(i, j int) bool {
			return compareThreadUsage(detail.Threads[i], detail.Threads[j])
		})
		details[userID] = *detail
		users = append(users, detail.User)
	}
	sort.SliceStable(users, func(i, j int) bool {
		if users[i].TotalBytes == users[j].TotalBytes {
			return users[i].UserID < users[j].UserID
		}
		return users[i].TotalBytes > users[j].TotalBytes
	})
	return users, details
}

func compareThreadUsage(a model.RuntimeStorageThreadUsage, b model.RuntimeStorageThreadUsage) bool {
	if a.LastUsedAt == nil && b.LastUsedAt == nil {
		return a.ThreadID < b.ThreadID
	}
	if a.LastUsedAt == nil {
		return false
	}
	if b.LastUsedAt == nil {
		return true
	}
	if a.LastUsedAt.Equal(*b.LastUsedAt) {
		return a.ThreadID < b.ThreadID
	}
	return a.LastUsedAt.After(*b.LastUsedAt)
}

func inactiveDays(now time.Time, lastUsedAt *time.Time) int {
	if lastUsedAt == nil {
		return 0
	}
	if now.Before(*lastUsedAt) {
		return 0
	}
	return int(now.Sub(*lastUsedAt).Hours() / 24)
}

func directoryHasContent(usage model.RuntimeStorageDirectoryUsage) bool {
	return usage.Bytes > 0 || usage.FileCount > 0 || usage.DirCount > 0
}

type scanTimeBounds struct {
	oldest *time.Time
	latest *time.Time
}

func scanUsage(root string) (model.RuntimeStorageDirectoryUsage, scanTimeBounds, error) {
	var usage model.RuntimeStorageDirectoryUsage
	var bounds scanTimeBounds
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		modTime := info.ModTime().UTC()
		if bounds.oldest == nil || modTime.Before(*bounds.oldest) {
			value := modTime
			bounds.oldest = &value
		}
		if bounds.latest == nil || modTime.After(*bounds.latest) {
			value := modTime
			bounds.latest = &value
		}
		if entry.IsDir() {
			if path != root {
				usage.DirCount++
			}
			return nil
		}
		usage.FileCount++
		usage.Bytes += info.Size()
		return nil
	})
	return usage, bounds, err
}

type runtimeStorageFSStats struct {
	diskUsagePercent  *float64
	inodeUsagePercent *float64
}

func filesystemStats(root string) (runtimeStorageFSStats, bool) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(root, &stat); err != nil {
		return runtimeStorageFSStats{}, false
	}
	var result runtimeStorageFSStats
	totalBlocks := stat.Blocks
	if totalBlocks > 0 {
		usedBlocks := totalBlocks - stat.Bfree
		percent := float64(usedBlocks) / float64(totalBlocks) * 100
		result.diskUsagePercent = &percent
	}
	totalFiles := stat.Files
	if totalFiles > 0 {
		usedFiles := totalFiles - stat.Ffree
		percent := float64(usedFiles) / float64(totalFiles) * 100
		result.inodeUsagePercent = &percent
	}
	return result, true
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func cloneRuntimeStorageJob(job model.RuntimeStorageCleanupJob) model.RuntimeStorageCleanupJob {
	job.Preview.Candidates = append([]model.RuntimeStorageCleanupCandidate(nil), job.Preview.Candidates...)
	job.Preview.Refused = append([]model.RuntimeStorageCleanupCandidate(nil), job.Preview.Refused...)
	job.Items = append([]model.RuntimeStorageCleanupJobItem(nil), job.Items...)
	job.Request.ThreadIDs = append([]string(nil), job.Request.ThreadIDs...)
	return job
}
