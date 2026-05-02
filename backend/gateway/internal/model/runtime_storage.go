package model

import "time"

const (
	RuntimeStorageActionFullThreadDelete = "full_thread_delete"

	RuntimeStorageJobPending   = "pending"
	RuntimeStorageJobRunning   = "running"
	RuntimeStorageJobCompleted = "completed"
	RuntimeStorageJobFailed    = "failed"
	RuntimeStorageJobPartial   = "partial"
)

type RuntimeStorageDirectoryUsage struct {
	Bytes     int64 `json:"bytes"`
	FileCount int64 `json:"file_count"`
	DirCount  int64 `json:"dir_count"`
}

type RuntimeStorageDirectoryBreakdown struct {
	ThreadRoot     RuntimeStorageDirectoryUsage `json:"thread_root"`
	Workspace      RuntimeStorageDirectoryUsage `json:"workspace"`
	Uploads        RuntimeStorageDirectoryUsage `json:"uploads"`
	Outputs        RuntimeStorageDirectoryUsage `json:"outputs"`
	Authoring      RuntimeStorageDirectoryUsage `json:"authoring"`
	RuntimeAgents  RuntimeStorageDirectoryUsage `json:"runtime_agents"`
	OtherUserData  RuntimeStorageDirectoryUsage `json:"other_user_data"`
	MissingOnDisk  bool                         `json:"missing_on_disk"`
	OrphanOnDisk   bool                         `json:"orphan_on_disk"`
	OldestModified *time.Time                   `json:"oldest_modified,omitempty"`
	LatestModified *time.Time                   `json:"latest_modified,omitempty"`
}

type RuntimeStorageCheckpointTableUsage struct {
	Rows  int64 `json:"rows"`
	Bytes int64 `json:"bytes"`
}

type RuntimeStorageCheckpointUsage struct {
	ThreadID         string                             `json:"thread_id"`
	Checkpoints      RuntimeStorageCheckpointTableUsage `json:"checkpoints"`
	CheckpointWrites RuntimeStorageCheckpointTableUsage `json:"checkpoint_writes"`
	CheckpointBlobs  RuntimeStorageCheckpointTableUsage `json:"checkpoint_blobs"`
}

func (u RuntimeStorageCheckpointUsage) TotalRows() int64 {
	return u.Checkpoints.Rows + u.CheckpointWrites.Rows + u.CheckpointBlobs.Rows
}

func (u RuntimeStorageCheckpointUsage) TotalBytes() int64 {
	return u.Checkpoints.Bytes + u.CheckpointWrites.Bytes + u.CheckpointBlobs.Bytes
}

