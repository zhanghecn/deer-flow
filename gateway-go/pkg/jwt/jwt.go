package jwt

import (
	"fmt"
	"time"

	jwtv5 "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	UserID uuid.UUID `json:"user_id"`
	Role   string    `json:"role"`
	jwtv5.RegisteredClaims
}

type Manager struct {
	secret     []byte
	expireHour int
}

func NewManager(secret string, expireHour int) *Manager {
	return &Manager{
		secret:     []byte(secret),
		expireHour: expireHour,
	}
}

func (m *Manager) Generate(userID uuid.UUID, role string) (string, error) {
	claims := Claims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwtv5.RegisteredClaims{
			ExpiresAt: jwtv5.NewNumericDate(time.Now().Add(time.Duration(m.expireHour) * time.Hour)),
			IssuedAt:  jwtv5.NewNumericDate(time.Now()),
			Issuer:    "openagents",
		},
	}
	token := jwtv5.NewWithClaims(jwtv5.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

func (m *Manager) Validate(tokenStr string) (*Claims, error) {
	token, err := jwtv5.ParseWithClaims(tokenStr, &Claims{}, func(t *jwtv5.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwtv5.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}
