package handler

import "testing"

func TestAPITokenCipherRoundTrip(t *testing.T) {
	t.Parallel()

	cipher, err := NewAPITokenCipher("gateway-secret")
	if err != nil {
		t.Fatalf("NewAPITokenCipher() error = %v", err)
	}

	ciphertext, err := cipher.EncryptToken("df_secret_token")
	if err != nil {
		t.Fatalf("EncryptToken() error = %v", err)
	}

	plainToken, err := cipher.DecryptToken(ciphertext)
	if err != nil {
		t.Fatalf("DecryptToken() error = %v", err)
	}
	if plainToken != "df_secret_token" {
		t.Fatalf("DecryptToken() = %q, want %q", plainToken, "df_secret_token")
	}
}

func TestAPITokenCipherRejectsEmptySecret(t *testing.T) {
	t.Parallel()

	if _, err := NewAPITokenCipher("   "); err == nil {
		t.Fatal("NewAPITokenCipher() expected error for empty secret")
	}
}

func TestAPITokenCipherRejectsTamperedCiphertext(t *testing.T) {
	t.Parallel()

	cipher, err := NewAPITokenCipher("gateway-secret")
	if err != nil {
		t.Fatalf("NewAPITokenCipher() error = %v", err)
	}

	ciphertext, err := cipher.EncryptToken("df_secret_token")
	if err != nil {
		t.Fatalf("EncryptToken() error = %v", err)
	}

	ciphertext[len(ciphertext)-1] ^= 0x01
	if _, err := cipher.DecryptToken(ciphertext); err == nil {
		t.Fatal("DecryptToken() expected tamper detection error")
	}
}