type RuntimeStorageThreadBinding struct {
	ThreadID    string     `json:"thread_id"`
	UserID      string     `json:"user_id,omitempty"`
	UserName    *string    `json:"user_name,omitempty"`
	UserEmail   *string    `json:"user_email,omitempty"`
	AgentName   *string    `json:"agent_name,omitempty"`
	ModelName   *string    `json:"model_name,omitempty"`
	AssistantID *string    `json:"assistant_id,omitempty"`
	CreatedAt   *time.Time `json:"created_at,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type RuntimeStorageThreadUsage struct {
	RuntimeStorageThreadBinding
	LastUsedAt         *time.Time                       `json:"last_used_at,omitempty"`
	InactiveDays       int                              `json:"inactive_days"`
	Directories        RuntimeStorageDirectoryBreakdown `json:"directories"`
	Checkpoint         RuntimeStorageCheckpointUsage    `json:"checkpoint"`
	FilesystemBytes    int64                            `json:"filesystem_bytes"`
	RuntimeCacheBytes  int64                            `json:"runtime_cache_bytes"`
	CheckpointBytes    int64                            `json:"checkpoint_bytes"`
	TotalBytes         int64                            `json:"total_bytes"`
	FileCount          int64                            `json:"file_count"`
	DirCount           int64                            `json:"dir_count"`
	CandidateReasons   []string                         `json:"candidate_reasons"`
	ProtectionReasons  []string                         `json:"protection_reasons"`
	OrphanFSCandidate  bool                             `json:"orphan_fs_candidate"`
	FullDeleteEligible bool                             `json:"full_delete_eligible"`
}

type RuntimeStorageUserUsage struct {
	UserID                string     `json:"user_id"`
	UserName              *string    `json:"user_name,omitempty"`
	UserEmail             *string    `json:"user_email,omitempty"`
	ThreadCount           int64      `json:"thread_count"`
	FilesystemBytes       int64      `json:"filesystem_bytes"`
	RuntimeCacheBytes     int64      `json:"runtime_cache_bytes"`
	CheckpointBytes       int64      `json:"checkpoint_bytes"`
	TotalBytes            int64      `json:"total_bytes"`
	LargestThreadID       string     `json:"largest_thread_id,omitempty"`
	LargestThreadBytes    int64      `json:"largest_thread_bytes"`
	LastUsedAt            *time.Time `json:"last_used_at,omitempty"`
	CleanupCandidateCount int64      `json:"cleanup_candidate_count"`
}

type RuntimeStorageTableSummary struct {
	Name  string `json:"name"`
	Rows  int64  `json:"rows"`
	Bytes int64  `json:"bytes"`
}

type RuntimeStorageFilesystemSummary struct {
	BaseDirBytes      int64    `json:"base_dir_bytes"`
	ThreadBytes       int64    `json:"thread_bytes"`
	RuntimeCacheBytes int64    `json:"runtime_cache_bytes"`
	FileCount         int64    `json:"file_count"`
	DirCount          int64    `json:"dir_count"`
	InodeUsagePercent *float64 `json:"inode_usage_percent,omitempty"`
	DiskUsagePercent  *float64 `json:"disk_usage_percent,omitempty"`
}

type RuntimeStorageCheckpointSummary struct {
	Enabled bool                         `json:"enabled"`
	Tables  []RuntimeStorageTableSummary `json:"tables"`
	Rows    int64                        `json:"rows"`
	Bytes   int64                        `json:"bytes"`
}

type RuntimeStorageScanStatus struct {
	Status        string     `json:"status"`
	LastStartedAt *time.Time `json:"last_started_at,omitempty"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	Error         string     `json:"error,omitempty"`
}

type RuntimeStorageSummary struct {
	Scan              RuntimeStorageScanStatus        `json:"scan"`
	ThreadCount       int64                           `json:"thread_count"`
	UserCount         int64                           `json:"user_count"`
	OrphanThreadCount int64                           `json:"orphan_thread_count"`
	CandidateCounts   map[string]int64                `json:"candidate_counts"`
	Filesystem        RuntimeStorageFilesystemSummary `json:"filesystem"`
	Checkpoint        RuntimeStorageCheckpointSummary `json:"checkpoint"`
	TopUsers          []RuntimeStorageUserUsage       `json:"top_users"`
	TopThreads        []RuntimeStorageThreadUsage     `json:"top_threads"`
	RecentJobs        []RuntimeStorageCleanupJob      `json:"recent_jobs"`
}

type RuntimeStorageUserDetail struct {
	User    RuntimeStorageUserUsage     `json:"user"`
	Threads []RuntimeStorageThreadUsage `json:"threads"`
}

type RuntimeStorageListOptions struct {
	Limit        int
	Offset       int
	SortBy       string
	Query        string
	UserID       string
	InactiveDays int
}

type RuntimeStorageUserPage struct {
	Items  []RuntimeStorageUserUsage `json:"items"`
	Limit  int                       `json:"limit"`
	Offset int                       `json:"offset"`
	Total  int                       `json:"total"`
}

type RuntimeStorageThreadPage struct {
	Items  []RuntimeStorageThreadUsage `json:"items"`
	Limit  int                         `json:"limit"`
	Offset int                         `json:"offset"`
	Total  int                         `json:"total"`
}

