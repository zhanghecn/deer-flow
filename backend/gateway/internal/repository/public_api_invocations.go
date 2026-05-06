package repository

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openagents/gateway/internal/model"
)

type PublicAPIInvocationRepo struct {
	pool *pgxpool.Pool
}

func NewPublicAPIInvocationRepo(pool *pgxpool.Pool) *PublicAPIInvocationRepo {
	return &PublicAPIInvocationRepo{pool: pool}
}

func (r *PublicAPIInvocationRepo) Create(ctx context.Context, invocation *model.PublicAPIInvocation) error {
	_, err := r.pool.Exec(
		ctx,
		`INSERT INTO public_api_invocations (
			id,
			response_id,
			surface,
			api_token_id,
			user_id,
			agent_name,
			thread_id,
			trace_id,
			request_model,
			status,
			input_tokens,
			output_tokens,
			total_tokens,
			error,
			request_json,
			response_json,
			client_ip,
			user_agent,
			created_at,
			finished_at
		)
		VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15, $16, $17, $18, $19, $20
		)`,
		invocation.ID,
		invocation.ResponseID,
		invocation.Surface,
		invocation.APITokenID,
		invocation.UserID,
		invocation.AgentName,
		invocation.ThreadID,
		invocation.TraceID,
		invocation.RequestModel,
		invocation.Status,
		invocation.InputTokens,
		invocation.OutputTokens,
		invocation.TotalTokens,
		invocation.Error,
		invocation.RequestJSON,
		invocation.ResponseJSON,
		invocation.ClientIP,
		invocation.UserAgent,
		invocation.CreatedAt,
		invocation.FinishedAt,
	)
	return err
}

func (r *PublicAPIInvocationRepo) Finish(ctx context.Context, invocation *model.PublicAPIInvocation) error {
	_, err := r.pool.Exec(
		ctx,
		`UPDATE public_api_invocations
		 SET
			trace_id = $2,
			status = $3,
			input_tokens = $4,
			output_tokens = $5,
			total_tokens = $6,
			error = $7,
			response_json = $8,
			finished_at = $9
		 WHERE id = $1`,
		invocation.ID,
		invocation.TraceID,
		invocation.Status,
		invocation.InputTokens,
		invocation.OutputTokens,
		invocation.TotalTokens,
		invocation.Error,
		invocation.ResponseJSON,
		invocation.FinishedAt,
	)
	return err
}

