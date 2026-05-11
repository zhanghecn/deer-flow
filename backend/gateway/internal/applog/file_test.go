package applog

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestRotatingFileWriterRotatesBySize(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "gateway.log")
	writer, err := newRotatingFileWriter(logPath, 8, 2)
	if err != nil {
		t.Fatalf("newRotatingFileWriter() error = %v", err)
	}
	defer writer.Close()

	if _, err := writer.Write([]byte("first\n")); err != nil {
		t.Fatalf("write first: %v", err)
	}
	if _, err := writer.Write([]byte("second\n")); err != nil {
		t.Fatalf("write second: %v", err)
	}

	current, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read current log: %v", err)
	}
	rotated, err := os.ReadFile(logPath + ".1")
	if err != nil {
		t.Fatalf("read rotated log: %v", err)
	}
	if !bytes.Contains(current, []byte("second")) {
		t.Fatalf("current log = %q, want second write", current)
	}
	if !bytes.Contains(rotated, []byte("first")) {
		t.Fatalf("rotated log = %q, want first write", rotated)
	}
}