type RuntimeStorageCleanupRequest struct {
	Action       string   `json:"action"`
	ThreadIDs    []string `json:"thread_ids"`
	UserID       string   `json:"user_id"`
	InactiveDays int      `json:"inactive_days"`
	Limit        int      `json:"limit"`
}

type RuntimeStorageCleanupPolicy struct {
	Action                string     `json:"action"`
	Enabled               bool       `json:"enabled"`
	DryRun                bool       `json:"dry_run"`
	InactiveDays          int        `json:"inactive_days"`
	Schedule              string     `json:"schedule"`
	RunAt                 string     `json:"run_at"`
	Limit                 int        `json:"limit"`
	NextRunAt             *time.Time `json:"next_run_at,omitempty"`
	LastRunAt             *time.Time `json:"last_run_at,omitempty"`
	LastJobID             string     `json:"last_job_id,omitempty"`
	LastPreviewAt         *time.Time `json:"last_preview_at,omitempty"`
	LastPreviewCandidates int64      `json:"last_preview_candidates"`
	LastPreviewBytes      int64      `json:"last_preview_bytes"`
	LastError             string     `json:"last_error,omitempty"`
	UpdatedAt             *time.Time `json:"updated_at,omitempty"`
}

type RuntimeStorageCleanupPolicyUpdate struct {
	Enabled      *bool   `json:"enabled"`
	DryRun       *bool   `json:"dry_run"`
	InactiveDays *int    `json:"inactive_days"`
	Schedule     *string `json:"schedule"`
	RunAt        *string `json:"run_at"`
	Limit        *int    `json:"limit"`
}

type RuntimeStorageCleanupCandidate struct {
	ThreadID          string   `json:"thread_id"`
	UserID            string   `json:"user_id,omitempty"`
	Action            string   `json:"action"`
	Reason            string   `json:"reason"`
	BytesReclaimable  int64    `json:"bytes_reclaimable"`
	CheckpointRows    int64    `json:"checkpoint_rows"`
	ProtectionReasons []string `json:"protection_reasons,omitempty"`
	Eligible          bool     `json:"eligible"`
}

type RuntimeStorageCleanupPreview struct {
	Action                string                           `json:"action"`
	Candidates            []RuntimeStorageCleanupCandidate `json:"candidates"`
	Refused               []RuntimeStorageCleanupCandidate `json:"refused"`
	TotalBytesReclaimable int64                            `json:"total_bytes_reclaimable"`
	TotalCheckpointRows   int64                            `json:"total_checkpoint_rows"`
	GeneratedAt           time.Time                        `json:"generated_at"`
}

type RuntimeStorageCleanupJobItem struct {
	ThreadID              string     `json:"thread_id"`
	UserID                string     `json:"user_id,omitempty"`
	Action                string     `json:"action"`
	Status                string     `json:"status"`
	BytesPlanned          int64      `json:"bytes_planned"`
	BytesFreed            int64      `json:"bytes_freed"`
	CheckpointRowsPlanned int64      `json:"checkpoint_rows_planned"`
	CheckpointRowsDeleted int64      `json:"checkpoint_rows_deleted"`
	Error                 string     `json:"error,omitempty"`
	FinishedAt            *time.Time `json:"finished_at,omitempty"`
}

type RuntimeStorageCleanupJob struct {
	ID          string                         `json:"job_id"`
	AdminUserID string                         `json:"admin_user_id,omitempty"`
	Action      string                         `json:"action"`
	Status      string                         `json:"status"`
	Request     RuntimeStorageCleanupRequest   `json:"request"`
	Preview     RuntimeStorageCleanupPreview   `json:"preview"`
	Items       []RuntimeStorageCleanupJobItem `json:"items"`
	Error       string                         `json:"error,omitempty"`
	CreatedAt   time.Time                      `json:"created_at"`
	StartedAt   *time.Time                     `json:"started_at,omitempty"`
	FinishedAt  *time.Time                     `json:"finished_at,omitempty"`
}
