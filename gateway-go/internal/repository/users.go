package repository

import (
	"context"
	"errors"

	"github.com/openagents/gateway/internal/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserRepo struct {
	pool *pgxpool.Pool
}

func NewUserRepo(pool *pgxpool.Pool) *UserRepo {
	return &UserRepo{pool: pool}
}

func (r *UserRepo) Create(ctx context.Context, u *model.User) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users (id, email, name, password_hash, avatar_url, role)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		u.ID, u.Email, u.Name, u.PasswordHash, u.AvatarURL, u.Role,
	)
	return err
}

func (r *UserRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	u := &model.User{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, avatar_url, role, created_at, updated_at
		 FROM users WHERE email = $1`, email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.AvatarURL, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

func (r *UserRepo) FindByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	u := &model.User{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, email, name, password_hash, avatar_url, role, created_at, updated_at
		 FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.AvatarURL, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return u, err
}