func (r *PublicAPIInvocationRepo) AttachArtifacts(ctx context.Context, artifacts []model.PublicAPIArtifact) error {
	for _, artifact := range artifacts {
		if _, err := r.pool.Exec(
			ctx,
			`INSERT INTO public_api_artifacts (
				id,
				invocation_id,
				response_id,
				file_id,
				virtual_path,
				storage_ref,
				mime_type,
				size_bytes,
				sha256,
				created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			artifact.ID,
			artifact.InvocationID,
			artifact.ResponseID,
			artifact.FileID,
			artifact.VirtualPath,
			artifact.StorageRef,
			artifact.MimeType,
			artifact.SizeBytes,
			artifact.SHA256,
			artifact.CreatedAt,
		); err != nil {
			return err
		}
	}
	return nil
}

func (r *PublicAPIInvocationRepo) GetByResponseID(
	ctx context.Context,
	responseID string,
	apiTokenID uuid.UUID,
) (*model.PublicAPIInvocation, error) {
	row := r.pool.QueryRow(
		ctx,
		`SELECT
			id,
			response_id,
			surface,
			api_token_id,
			user_id,
			agent_name,
			thread_id,
			trace_id,
			request_model,
			status,
			input_tokens,
			output_tokens,
			total_tokens,
			error,
			request_json,
			response_json,
			client_ip,
			user_agent,
			created_at,
			finished_at
		FROM public_api_invocations
		WHERE response_id = $1 AND api_token_id = $2
		LIMIT 1`,
		responseID,
		apiTokenID,
	)

	var item model.PublicAPIInvocation
	if err := row.Scan(
		&item.ID,
		&item.ResponseID,
		&item.Surface,
		&item.APITokenID,
		&item.UserID,
		&item.AgentName,
		&item.ThreadID,
		&item.TraceID,
		&item.RequestModel,
		&item.Status,
		&item.InputTokens,
		&item.OutputTokens,
		&item.TotalTokens,
		&item.Error,
		&item.RequestJSON,
		&item.ResponseJSON,
		&item.ClientIP,
		&item.UserAgent,
		&item.CreatedAt,
		&item.FinishedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *PublicAPIInvocationRepo) GetArtifactByFileID(
	ctx context.Context,
	fileID string,
	apiTokenID uuid.UUID,
) (*model.PublicAPIArtifact, *model.PublicAPIInvocation, error) {
	row := r.pool.QueryRow(
		ctx,
		`SELECT
			a.id,
			a.invocation_id,
			a.response_id,
			a.file_id,
			a.virtual_path,
			a.storage_ref,
			a.mime_type,
			a.size_bytes,
			a.sha256,
			a.created_at,
			i.id,
			i.response_id,
			i.surface,
			i.api_token_id,
			i.user_id,
			i.agent_name,
			i.thread_id,
			i.trace_id,
			i.request_model,
			i.status,
			i.input_tokens,
			i.output_tokens,
			i.total_tokens,
			i.error,
			i.request_json,
			i.response_json,
			i.client_ip,
			i.user_agent,
			i.created_at,
			i.finished_at
		FROM public_api_artifacts a
		JOIN public_api_invocations i ON i.id = a.invocation_id
		WHERE a.file_id = $1 AND i.api_token_id = $2
		LIMIT 1`,
		fileID,
		apiTokenID,
	)

	var artifact model.PublicAPIArtifact
	var invocation model.PublicAPIInvocation
	if err := row.Scan(
		&artifact.ID,
		&artifact.InvocationID,
		&artifact.ResponseID,
		&artifact.FileID,
		&artifact.VirtualPath,
		&artifact.StorageRef,
		&artifact.MimeType,
		&artifact.SizeBytes,
		&artifact.SHA256,
		&artifact.CreatedAt,
		&invocation.ID,
		&invocation.ResponseID,
		&invocation.Surface,
		&invocation.APITokenID,
		&invocation.UserID,
		&invocation.AgentName,
		&invocation.ThreadID,
		&invocation.TraceID,
		&invocation.RequestModel,
		&invocation.Status,
		&invocation.InputTokens,
		&invocation.OutputTokens,
		&invocation.TotalTokens,
		&invocation.Error,
		&invocation.RequestJSON,
		&invocation.ResponseJSON,
		&invocation.ClientIP,
		&invocation.UserAgent,
		&invocation.CreatedAt,
		&invocation.FinishedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	return &artifact, &invocation, nil
}

func (r *PublicAPIInvocationRepo) ListByUser(
	ctx context.Context,
	userID uuid.UUID,
	filter model.PublicAPIInvocationFilter,
) ([]model.PublicAPIInvocation, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}

	agentName := strings.TrimSpace(filter.AgentName)
	threadID := strings.TrimSpace(filter.ThreadID)
	surface := strings.TrimSpace(filter.Surface)
	rows, err := r.pool.Query(
		ctx,
		`SELECT
			id,
			response_id,
			surface,
			api_token_id,
			user_id,
			agent_name,
			thread_id,
			trace_id,
			request_model,
			status,
			input_tokens,
			output_tokens,
			total_tokens,
			error,
			request_json,
			response_json,
			client_ip,
			user_agent,
			created_at,
			finished_at
		FROM public_api_invocations
		WHERE user_id = $1
		  AND ($2::uuid IS NULL OR api_token_id = $2::uuid)
		  AND ($3 = '' OR agent_name = $3)
		  AND ($4 = '' OR thread_id = $4)
		  AND ($5 = '' OR surface = $5)
		  AND ($6::boolean = false OR finished_at IS NOT NULL)
		ORDER BY created_at DESC
		LIMIT $7 OFFSET $8`,
		userID,
		filter.APITokenID,
		agentName,
		threadID,
		surface,
		filter.FinishedOnly,
		limit,
		offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.PublicAPIInvocation, 0)
	for rows.Next() {
		var item model.PublicAPIInvocation
		if err := rows.Scan(
			&item.ID,
			&item.ResponseID,
			&item.Surface,
			&item.APITokenID,
			&item.UserID,
			&item.AgentName,
			&item.ThreadID,
			&item.TraceID,
			&item.RequestModel,
			&item.Status,
			&item.InputTokens,
			&item.OutputTokens,
			&item.TotalTokens,
			&item.Error,
			&item.RequestJSON,
			&item.ResponseJSON,
			&item.ClientIP,
			&item.UserAgent,
			&item.CreatedAt,
			&item.FinishedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
