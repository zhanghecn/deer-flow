package handler

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"strings"
)

const apiTokenCipherContext = "openagents/api-token-display/v1"

// APITokenCipher encrypts the owner-visible copy of an API key that is stored
// alongside the auth hash. Verification still uses the hash path exclusively;
// this cipher only exists so `/api/auth/tokens` can show the full key again in
// the management UI when the owning user explicitly requests it.
type APITokenCipher struct {
	aead cipher.AEAD
}

func NewAPITokenCipher(secret string) (*APITokenCipher, error) {
	trimmedSecret := strings.TrimSpace(secret)
	if trimmedSecret == "" {
		return nil, fmt.Errorf("jwt.secret is required for api token encryption")
	}

	// Reuse the mandatory gateway JWT secret as the root secret so operators do
	// not need to manage a second partially configured key source. The context
	// string keeps the derived AES key domain-separated from JWT signing usage.
	derivedKey := sha256.Sum256([]byte(apiTokenCipherContext + ":" + trimmedSecret))
	block, err := aes.NewCipher(derivedKey[:])
	if err != nil {
		return nil, fmt.Errorf("build api token cipher: %w", err)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("build api token gcm: %w", err)
	}

	return &APITokenCipher{aead: aead}, nil
}

func (c *APITokenCipher) EncryptToken(plainToken string) ([]byte, error) {
	if strings.TrimSpace(plainToken) == "" {
		return nil, fmt.Errorf("api token plaintext is required")
	}

	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate api token nonce: %w", err)
	}

	// Prefix the nonce so one opaque byte slice is sufficient for storage and
	// later decryption from PostgreSQL.
	sealed := c.aead.Seal(nil, nonce, []byte(plainToken), nil)
	return append(nonce, sealed...), nil
}

func (c *APITokenCipher) DecryptToken(ciphertext []byte) (string, error) {
	if len(ciphertext) == 0 {
		return "", fmt.Errorf("api token ciphertext is missing")
	}

	nonceSize := c.aead.NonceSize()
	if len(ciphertext) <= nonceSize {
		return "", fmt.Errorf("api token ciphertext is truncated")
	}

	nonce := ciphertext[:nonceSize]
	sealed := ciphertext[nonceSize:]
	plain, err := c.aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt api token: %w", err)
	}
	return string(plain), nil
}
