package applog

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

const (
	defaultLogMaxSizeMB = 100
	defaultLogBackups   = 10
)

// ConfigureFromEnv mirrors all gateway logs to a persistent file when the
// deploy stack provides OPENAGENTS_GATEWAY_LOG_FILE or OPENAGENTS_LOG_FILE.
// Stdout/stderr remain enabled so Docker compose logs keep working.
func ConfigureFromEnv() (func() error, error) {
	logFile := firstNonEmptyEnv("OPENAGENTS_GATEWAY_LOG_FILE", "OPENAGENTS_LOG_FILE")
	if logFile == "" {
		return func() error { return nil }, nil
	}

	maxSizeMB := intEnv("OPENAGENTS_LOG_MAX_SIZE_MB", defaultLogMaxSizeMB)
	maxBackups := intEnv("OPENAGENTS_LOG_MAX_BACKUPS", defaultLogBackups)
	writer, err := newRotatingFileWriter(logFile, int64(maxSizeMB)*1024*1024, maxBackups)
	if err != nil {
		return nil, err
	}

	// The Go stdlib logger writes application logs, while Gin uses package-level
	// writers for access and recovery output. Point both at the same file writer
	// without removing the container streams operators already use.
	stdoutAndFile := io.MultiWriter(os.Stdout, writer)
	stderrAndFile := io.MultiWriter(os.Stderr, writer)
	log.SetOutput(stderrAndFile)
	gin.DefaultWriter = stdoutAndFile
	gin.DefaultErrorWriter = stderrAndFile
	log.Printf("Gateway file logging enabled: path=%s max_size_mb=%d max_backups=%d", logFile, maxSizeMB, maxBackups)
	return writer.Close, nil
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

type rotatingFileWriter struct {
	mu         sync.Mutex
	path       string
	maxBytes   int64
	maxBackups int
	file       *os.File
	size       int64
}

func newRotatingFileWriter(path string, maxBytes int64, maxBackups int) (*rotatingFileWriter, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	stat, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &rotatingFileWriter{
		path:       path,
		maxBytes:   maxBytes,
		maxBackups: maxBackups,
		file:       file,
		size:       stat.Size(),
	}, nil
}

func (w *rotatingFileWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.maxBytes > 0 && w.size > 0 && w.size+int64(len(p)) > w.maxBytes {
		if err := w.rotateLocked(); err != nil {
			return 0, err
		}
	}
	n, err := w.file.Write(p)
	w.size += int64(n)
	return n, err
}

func (w *rotatingFileWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}

func (w *rotatingFileWriter) rotateLocked() error {
	if w.file != nil {
		if err := w.file.Close(); err != nil {
			return err
		}
		w.file = nil
	}

	if w.maxBackups > 0 {
		for index := w.maxBackups - 1; index >= 1; index-- {
			oldName := fmt.Sprintf("%s.%d", w.path, index)
			newName := fmt.Sprintf("%s.%d", w.path, index+1)
			if _, err := os.Stat(oldName); err == nil {
				_ = os.Rename(oldName, newName)
			}
		}
		_ = os.Rename(w.path, fmt.Sprintf("%s.1", w.path))
	} else {
		_ = os.Remove(w.path)
	}

	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	w.file = file
	w.size = 0
	return nil
}
