package handler

import (
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/threadartifacts"
	"github.com/openagents/gateway/pkg/storage"
)

type ArtifactsHandler struct {
	fs *storage.FS
}

type artifactListResponse struct {
	Artifacts []string `json:"artifacts"`
}

type officeDocumentDescriptor struct {
	DocumentType string
	Editable     bool
}

var officePreviewConverter = ensureOfficePDFPreview

func NewArtifactsHandler(fs *storage.FS) *ArtifactsHandler {
	return &ArtifactsHandler{fs: fs}
}

func (h *ArtifactsHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}
	threadID := strings.TrimSpace(c.Param("id"))
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id is required"})
		return
	}

	artifacts, err := threadartifacts.ListOutputArtifacts(h.fs, userID.String(), threadID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list artifacts"})
		return
	}

	c.JSON(http.StatusOK, artifactListResponse{Artifacts: artifacts})
}

func (h *ArtifactsHandler) Serve(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}
	threadID := c.Param("id")
	artifactPath := artifactPathFromContext(c)

	if artifactPath == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing artifact path"})
		return
	}

	relativePath, preferredScope, err := decodeArtifactRequestPath(artifactPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	resolvedPath, info, err := resolveArtifactFile(h.fs, userID.String(), threadID, relativePath, preferredScope)
	if err == nil {
		if c.Query("preview") == "pdf" && isOfficeDocumentFile(resolvedPath) {
			previewPath, err := officePreviewConverter(resolvedPath)
			if err != nil {
				c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to generate artifact preview"})
				return
			}
			previewInfo, err := os.Stat(previewPath)
			if err != nil {
				c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to stat artifact preview"})
				return
			}
			serveArtifactFile(c, previewPath, previewInfo)
			return
		}
		serveArtifactFile(c, resolvedPath, info)
		return
	}

	c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "artifact not found"})
}

func artifactPathFromContext(c *gin.Context) string {
	artifactPath := c.Param("path")
	if artifactPath != "" {
		return artifactPath
	}
	head := c.Param("head")
	tail := c.Param("tail")
	if head == "" {
		return ""
	}
	return "/" + head + tail
}

func resolveArtifactFile(
	fs *storage.FS,
	userID string,
	threadID string,
	relativePath string,
	preferredScope string,
) (string, os.FileInfo, error) {
	for _, candidate := range artifactCandidates(fs, userID, threadID, relativePath, preferredScope) {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, info, nil
		}
	}
	return "", nil, os.ErrNotExist
}

func artifactCandidates(
	fs *storage.FS,
	userID string,
	threadID string,
	relativePath string,
	preferredScope string,
) []string {
	userDataDir := fs.ThreadUserDataDirForUser(userID, threadID)
	switch preferredScope {
	case "outputs":
		return []string{filepath.Join(userDataDir, "outputs", relativePath)}
	case "workspace":
		return []string{filepath.Join(userDataDir, "workspace", relativePath)}
	default:
		return []string{
			filepath.Join(userDataDir, "outputs", relativePath),
			filepath.Join(userDataDir, "workspace", relativePath),
		}
	}
}

func decodeArtifactRequestPath(artifactPath string) (string, string, error) {
	decodedPath, err := url.PathUnescape(artifactPath)
	if err != nil {
		return "", "", fmt.Errorf("invalid artifact path")
	}

	cleaned := path.Clean(strings.TrimPrefix(decodedPath, "/"))
	if cleaned == "." || cleaned == "" {
		return "", "", fmt.Errorf("missing artifact path")
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", "", fmt.Errorf("invalid path")
	}

	relativePath, preferredScope := normalizeArtifactPath(cleaned)
	return relativePath, preferredScope, nil
}

func encodeArtifactPath(filepath string) string {
	parts := strings.Split(strings.TrimPrefix(filepath, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func normalizeArtifactPath(cleaned string) (relativePath string, preferredScope string) {
	prefixes := []struct {
		prefix string
		scope  string
	}{
		{"mnt/user-data/outputs/", "outputs"},
		{"/mnt/user-data/outputs/", "outputs"},
		{"outputs/", "outputs"},
		{"mnt/user-data/workspace/", "workspace"},
		{"/mnt/user-data/workspace/", "workspace"},
		{"workspace/", "workspace"},
	}

	for _, item := range prefixes {
		if strings.HasPrefix(cleaned, item.prefix) {
			return strings.TrimPrefix(cleaned, item.prefix), item.scope
		}
	}
	return cleaned, ""
}

func officeDocumentDescriptorForPath(filePath string) (officeDocumentDescriptor, bool) {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".doc":
		return officeDocumentDescriptor{DocumentType: "word", Editable: false}, true
	case ".docx":
		return officeDocumentDescriptor{DocumentType: "word", Editable: true}, true
	case ".xls":
		return officeDocumentDescriptor{DocumentType: "cell", Editable: false}, true
	case ".xlsx":
		return officeDocumentDescriptor{DocumentType: "cell", Editable: true}, true
	case ".ppt", ".pptx":
		return officeDocumentDescriptor{
			DocumentType: "slide",
			Editable:     strings.EqualFold(filepath.Ext(filePath), ".pptx"),
		}, true
	default:
		return officeDocumentDescriptor{}, false
	}
}

func isOfficeDocumentFile(filePath string) bool {
	_, ok := officeDocumentDescriptorForPath(filePath)
	return ok
}

func officePreviewPath(filePath string) string {
	return filePath + ".preview.pdf"
}

func previewIsFresh(sourcePath string, previewInfo os.FileInfo) bool {
	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return false
	}
	return !previewInfo.ModTime().Before(sourceInfo.ModTime())
}

func ensureOfficePDFPreview(filePath string) (string, error) {
	if !isOfficeDocumentFile(filePath) {
		return "", fmt.Errorf("preview conversion only supports office documents")
	}

	previewPath := officePreviewPath(filePath)
	if previewInfo, err := os.Stat(previewPath); err == nil && !previewInfo.IsDir() && previewIsFresh(filePath, previewInfo) {
		return previewPath, nil
	}

	tmpDir, err := os.MkdirTemp(filepath.Dir(previewPath), "artifact-preview-*")
	if err != nil {
		return "", fmt.Errorf("create preview temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cmd := exec.Command("soffice", "--headless", "--convert-to", "pdf", "--outdir", tmpDir, filePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("convert office preview: %w: %s", err, strings.TrimSpace(string(output)))
	}

	baseName := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	convertedPath := filepath.Join(tmpDir, baseName+".pdf")
	if _, err := os.Stat(convertedPath); err != nil {
		return "", fmt.Errorf("converted preview missing: %w", err)
	}

	if err := os.Rename(convertedPath, previewPath); err != nil {
		return "", fmt.Errorf("persist preview pdf: %w", err)
	}

	return previewPath, nil
}

func serveArtifactFile(c *gin.Context, filePath string, info os.FileInfo) {
	file, err := os.Open(filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to open artifact"})
		return
	}
	defer file.Close()

	if contentType := mime.TypeByExtension(filepath.Ext(filePath)); contentType != "" {
		c.Header("Content-Type", contentType)
	}
	http.ServeContent(c.Writer, c.Request, filepath.Base(filePath), info.ModTime(), file)
}
