package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type KnowledgeBuildJobRecord struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	Stage           *string    `json:"stage,omitempty"`
	Message         *string    `json:"message,omitempty"`
	ProgressPercent int        `json:"progress_percent"`
	TotalSteps      int        `json:"total_steps"`
	CompletedSteps  int        `json:"completed_steps"`
	ModelName       *string    `json:"model_name,omitempty"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	FinishedAt      *time.Time `json:"finished_at,omitempty"`
	CreatedAt       *time.Time `json:"created_at,omitempty"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}

type KnowledgeBuildEventRecord struct {
	ID           int64          `json:"id"`
	JobID        string         `json:"job_id"`
	DocumentID   string         `json:"document_id"`
	Stage        string         `json:"stage"`
	StepName     string         `json:"step_name"`
	Status       string         `json:"status"`
	Message      *string        `json:"message,omitempty"`
	ElapsedMS    *int           `json:"elapsed_ms,omitempty"`
	RetryCount   *int           `json:"retry_count,omitempty"`
	InputTokens  *int           `json:"input_tokens,omitempty"`
	OutputTokens *int           `json:"output_tokens,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	CreatedAt    *time.Time     `json:"created_at,omitempty"`
}

type KnowledgeDocumentRecord struct {
	ID                   string                   `json:"id"`
	DisplayName          string                   `json:"display_name"`
	FileKind             string                   `json:"file_kind"`
	LocatorType          string                   `json:"locator_type"`
	Status               string                   `json:"status"`
	DocDescription       *string                  `json:"doc_description,omitempty"`
	BuildQuality         string                   `json:"build_quality"`
	QualityMetadata      map[string]any           `json:"quality_metadata,omitempty"`
	Error                *string                  `json:"error,omitempty"`
	PageCount            *int                     `json:"page_count,omitempty"`
	NodeCount            int                      `json:"node_count"`
	SourceStoragePath    *string                  `json:"source_storage_path,omitempty"`
	MarkdownStoragePath  *string                  `json:"markdown_storage_path,omitempty"`
	PreviewStoragePath   *string                  `json:"preview_storage_path,omitempty"`
	CanonicalStoragePath *string                  `json:"canonical_storage_path,omitempty"`
	CreatedAt            *time.Time               `json:"created_at,omitempty"`
	UpdatedAt            *time.Time               `json:"updated_at,omitempty"`
	LatestBuildJob       *KnowledgeBuildJobRecord `json:"latest_build_job,omitempty"`
}

type KnowledgeDocumentFileRecord struct {
	DisplayName          string  `json:"display_name"`
	FileKind             string  `json:"file_kind"`
	SourceStoragePath    *string `json:"source_storage_path,omitempty"`
	MarkdownStoragePath  *string `json:"markdown_storage_path,omitempty"`
	PreviewStoragePath   *string `json:"preview_storage_path,omitempty"`
	CanonicalStoragePath *string `json:"canonical_storage_path,omitempty"`
}

type KnowledgeBaseRecord struct {
	ID               string                    `json:"id"`
	OwnerID          string                    `json:"owner_id"`
	OwnerName        string                    `json:"owner_name"`
	Name             string                    `json:"name"`
	Description      *string                   `json:"description,omitempty"`
	SourceType       string                    `json:"source_type"`
	CommandName      *string                   `json:"command_name,omitempty"`
	Visibility       string                    `json:"visibility"`
	PreviewEnabled   bool                      `json:"preview_enabled"`
	AttachedToThread bool                      `json:"attached_to_thread"`
	CreatedAt        *time.Time                `json:"created_at,omitempty"`
	UpdatedAt        *time.Time                `json:"updated_at,omitempty"`
	Documents        []KnowledgeDocumentRecord `json:"documents"`
}

type KnowledgeBaseDeleteRecord struct {
	ID      string `json:"id"`
	OwnerID string `json:"owner_id"`
	Name    string `json:"name"`
}

type KnowledgeDocumentDebugRecord struct {
	Document          KnowledgeDocumentRecord `json:"document"`
	KnowledgeBaseID   string                  `json:"knowledge_base_id"`
	KnowledgeBase     string                  `json:"knowledge_base"`
	OwnerID           string                  `json:"owner_id"`
	OwnerName         string                  `json:"owner_name"`
	Visibility        string                  `json:"visibility"`
	PreviewEnabled    bool                    `json:"preview_enabled"`
	DocumentTree      json.RawMessage         `json:"document_tree"`
	CanonicalMarkdown *string                 `json:"canonical_markdown,omitempty"`
	SourceMapJSON     json.RawMessage         `json:"source_map_json,omitempty"`
	DocumentIndexJSON json.RawMessage         `json:"document_index_json,omitempty"`
}

type KnowledgeRepo struct {
	pool *pgxpool.Pool
}

func NewKnowledgeRepo(pool *pgxpool.Pool) *KnowledgeRepo {
	return &KnowledgeRepo{pool: pool}
}

func (r *KnowledgeRepo) ListByThread(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) ([]KnowledgeBaseRecord, error) {
	query := `
		SELECT
			b.id::text,
			b.user_id::text,
			u.name,
			b.name,
			b.description,
			b.source_type,
			b.command_name,
			b.visibility,
			b.preview_enabled,
			b.created_at,
			b.updated_at,
			TRUE AS attached_to_thread,
			d.id::text,
			d.display_name,
			d.file_kind,
			d.locator_type,
			d.status,
			d.doc_description,
			d.build_quality,
			d.quality_metadata,
			d.error,
			d.page_count,
			d.node_count,
			d.source_storage_path,
			d.markdown_storage_path,
			d.preview_storage_path,
			d.canonical_storage_path,
			d.created_at,
			d.updated_at,
			j.id::text,
			j.status,
			j.stage,
			j.message,
			j.progress_percent,
			j.total_steps,
			j.completed_steps,
			j.model_name,
			j.started_at,
			j.finished_at,
			j.created_at,
			j.updated_at
		FROM knowledge_thread_bindings t
		JOIN knowledge_bases b ON b.id = t.knowledge_base_id
		JOIN users u ON u.id = b.user_id
		LEFT JOIN knowledge_documents d ON d.knowledge_base_id = b.id
		LEFT JOIN LATERAL (
			SELECT *
			FROM knowledge_build_jobs j
			WHERE j.document_id = d.id
			ORDER BY j.created_at DESC
			LIMIT 1
		) j ON TRUE
		WHERE t.user_id = $1
		  AND t.thread_id = $2
		ORDER BY u.name ASC, b.created_at DESC, d.created_at ASC, d.display_name ASC
	`
	rows, err := r.pool.Query(ctx, query, userID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanKnowledgeBaseRows(rows)
}

func (r *KnowledgeRepo) ListVisible(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) ([]KnowledgeBaseRecord, error) {
	query := `
		SELECT
			b.id::text,
			b.user_id::text,
			u.name,
			b.name,
			b.description,
			b.source_type,
			b.command_name,
			b.visibility,
			b.preview_enabled,
			b.created_at,
			b.updated_at,
			COALESCE(tb.thread_id IS NOT NULL, FALSE) AS attached_to_thread,
			d.id::text,
			d.display_name,
			d.file_kind,
			d.locator_type,
			d.status,
			d.doc_description,
			d.build_quality,
			d.quality_metadata,
			d.error,
			d.page_count,
			d.node_count,
			d.source_storage_path,
			d.markdown_storage_path,
			d.preview_storage_path,
			d.canonical_storage_path,
			d.created_at,
			d.updated_at,
			j.id::text,
			j.status,
			j.stage,
			j.message,
			j.progress_percent,
			j.total_steps,
			j.completed_steps,
			j.model_name,
			j.started_at,
			j.finished_at,
			j.created_at,
			j.updated_at
		FROM knowledge_bases b
		JOIN users u ON u.id = b.user_id
		LEFT JOIN knowledge_documents d ON d.knowledge_base_id = b.id
		LEFT JOIN LATERAL (
			SELECT *
			FROM knowledge_build_jobs j
			WHERE j.document_id = d.id
			ORDER BY j.created_at DESC
			LIMIT 1
		) j ON TRUE
		LEFT JOIN knowledge_thread_bindings tb
			ON tb.knowledge_base_id = b.id
		   AND tb.user_id = $1
		   AND ($2 <> '' AND tb.thread_id = $2)
		WHERE b.user_id = $1
		   OR b.visibility = 'shared'
		ORDER BY u.name ASC, b.created_at DESC, d.created_at ASC, d.display_name ASC
	`
	rows, err := r.pool.Query(ctx, query, userID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanKnowledgeBaseRows(rows)
}

func (r *KnowledgeRepo) AttachBaseToThread(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	knowledgeBaseID string,
) error {
	tag, err := r.pool.Exec(
		ctx,
		`
			INSERT INTO knowledge_thread_bindings (thread_id, knowledge_base_id, user_id)
			SELECT $2, b.id, $1
			FROM knowledge_bases b
			WHERE b.id = $3::uuid
			  AND (b.user_id = $1 OR b.visibility = 'shared')
			ON CONFLICT (thread_id, knowledge_base_id) DO NOTHING
		`,
		userID,
		threadID,
		knowledgeBaseID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	var exists bool
	if err := r.pool.QueryRow(
		ctx,
		`
			SELECT EXISTS (
				SELECT 1
				FROM knowledge_thread_bindings
				WHERE thread_id = $2
				  AND knowledge_base_id = $3::uuid
				  AND user_id = $1
			)
		`,
		userID,
		threadID,
		knowledgeBaseID,
	).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	return pgx.ErrNoRows
}

func (r *KnowledgeRepo) DetachBaseFromThread(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	knowledgeBaseID string,
) error {
	_, err := r.pool.Exec(
		ctx,
		`
			DELETE FROM knowledge_thread_bindings
			WHERE user_id = $1
			  AND thread_id = $2
			  AND knowledge_base_id = $3::uuid
		`,
		userID,
		threadID,
		knowledgeBaseID,
	)
	return err
}

func (r *KnowledgeRepo) UpdateBasePreviewEnabled(
	ctx context.Context,
	userID uuid.UUID,
	knowledgeBaseID string,
	previewEnabled bool,
) error {
	tag, err := r.pool.Exec(
		ctx,
		`
			UPDATE knowledge_bases
			SET preview_enabled = $3,
			    updated_at = NOW()
			WHERE id = $2::uuid
			  AND user_id = $1
		`,
		userID,
		knowledgeBaseID,
		previewEnabled,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *KnowledgeRepo) DeleteBase(
	ctx context.Context,
	actorUserID uuid.UUID,
	isAdmin bool,
	knowledgeBaseID string,
) (*KnowledgeBaseDeleteRecord, error) {
	query := `
		DELETE FROM knowledge_bases
		WHERE id = $2::uuid
		  AND ($1::boolean OR user_id = $3)
		RETURNING id::text, user_id::text, name
	`
	var record KnowledgeBaseDeleteRecord
	if err := r.pool.QueryRow(
		ctx,
		query,
		isAdmin,
		knowledgeBaseID,
		actorUserID,
	).Scan(&record.ID, &record.OwnerID, &record.Name); err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *KnowledgeRepo) DeleteBasesByOwner(
	ctx context.Context,
	ownerUserID uuid.UUID,
) ([]KnowledgeBaseDeleteRecord, error) {
	rows, err := r.pool.Query(
		ctx,
		`
			DELETE FROM knowledge_bases
			WHERE user_id = $1
			RETURNING id::text, user_id::text, name
		`,
		ownerUserID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]KnowledgeBaseDeleteRecord, 0)
	for rows.Next() {
		var record KnowledgeBaseDeleteRecord
		if err := rows.Scan(&record.ID, &record.OwnerID, &record.Name); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func (r *KnowledgeRepo) GetDocumentTreeByThread(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	documentID string,
) (json.RawMessage, error) {
	query := `
		SELECT d.document_tree
		FROM knowledge_thread_bindings t
		JOIN knowledge_documents d ON d.knowledge_base_id = t.knowledge_base_id
		WHERE t.user_id = $1
		  AND t.thread_id = $2
		  AND d.id = $3::uuid
		LIMIT 1
	`
	var payload []byte
	if err := r.pool.QueryRow(ctx, query, userID, threadID, documentID).Scan(&payload); err != nil {
		return nil, err
	}
	return json.RawMessage(payload), nil
}

func (r *KnowledgeRepo) GetVisibleDocumentTree(
	ctx context.Context,
	userID uuid.UUID,
	documentID string,
) (json.RawMessage, error) {
	query := `
		SELECT d.document_tree
		FROM knowledge_documents d
		JOIN knowledge_bases b ON b.id = d.knowledge_base_id
		WHERE d.id = $2::uuid
		  AND (
			b.user_id = $1
			OR (b.visibility = 'shared' AND b.preview_enabled = TRUE)
		  )
		LIMIT 1
	`
	var payload []byte
	if err := r.pool.QueryRow(ctx, query, userID, documentID).Scan(&payload); err != nil {
		return nil, err
	}
	return json.RawMessage(payload), nil
}

func (r *KnowledgeRepo) ListBuildEventsByThreadDocument(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	documentID string,
	limit int,
) ([]KnowledgeBuildEventRecord, error) {
	query := `
		SELECT
			e.id,
			e.job_id::text,
			e.document_id::text,
			e.stage,
			e.step_name,
			e.status,
			e.message,
			e.elapsed_ms,
			e.retry_count,
			e.input_tokens,
			e.output_tokens,
			e.metadata,
			e.created_at
		FROM knowledge_thread_bindings t
		JOIN knowledge_documents d ON d.knowledge_base_id = t.knowledge_base_id
		JOIN knowledge_build_jobs j ON j.document_id = d.id
		JOIN knowledge_build_events e ON e.job_id = j.id
		WHERE t.user_id = $1
		  AND t.thread_id = $2
		  AND d.id = $3::uuid
		  AND j.id = (
			SELECT j2.id
			FROM knowledge_build_jobs j2
			WHERE j2.document_id = d.id
			ORDER BY j2.created_at DESC
			LIMIT 1
		  )
		ORDER BY e.id ASC
		LIMIT $4
	`
	rows, err := r.pool.Query(ctx, query, userID, threadID, documentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanBuildEventRows(rows)
}

func (r *KnowledgeRepo) ListBuildEventsByVisibleDocument(
	ctx context.Context,
	userID uuid.UUID,
	documentID string,
	limit int,
) ([]KnowledgeBuildEventRecord, error) {
	query := `
		SELECT
			e.id,
			e.job_id::text,
			e.document_id::text,
			e.stage,
			e.step_name,
			e.status,
			e.message,
			e.elapsed_ms,
			e.retry_count,
			e.input_tokens,
			e.output_tokens,
			e.metadata,
			e.created_at
		FROM knowledge_documents d
		JOIN knowledge_bases b ON b.id = d.knowledge_base_id
		JOIN knowledge_build_jobs j ON j.document_id = d.id
		JOIN knowledge_build_events e ON e.job_id = j.id
		WHERE d.id = $2::uuid
		  AND (
			b.user_id = $1
			OR (b.visibility = 'shared' AND b.preview_enabled = TRUE)
		  )
		  AND j.id = (
			SELECT j2.id
			FROM knowledge_build_jobs j2
			WHERE j2.document_id = d.id
			ORDER BY j2.created_at DESC
			LIMIT 1
		  )
		ORDER BY e.id ASC
		LIMIT $3
	`
	rows, err := r.pool.Query(ctx, query, userID, documentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanBuildEventRows(rows)
}

func (r *KnowledgeRepo) GetVisibleDocumentDebug(
	ctx context.Context,
	userID uuid.UUID,
	documentID string,
) (*KnowledgeDocumentDebugRecord, error) {
	query := `
		SELECT
			d.id::text,
			d.display_name,
			d.file_kind,
			d.locator_type,
			d.status,
			d.doc_description,
			d.build_quality,
			d.quality_metadata,
			d.error,
			d.page_count,
			d.node_count,
			d.source_storage_path,
			d.markdown_storage_path,
			d.preview_storage_path,
			d.canonical_storage_path,
			d.created_at,
			d.updated_at,
			b.id::text,
			b.name,
			b.user_id::text,
			u.name,
			b.visibility,
			b.preview_enabled,
			d.document_tree,
			d.canonical_markdown,
			d.source_map_json,
			d.document_index_json,
			j.id::text,
			j.status,
			j.stage,
			j.message,
			j.progress_percent,
			j.total_steps,
			j.completed_steps,
			j.model_name,
			j.started_at,
			j.finished_at,
			j.created_at,
			j.updated_at
		FROM knowledge_documents d
		JOIN knowledge_bases b ON b.id = d.knowledge_base_id
		JOIN users u ON u.id = b.user_id
		LEFT JOIN LATERAL (
			SELECT *
			FROM knowledge_build_jobs j
			WHERE j.document_id = d.id
			ORDER BY j.created_at DESC
			LIMIT 1
		) j ON TRUE
		WHERE d.id = $2::uuid
		  AND (
			b.user_id = $1
			OR (b.visibility = 'shared' AND b.preview_enabled = TRUE)
		  )
		LIMIT 1
	`
	var (
		record            KnowledgeDocumentDebugRecord
		documentTree      []byte
		sourceMapJSON     []byte
		documentIndexJSON []byte
		jobID             *string
		jobStatus         *string
		jobStage          *string
		jobMessage        *string
		jobProgress       *int
		jobTotalSteps     *int
		jobCompleted      *int
		jobModelName      *string
		jobStartedAt      *time.Time
		jobFinishedAt     *time.Time
		jobCreatedAt      *time.Time
		jobUpdatedAt      *time.Time
	)
	err := r.pool.QueryRow(ctx, query, userID, documentID).Scan(
		&record.Document.ID,
		&record.Document.DisplayName,
		&record.Document.FileKind,
		&record.Document.LocatorType,
		&record.Document.Status,
		&record.Document.DocDescription,
		&record.Document.BuildQuality,
		&record.Document.QualityMetadata,
		&record.Document.Error,
		&record.Document.PageCount,
		&record.Document.NodeCount,
		&record.Document.SourceStoragePath,
		&record.Document.MarkdownStoragePath,
		&record.Document.PreviewStoragePath,
		&record.Document.CanonicalStoragePath,
		&record.Document.CreatedAt,
		&record.Document.UpdatedAt,
		&record.KnowledgeBaseID,
		&record.KnowledgeBase,
		&record.OwnerID,
		&record.OwnerName,
		&record.Visibility,
		&record.PreviewEnabled,
		&documentTree,
		&record.CanonicalMarkdown,
		&sourceMapJSON,
		&documentIndexJSON,
		&jobID,
		&jobStatus,
		&jobStage,
		&jobMessage,
		&jobProgress,
		&jobTotalSteps,
		&jobCompleted,
		&jobModelName,
		&jobStartedAt,
		&jobFinishedAt,
		&jobCreatedAt,
		&jobUpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	record.DocumentTree = json.RawMessage(documentTree)
	record.SourceMapJSON = json.RawMessage(sourceMapJSON)
	record.DocumentIndexJSON = json.RawMessage(documentIndexJSON)
	record.Document.LatestBuildJob = buildKnowledgeBuildJobRecord(
		jobID,
		jobStatus,
		jobStage,
		jobMessage,
		jobProgress,
		jobTotalSteps,
		jobCompleted,
		jobModelName,
		jobStartedAt,
		jobFinishedAt,
		jobCreatedAt,
		jobUpdatedAt,
	)
	return &record, nil
}

func (r *KnowledgeRepo) GetVisibleDocumentFile(
	ctx context.Context,
	userID uuid.UUID,
	documentID string,
) (*KnowledgeDocumentFileRecord, error) {
	query := `
		SELECT
			d.display_name,
			d.file_kind,
			d.source_storage_path,
			d.markdown_storage_path,
			d.preview_storage_path,
			d.canonical_storage_path
		FROM knowledge_documents d
		JOIN knowledge_bases b ON b.id = d.knowledge_base_id
		WHERE d.id = $2::uuid
		  AND (
			b.user_id = $1
			OR (b.visibility = 'shared' AND b.preview_enabled = TRUE)
		  )
		LIMIT 1
	`
	var record KnowledgeDocumentFileRecord
	if err := r.pool.QueryRow(ctx, query, userID, documentID).Scan(
		&record.DisplayName,
		&record.FileKind,
		&record.SourceStoragePath,
		&record.MarkdownStoragePath,
		&record.PreviewStoragePath,
		&record.CanonicalStoragePath,
	); err != nil {
		return nil, err
	}
	return &record, nil
}

func scanKnowledgeBaseRows(rows pgx.Rows) ([]KnowledgeBaseRecord, error) {
	baseIndex := make(map[string]int)
	result := make([]KnowledgeBaseRecord, 0)
	for rows.Next() {
		var (
			baseID               string
			baseOwnerID          string
			baseOwnerName        string
			baseName             string
			baseDescription      *string
			sourceType           string
			commandName          *string
			visibility           string
			previewEnabled       bool
			baseCreatedAt        *time.Time
			baseUpdatedAt        *time.Time
			attachedToThread     bool
			documentID           *string
			displayName          *string
			fileKind             *string
			locatorType          *string
			status               *string
			docDescription       *string
			buildQuality         *string
			qualityMetadata      map[string]any
			documentError        *string
			pageCount            *int
			nodeCount            *int
			sourceStoragePath    *string
			markdownStoragePath  *string
			previewStoragePath   *string
			canonicalStoragePath *string
			docCreatedAt         *time.Time
			docUpdatedAt         *time.Time
			jobID                *string
			jobStatus            *string
			jobStage             *string
			jobMessage           *string
			jobProgress          *int
			jobTotalSteps        *int
			jobCompleted         *int
			jobModelName         *string
			jobStartedAt         *time.Time
			jobFinishedAt        *time.Time
			jobCreatedAt         *time.Time
			jobUpdatedAt         *time.Time
		)
		if err := rows.Scan(
			&baseID,
			&baseOwnerID,
			&baseOwnerName,
			&baseName,
			&baseDescription,
			&sourceType,
			&commandName,
			&visibility,
			&previewEnabled,
			&baseCreatedAt,
			&baseUpdatedAt,
			&attachedToThread,
			&documentID,
			&displayName,
			&fileKind,
			&locatorType,
			&status,
			&docDescription,
			&buildQuality,
			&qualityMetadata,
			&documentError,
			&pageCount,
			&nodeCount,
			&sourceStoragePath,
			&markdownStoragePath,
			&previewStoragePath,
			&canonicalStoragePath,
			&docCreatedAt,
			&docUpdatedAt,
			&jobID,
			&jobStatus,
			&jobStage,
			&jobMessage,
			&jobProgress,
			&jobTotalSteps,
			&jobCompleted,
			&jobModelName,
			&jobStartedAt,
			&jobFinishedAt,
			&jobCreatedAt,
			&jobUpdatedAt,
		); err != nil {
			return nil, err
		}

		index, ok := baseIndex[baseID]
		if !ok {
			result = append(result, KnowledgeBaseRecord{
				ID:               baseID,
				OwnerID:          baseOwnerID,
				OwnerName:        baseOwnerName,
				Name:             baseName,
				Description:      baseDescription,
				SourceType:       sourceType,
				CommandName:      commandName,
				Visibility:       visibility,
				PreviewEnabled:   previewEnabled,
				AttachedToThread: attachedToThread,
				CreatedAt:        baseCreatedAt,
				UpdatedAt:        baseUpdatedAt,
				Documents:        []KnowledgeDocumentRecord{},
			})
			index = len(result) - 1
			baseIndex[baseID] = index
		}

		if documentID == nil || displayName == nil || fileKind == nil || locatorType == nil || status == nil {
			continue
		}

		docNodeCount := 0
		if nodeCount != nil {
			docNodeCount = *nodeCount
		}
		result[index].Documents = append(result[index].Documents, KnowledgeDocumentRecord{
			ID:                   *documentID,
			DisplayName:          *displayName,
			FileKind:             *fileKind,
			LocatorType:          *locatorType,
			Status:               *status,
			DocDescription:       docDescription,
			BuildQuality:         derefString(buildQuality, "ready"),
			QualityMetadata:      qualityMetadata,
			Error:                documentError,
			PageCount:            pageCount,
			NodeCount:            docNodeCount,
			SourceStoragePath:    sourceStoragePath,
			MarkdownStoragePath:  markdownStoragePath,
			PreviewStoragePath:   previewStoragePath,
			CanonicalStoragePath: canonicalStoragePath,
			CreatedAt:            docCreatedAt,
			UpdatedAt:            docUpdatedAt,
			LatestBuildJob: buildKnowledgeBuildJobRecord(
				jobID,
				jobStatus,
				jobStage,
				jobMessage,
				jobProgress,
				jobTotalSteps,
				jobCompleted,
				jobModelName,
				jobStartedAt,
				jobFinishedAt,
				jobCreatedAt,
				jobUpdatedAt,
			),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func buildKnowledgeBuildJobRecord(
	jobID *string,
	jobStatus *string,
	jobStage *string,
	jobMessage *string,
	jobProgress *int,
	jobTotalSteps *int,
	jobCompleted *int,
	jobModelName *string,
	jobStartedAt *time.Time,
	jobFinishedAt *time.Time,
	jobCreatedAt *time.Time,
	jobUpdatedAt *time.Time,
) *KnowledgeBuildJobRecord {
	if jobID == nil || jobStatus == nil {
		return nil
	}
	return &KnowledgeBuildJobRecord{
		ID:              *jobID,
		Status:          *jobStatus,
		Stage:           jobStage,
		Message:         jobMessage,
		ProgressPercent: derefInt(jobProgress),
		TotalSteps:      derefInt(jobTotalSteps),
		CompletedSteps:  derefInt(jobCompleted),
		ModelName:       jobModelName,
		StartedAt:       jobStartedAt,
		FinishedAt:      jobFinishedAt,
		CreatedAt:       jobCreatedAt,
		UpdatedAt:       jobUpdatedAt,
	}
}

func scanBuildEventRows(rows pgx.Rows) ([]KnowledgeBuildEventRecord, error) {
	events := make([]KnowledgeBuildEventRecord, 0)
	for rows.Next() {
		var (
			event         KnowledgeBuildEventRecord
			metadataBytes []byte
		)
		if err := rows.Scan(
			&event.ID,
			&event.JobID,
			&event.DocumentID,
			&event.Stage,
			&event.StepName,
			&event.Status,
			&event.Message,
			&event.ElapsedMS,
			&event.RetryCount,
			&event.InputTokens,
			&event.OutputTokens,
			&metadataBytes,
			&event.CreatedAt,
		); err != nil {
			return nil, err
		}
		if len(metadataBytes) > 0 {
			var metadata map[string]any
			if err := json.Unmarshal(metadataBytes, &metadata); err == nil {
				event.Metadata = metadata
			}
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func derefString(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
