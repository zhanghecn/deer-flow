package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openagents/gateway/internal/model"
)

type PublicAPIInputFileRepo struct {
	pool *pgxpool.Pool
}

func NewPublicAPIInputFileRepo(pool *pgxpool.Pool) *PublicAPIInputFileRepo {
	return &PublicAPIInputFileRepo{pool: pool}
}

func (r *PublicAPIInputFileRepo) Create(ctx context.Context, file *model.PublicAPIInputFile) error {
	_, err := r.pool.Exec(
		ctx,
		`INSERT INTO public_api_input_files (
			id,
			file_id,
			api_token_id,
			user_id,
			purpose,
			filename,
			storage_ref,
			mime_type,
			size_bytes,
			sha256,
			created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		file.ID,
		file.FileID,
		file.APITokenID,
		file.UserID,
		file.Purpose,
		file.Filename,
		file.StorageRef,
		file.MimeType,
		file.SizeBytes,
		file.SHA256,
		file.CreatedAt,
	)
	return err
}

func (r *PublicAPIInputFileRepo) GetByFileID(
	ctx context.Context,
	fileID string,
	apiTokenID uuid.UUID,
) (*model.PublicAPIInputFile, error) {
	row := r.pool.QueryRow(
		ctx,
		`SELECT
			id,
			file_id,
			api_token_id,
			user_id,
			purpose,
			filename,
			storage_ref,
			mime_type,
			size_bytes,
			sha256,
			created_at
		FROM public_api_input_files
		WHERE file_id = $1 AND api_token_id = $2
		LIMIT 1`,
		fileID,
		apiTokenID,
	)

	var item model.PublicAPIInputFile
	if err := row.Scan(
		&item.ID,
		&item.FileID,
		&item.APITokenID,
		&item.UserID,
		&item.Purpose,
		&item.Filename,
		&item.StorageRef,
		&item.MimeType,
		&item.SizeBytes,
		&item.SHA256,
		&item.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}
