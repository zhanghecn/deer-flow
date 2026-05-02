package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openagents/gateway/internal/model"
)

type RuntimeStorageRepo struct {
	pool *pgxpool.Pool
}

func NewRuntimeStorageRepo(pool *pgxpool.Pool) *RuntimeStorageRepo {
	return &RuntimeStorageRepo{pool: pool}
}

type RuntimeThreadProtection struct {
	HasRunningTrace bool
	HasInterrupt    bool
}

func (r *RuntimeStorageRepo) ListThreadBindings(ctx context.Context) ([]model.RuntimeStorageThreadBinding, error) {
	const query = `
		SELECT
			tb.thread_id,
			tb.user_id,
			u.name,
			u.email,
			tb.agent_name,
			tb.model_name,
			tb.assistant_id,
			tb.created_at,
			tb.updated_at
		FROM thread_bindings tb
		LEFT JOIN users u ON u.id = tb.user_id
		ORDER BY tb.updated_at DESC, tb.thread_id DESC
	`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.RuntimeStorageThreadBinding, 0)
	for rows.Next() {
		var item model.RuntimeStorageThreadBinding
		var userID uuid.UUID
		if err := rows.Scan(
			&item.ThreadID,
			&userID,
			&item.UserName,
			&item.UserEmail,
			&item.AgentName,
			&item.ModelName,
			&item.AssistantID,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		item.UserID = userID.String()
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *RuntimeStorageRepo) ListRuntimeStorageCleanupPolicies(
	ctx context.Context,
) ([]model.RuntimeStorageCleanupPolicy, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			action,
			enabled,
			dry_run,
			inactive_days,
			schedule,
			run_at,
			limit_count,
			last_run_at,
			COALESCE(last_job_id::text, ''),
			last_preview_at,
			last_preview_candidates,
			last_preview_bytes,
			COALESCE(last_error, ''),
			updated_at
		FROM admin_runtime_cleanup_policies
		ORDER BY action
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	policies := []model.RuntimeStorageCleanupPolicy{}
	for rows.Next() {
		var policy model.RuntimeStorageCleanupPolicy
		if err := rows.Scan(
			&policy.Action,
			&policy.Enabled,
			&policy.DryRun,
			&policy.InactiveDays,
			&policy.Schedule,
			&policy.RunAt,
			&policy.Limit,
			&policy.LastRunAt,
			&policy.LastJobID,
			&policy.LastPreviewAt,
			&policy.LastPreviewCandidates,
			&policy.LastPreviewBytes,
			&policy.LastError,
			&policy.UpdatedAt,
		); err != nil {
			return nil, err
		}
		policies = append(policies, policy)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return policies, nil
}

func (r *RuntimeStorageRepo) UpsertRuntimeStorageCleanupPolicy(
	ctx context.Context,
	policy model.RuntimeStorageCleanupPolicy,
) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO admin_runtime_cleanup_policies (
			action,
			enabled,
			dry_run,
			inactive_days,
			schedule,
			run_at,
			limit_count,
			last_run_at,
			last_job_id,
			last_preview_at,
			last_preview_candidates,
			last_preview_bytes,
			last_error,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::uuid, $10, $11, $12, NULLIF($13, ''), NOW())
		ON CONFLICT (action) DO UPDATE
		SET
			enabled = EXCLUDED.enabled,
			dry_run = EXCLUDED.dry_run,
			inactive_days = EXCLUDED.inactive_days,
			schedule = EXCLUDED.schedule,
			run_at = EXCLUDED.run_at,
			limit_count = EXCLUDED.limit_count,
			last_run_at = EXCLUDED.last_run_at,
			last_job_id = EXCLUDED.last_job_id,
			last_preview_at = EXCLUDED.last_preview_at,
			last_preview_candidates = EXCLUDED.last_preview_candidates,
			last_preview_bytes = EXCLUDED.last_preview_bytes,
			last_error = EXCLUDED.last_error,
			updated_at = NOW()
	`, policy.Action, policy.Enabled, policy.DryRun, policy.InactiveDays, policy.Schedule, policy.RunAt, policy.Limit, policy.LastRunAt, policy.LastJobID, policy.LastPreviewAt, policy.LastPreviewCandidates, policy.LastPreviewBytes, policy.LastError)
	return err
}

func (r *RuntimeStorageRepo) GetCheckpointSummary(ctx context.Context) (model.RuntimeStorageCheckpointSummary, error) {
	summary := model.RuntimeStorageCheckpointSummary{Tables: []model.RuntimeStorageTableSummary{}}
	for _, tableName := range []string{"checkpoints", "checkpoint_writes", "checkpoint_blobs"} {
		exists, err := r.tableExists(ctx, tableName)
		if err != nil {
			return summary, err
		}
		if !exists {
			continue
		}
		table, err := r.checkpointTableSummary(ctx, tableName)
		if err != nil {
			return summary, err
		}
		summary.Enabled = true
		summary.Rows += table.Rows
		summary.Bytes += table.Bytes
		summary.Tables = append(summary.Tables, table)
	}
	return summary, nil
}

func (r *RuntimeStorageRepo) ListCheckpointThreadIDs(ctx context.Context) ([]string, error) {
	queryParts := make([]string, 0, 3)
	for _, tableName := range []string{"checkpoints", "checkpoint_writes", "checkpoint_blobs"} {
		exists, err := r.tableExists(ctx, tableName)
		if err != nil {
			return nil, err
		}
		if exists {
			queryParts = append(queryParts, fmt.Sprintf("SELECT thread_id FROM %s", tableName))
		}
	}
	if len(queryParts) == 0 {
		return nil, nil
	}

	rows, err := r.pool.Query(
		ctx,
		fmt.Sprintf(
			`SELECT DISTINCT thread_id
			 FROM (%s) checkpoint_threads
			 WHERE thread_id IS NOT NULL AND BTRIM(thread_id) <> ''
			 ORDER BY thread_id`,
			strings.Join(queryParts, " UNION "),
		),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	threadIDs := make([]string, 0)
	for rows.Next() {
		var threadID string
		if err := rows.Scan(&threadID); err != nil {
			return nil, err
		}
		threadIDs = append(threadIDs, threadID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return threadIDs, nil
}

func (r *RuntimeStorageRepo) ListCheckpointUsage(
	ctx context.Context,
	threadIDs []string,
) (map[string]model.RuntimeStorageCheckpointUsage, error) {
	usage := make(map[string]model.RuntimeStorageCheckpointUsage, len(threadIDs))
	cleanThreadIDs := normalizeRuntimeStorageThreadIDs(threadIDs)
	for _, threadID := range cleanThreadIDs {
		usage[threadID] = model.RuntimeStorageCheckpointUsage{ThreadID: threadID}
	}
	if len(cleanThreadIDs) == 0 {
		return usage, nil
	}

	type tableTarget struct {
		name  string
		apply func(*model.RuntimeStorageCheckpointUsage, model.RuntimeStorageCheckpointTableUsage)
	}
	targets := []tableTarget{
		{
			name: "checkpoints",
			apply: func(item *model.RuntimeStorageCheckpointUsage, table model.RuntimeStorageCheckpointTableUsage) {
				item.Checkpoints = table
			},
		},
		{
			name: "checkpoint_writes",
			apply: func(item *model.RuntimeStorageCheckpointUsage, table model.RuntimeStorageCheckpointTableUsage) {
				item.CheckpointWrites = table
			},
		},
		{
			name: "checkpoint_blobs",
			apply: func(item *model.RuntimeStorageCheckpointUsage, table model.RuntimeStorageCheckpointTableUsage) {
				item.CheckpointBlobs = table
			},
		},
	}

	for _, target := range targets {
		exists, err := r.tableExists(ctx, target.name)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		rows, err := r.pool.Query(
			ctx,
			fmt.Sprintf(
				`SELECT thread_id, COUNT(*)::bigint, COALESCE(SUM(pg_column_size(%[1]s.*)), 0)::bigint
				 FROM %[1]s
				 WHERE thread_id = ANY($1)
				 GROUP BY thread_id`,
				target.name,
			),
			cleanThreadIDs,
		)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var threadID string
			var tableUsage model.RuntimeStorageCheckpointTableUsage
			if err := rows.Scan(&threadID, &tableUsage.Rows, &tableUsage.Bytes); err != nil {
				rows.Close()
				return nil, err
			}
			item := usage[threadID]
			if item.ThreadID == "" {
				item.ThreadID = threadID
			}
			target.apply(&item, tableUsage)
			usage[threadID] = item
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	return usage, nil
}

func (r *RuntimeStorageRepo) DeleteCheckpointRows(ctx context.Context, threadIDs []string) (int64, error) {
	cleanThreadIDs := normalizeRuntimeStorageThreadIDs(threadIDs)
	if len(cleanThreadIDs) == 0 {
		return 0, nil
	}

	var deleted int64
	// Delete all checkpoint-owned rows for the thread_id. This is intentionally
	// in Gateway because LangGraph's thread metadata DELETE does not guarantee
	// checkpoint table cleanup for every runtime/server version.
	for _, tableName := range []string{"checkpoint_writes", "checkpoints", "checkpoint_blobs"} {
		exists, err := r.tableExists(ctx, tableName)
		if err != nil {
			return deleted, err
		}
		if !exists {
			continue
		}
		tag, err := r.pool.Exec(
			ctx,
			fmt.Sprintf(`DELETE FROM %s WHERE thread_id = ANY($1)`, tableName),
			cleanThreadIDs,
		)
		if err != nil {
			return deleted, err
		}
		deleted += tag.RowsAffected()
	}
	return deleted, nil
}

func (r *RuntimeStorageRepo) ListThreadProtection(
	ctx context.Context,
	threadIDs []string,
) (map[string]RuntimeThreadProtection, error) {
	result := make(map[string]RuntimeThreadProtection, len(threadIDs))
	cleanThreadIDs := normalizeRuntimeStorageThreadIDs(threadIDs)
	for _, threadID := range cleanThreadIDs {
		result[threadID] = RuntimeThreadProtection{}
	}
	if len(cleanThreadIDs) == 0 {
		return result, nil
	}

	rows, err := r.pool.Query(ctx, `
		SELECT thread_id, COUNT(*) > 0 AS has_running_trace
		FROM agent_traces
		WHERE thread_id = ANY($1)
		  AND status = 'running'
		GROUP BY thread_id
	`, cleanThreadIDs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var threadID string
		var hasRunningTrace bool
		if err := rows.Scan(&threadID, &hasRunningTrace); err != nil {
			rows.Close()
			return nil, err
		}
		item := result[threadID]
		item.HasRunningTrace = hasRunningTrace
		result[threadID] = item
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	checkpointsExist, err := r.tableExists(ctx, "checkpoints")
	if err != nil || !checkpointsExist {
		return result, err
	}
	// Interrupt payloads are runtime-owned checkpoint state. Gateway only uses
	// this coarse existence check as a destructive-delete guard; mutation still
	// stays delegated to LangGraph.
	rows, err = r.pool.Query(ctx, `
		SELECT thread_id, COUNT(*) > 0 AS has_interrupt
		FROM checkpoints
		WHERE thread_id = ANY($1)
		  AND checkpoint::text LIKE '%__interrupt__%'
		GROUP BY thread_id
	`, cleanThreadIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var threadID string
		var hasInterrupt bool
		if err := rows.Scan(&threadID, &hasInterrupt); err != nil {
			return nil, err
		}
		item := result[threadID]
		item.HasInterrupt = hasInterrupt
		result[threadID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *RuntimeStorageRepo) tableExists(ctx context.Context, tableName string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public'
			  AND table_name = $1
		)
	`, tableName).Scan(&exists)
	return exists, err
}

func (r *RuntimeStorageRepo) checkpointTableSummary(
	ctx context.Context,
	tableName string,
) (model.RuntimeStorageTableSummary, error) {
	item := model.RuntimeStorageTableSummary{Name: tableName}
	query := fmt.Sprintf(
		`SELECT COUNT(*)::bigint, pg_total_relation_size('public.%s'::regclass)::bigint FROM %s`,
		tableName,
		tableName,
	)
	if err := r.pool.QueryRow(ctx, query).Scan(&item.Rows, &item.Bytes); err != nil {
		return item, err
	}
	return item, nil
}

func normalizeRuntimeStorageThreadIDs(values []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		text := strings.TrimSpace(value)
		if text == "" {
			continue
		}
		if _, exists := seen[text]; exists {
			continue
		}
		seen[text] = struct{}{}
		normalized = append(normalized, text)
	}
	return normalized
}

func emptyStringToNil(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}
