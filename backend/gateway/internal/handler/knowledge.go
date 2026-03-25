package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type KnowledgeHandler struct {
	repo *repository.KnowledgeRepo
	fs   *storage.FS
}

type knowledgeCreateResponse struct {
	KnowledgeBases []repository.KnowledgeBaseRecord `json:"knowledge_bases"`
}

type knowledgeAcceptedResponse struct {
	KnowledgeBaseID string `json:"knowledge_base_id"`
	ThreadID        string `json:"thread_id"`
	Status          string `json:"status"`
}

type knowledgeIndexUploadedRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Filenames   []string `json:"filenames"`
	ModelName   string   `json:"model_name"`
}

type knowledgeUpdateSettingsRequest struct {
	PreviewEnabled *bool `json:"preview_enabled"`
}

type knowledgeUpdateSettingsResponse struct {
	KnowledgeBaseID string `json:"knowledge_base_id"`
	PreviewEnabled  bool   `json:"preview_enabled"`
}

type knowledgeManifest struct {
	UserID                   string                      `json:"user_id"`
	ThreadID                 string                      `json:"thread_id"`
	KnowledgeBaseID          string                      `json:"knowledge_base_id"`
	KnowledgeBaseName        string                      `json:"knowledge_base_name"`
	KnowledgeBaseDescription string                      `json:"knowledge_base_description,omitempty"`
	SourceType               string                      `json:"source_type"`
	CommandName              string                      `json:"command_name,omitempty"`
	ModelName                string                      `json:"model_name,omitempty"`
	Documents                []knowledgeManifestDocument `json:"documents"`
}

type knowledgeManifestDocument struct {
	ID                  string `json:"id"`
	DisplayName         string `json:"display_name"`
	FileName            string `json:"file_name"`
	FileKind            string `json:"file_kind"`
	SourceStoragePath   string `json:"source_storage_path"`
	MarkdownStoragePath string `json:"markdown_storage_path,omitempty"`
	PreviewStoragePath  string `json:"preview_storage_path,omitempty"`
}

type knowledgePendingDocument struct {
	ID                  string
	DisplayName         string
	FileName            string
	FileKind            string
	SourceAbsPath       string
	MarkdownAbsPath     string
	PreviewAbsPath      string
	SourceStoragePath   string
	MarkdownStoragePath string
	PreviewStoragePath  string
}

func NewKnowledgeHandler(repo *repository.KnowledgeRepo, fs *storage.FS) *KnowledgeHandler {
	return &KnowledgeHandler{repo: repo, fs: fs}
}

func (h *KnowledgeHandler) List(c *gin.Context) {
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

	items, err := h.repo.ListByThread(c.Request.Context(), userID, threadID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load knowledge bases"})
		return
	}
	if items == nil {
		items = []repository.KnowledgeBaseRecord{}
	}
	c.JSON(http.StatusOK, knowledgeCreateResponse{KnowledgeBases: items})
}

func (h *KnowledgeHandler) ListLibrary(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Query("thread_id"))
	items, err := h.repo.ListVisible(c.Request.Context(), userID, threadID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load knowledge library"})
		return
	}
	if items == nil {
		items = []repository.KnowledgeBaseRecord{}
	}
	c.JSON(http.StatusOK, knowledgeCreateResponse{KnowledgeBases: items})
}

func (h *KnowledgeHandler) DocumentTree(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	documentID := strings.TrimSpace(c.Param("document_id"))
	if threadID == "" || documentID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id and document id are required"})
		return
	}

	tree, err := h.repo.GetDocumentTreeByThread(c.Request.Context(), userID, threadID, documentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load document tree"})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", tree)
}

func (h *KnowledgeHandler) VisibleDocumentTree(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	documentID := strings.TrimSpace(c.Param("document_id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "document id is required"})
		return
	}

	tree, err := h.repo.GetVisibleDocumentTree(c.Request.Context(), userID, documentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document not found or preview is disabled"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load document tree"})
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", tree)
}

func (h *KnowledgeHandler) DocumentBuildEvents(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	documentID := strings.TrimSpace(c.Param("document_id"))
	if threadID == "" || documentID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id and document id are required"})
		return
	}

	events, err := h.repo.ListBuildEventsByThreadDocument(c.Request.Context(), userID, threadID, documentID, 500)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load build events"})
		return
	}
	if events == nil {
		events = []repository.KnowledgeBuildEventRecord{}
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (h *KnowledgeHandler) VisibleDocumentBuildEvents(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	documentID := strings.TrimSpace(c.Param("document_id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "document id is required"})
		return
	}

	events, err := h.repo.ListBuildEventsByVisibleDocument(c.Request.Context(), userID, documentID, 500)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document not found or preview is disabled"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load build events"})
		return
	}
	if events == nil {
		events = []repository.KnowledgeBuildEventRecord{}
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (h *KnowledgeHandler) DocumentDebug(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	documentID := strings.TrimSpace(c.Param("document_id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "document id is required"})
		return
	}

	record, err := h.repo.GetVisibleDocumentDebug(c.Request.Context(), userID, documentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document not found or preview is disabled"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load document debug payload"})
		return
	}

	if record.CanonicalMarkdown == nil || strings.TrimSpace(*record.CanonicalMarkdown) == "" {
		canonical := h.readStorageText(
			firstNonEmptyRef(
				record.Document.CanonicalStoragePath,
				record.Document.MarkdownStoragePath,
				record.Document.SourceStoragePath,
			),
		)
		if canonical != nil {
			record.CanonicalMarkdown = canonical
		}
	}
	if len(record.SourceMapJSON) == 0 || string(record.SourceMapJSON) == "null" {
		record.SourceMapJSON = h.readStorageJSON(firstNonEmptyRef(record.Document.CanonicalStoragePath, record.Document.SourceStoragePath), "canonical.map.json")
	}
	if len(record.DocumentIndexJSON) == 0 || string(record.DocumentIndexJSON) == "null" || string(record.DocumentIndexJSON) == "{}" {
		record.DocumentIndexJSON = h.readStorageJSON(firstNonEmptyRef(record.Document.CanonicalStoragePath, record.Document.SourceStoragePath), "document_index.json")
	}
	c.JSON(http.StatusOK, record)
}

func (h *KnowledgeHandler) VisibleDocumentFile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	documentID := strings.TrimSpace(c.Param("document_id"))
	if documentID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "document id is required"})
		return
	}

	record, err := h.repo.GetVisibleDocumentFile(c.Request.Context(), userID, documentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document not found or preview is disabled"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load knowledge document file"})
		return
	}

	variant := strings.TrimSpace(c.DefaultQuery("variant", "preview"))
	storageRef := ""
	switch variant {
	case "preview":
		storageRef = firstNonEmptyRef(record.PreviewStoragePath, record.SourceStoragePath)
	case "source":
		storageRef = firstNonEmptyRef(record.SourceStoragePath, record.PreviewStoragePath)
	case "markdown":
		storageRef = firstNonEmptyRef(record.MarkdownStoragePath, record.CanonicalStoragePath)
	case "canonical":
		storageRef = firstNonEmptyRef(record.CanonicalStoragePath, record.MarkdownStoragePath)
	default:
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "unsupported file variant"})
		return
	}
	if strings.TrimSpace(storageRef) == "" {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document file not available"})
		return
	}

	absPath := filepath.Join(h.fs.BaseDir(), filepath.FromSlash(storageRef))
	data, err := os.ReadFile(absPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read knowledge document file"})
		return
	}

	filename := filepath.Base(absPath)
	if filename == "." || filename == "/" || filename == "" {
		filename = record.DisplayName
	}

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(filename)))
	if strings.TrimSpace(contentType) == "" {
		contentType = http.DetectContentType(data)
	}
	disposition := "inline"
	if strings.EqualFold(strings.TrimSpace(c.Query("download")), "true") {
		disposition = "attachment"
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, filename))
	c.Data(http.StatusOK, contentType, data)
}

func (h *KnowledgeHandler) Create(c *gin.Context) {
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

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid multipart form"})
		return
	}

	files := form.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "at least one file is required"})
		return
	}

	baseName := strings.TrimSpace(c.PostForm("name"))
	if baseName == "" {
		baseName = strings.TrimSuffix(filepath.Base(files[0].Filename), filepath.Ext(files[0].Filename))
		if baseName == "" {
			baseName = "Knowledge Base"
		}
	}
	description := strings.TrimSpace(c.PostForm("description"))
	modelName := strings.TrimSpace(c.PostForm("model_name"))

	baseID := uuid.NewString()
	pendingDocuments := make([]knowledgePendingDocument, 0, len(files))
	for _, fileHeader := range files {
		document, err := h.saveUploadedKnowledgeFile(c, userID.String(), baseID, fileHeader)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
			return
		}
		pendingDocuments = append(pendingDocuments, document)
	}

	if err := h.runKnowledgeIndexer(c.Request.Context(), knowledgeManifest{
		UserID:                   userID.String(),
		ThreadID:                 threadID,
		KnowledgeBaseID:          baseID,
		KnowledgeBaseName:        baseName,
		KnowledgeBaseDescription: description,
		SourceType:               "sidebar",
		ModelName:                modelName,
		Documents:                manifestDocuments(pendingDocuments),
	}); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, knowledgeAcceptedResponse{
		KnowledgeBaseID: baseID,
		ThreadID:        threadID,
		Status:          "queued",
	})
}

func (h *KnowledgeHandler) AttachBase(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	knowledgeBaseID := strings.TrimSpace(c.Param("knowledge_base_id"))
	if threadID == "" || knowledgeBaseID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id and knowledge base id are required"})
		return
	}

	if err := h.repo.AttachBaseToThread(c.Request.Context(), userID, threadID, knowledgeBaseID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge base not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to attach knowledge base"})
		return
	}
	h.respondWithThreadKnowledgeBases(c, userID, threadID)
}

func (h *KnowledgeHandler) DetachBase(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	knowledgeBaseID := strings.TrimSpace(c.Param("knowledge_base_id"))
	if threadID == "" || knowledgeBaseID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id and knowledge base id are required"})
		return
	}

	if err := h.repo.DetachBaseFromThread(c.Request.Context(), userID, threadID, knowledgeBaseID); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to detach knowledge base"})
		return
	}
	h.respondWithThreadKnowledgeBases(c, userID, threadID)
}

func (h *KnowledgeHandler) UpdateBaseSettings(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	knowledgeBaseID := strings.TrimSpace(c.Param("knowledge_base_id"))
	if knowledgeBaseID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "knowledge base id is required"})
		return
	}

	var req knowledgeUpdateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	if req.PreviewEnabled == nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "preview_enabled is required"})
		return
	}

	if err := h.repo.UpdateBasePreviewEnabled(
		c.Request.Context(),
		userID,
		knowledgeBaseID,
		*req.PreviewEnabled,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge base not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to update knowledge base settings"})
		return
	}

	c.JSON(http.StatusOK, knowledgeUpdateSettingsResponse{
		KnowledgeBaseID: knowledgeBaseID,
		PreviewEnabled:  *req.PreviewEnabled,
	})
}

func (h *KnowledgeHandler) IndexUploaded(c *gin.Context) {
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

	var req knowledgeIndexUploadedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	if len(req.Filenames) == 0 {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "filenames are required"})
		return
	}

	baseName := strings.TrimSpace(req.Name)
	if baseName == "" {
		baseName = "Thread Knowledge Base"
	}

	baseID := uuid.NewString()
	pendingDocuments := make([]knowledgePendingDocument, 0, len(req.Filenames))
	for _, filename := range req.Filenames {
		document, err := h.copyThreadUploadToKnowledge(userID.String(), threadID, baseID, filename)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
			return
		}
		pendingDocuments = append(pendingDocuments, document)
	}

	if err := h.runKnowledgeIndexer(c.Request.Context(), knowledgeManifest{
		UserID:                   userID.String(),
		ThreadID:                 threadID,
		KnowledgeBaseID:          baseID,
		KnowledgeBaseName:        baseName,
		KnowledgeBaseDescription: strings.TrimSpace(req.Description),
		SourceType:               "command",
		CommandName:              "knowledge-add",
		ModelName:                strings.TrimSpace(req.ModelName),
		Documents:                manifestDocuments(pendingDocuments),
	}); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, knowledgeAcceptedResponse{
		KnowledgeBaseID: baseID,
		ThreadID:        threadID,
		Status:          "queued",
	})
}

func (h *KnowledgeHandler) respondWithThreadKnowledgeBases(c *gin.Context, userID uuid.UUID, threadID string) {
	items, err := h.repo.ListByThread(c.Request.Context(), userID, threadID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "knowledge indexing completed but listing failed"})
		return
	}
	if items == nil {
		items = []repository.KnowledgeBaseRecord{}
	}
	c.JSON(http.StatusOK, knowledgeCreateResponse{KnowledgeBases: items})
}

func firstNonEmptyRef(values ...*string) string {
	for _, value := range values {
		if value == nil {
			continue
		}
		trimmed := strings.TrimSpace(*value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (h *KnowledgeHandler) readStorageText(storageRef string) *string {
	trimmed := strings.TrimSpace(storageRef)
	if trimmed == "" {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(h.fs.BaseDir(), filepath.FromSlash(trimmed)))
	if err != nil {
		return nil
	}
	text := string(data)
	return &text
}

func (h *KnowledgeHandler) readStorageJSON(baseStorageRef string, fallbackFileName string) json.RawMessage {
	trimmed := strings.TrimSpace(baseStorageRef)
	if trimmed == "" {
		return nil
	}
	basePath := filepath.Join(h.fs.BaseDir(), filepath.FromSlash(trimmed))
	fallbackPath := filepath.Join(filepath.Dir(basePath), fallbackFileName)
	data, err := os.ReadFile(fallbackPath)
	if err != nil {
		return nil
	}
	return json.RawMessage(data)
}

func (h *KnowledgeHandler) saveUploadedKnowledgeFile(
	c *gin.Context,
	userID string,
	baseID string,
	fileHeader *multipart.FileHeader,
) (knowledgePendingDocument, error) {
	safeName := filepath.Base(fileHeader.Filename)
	if safeName == "." || safeName == ".." || safeName == "" {
		return knowledgePendingDocument{}, fmt.Errorf("invalid filename: %s", fileHeader.Filename)
	}
	documentID := uuid.NewString()
	documentDir := knowledgeDocumentDir(h.fs.BaseDir(), userID, baseID, documentID)
	if err := os.MkdirAll(documentDir, 0755); err != nil {
		return knowledgePendingDocument{}, fmt.Errorf("mkdir knowledge document dir: %w", err)
	}
	sourcePath := filepath.Join(documentDir, safeName)
	if err := c.SaveUploadedFile(fileHeader, sourcePath); err != nil {
		return knowledgePendingDocument{}, fmt.Errorf("save uploaded file: %w", err)
	}
	return buildKnowledgePendingDocument(h.fs.BaseDir(), userID, baseID, documentID, safeName, sourcePath)
}

func (h *KnowledgeHandler) copyThreadUploadToKnowledge(
	userID string,
	threadID string,
	baseID string,
	filename string,
) (knowledgePendingDocument, error) {
	safeName := filepath.Base(strings.TrimSpace(filename))
	if safeName == "." || safeName == ".." || safeName == "" {
		return knowledgePendingDocument{}, fmt.Errorf("invalid upload filename: %s", filename)
	}
	sourcePath := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads", safeName)
	info, err := os.Stat(sourcePath)
	if err != nil || info.IsDir() {
		return knowledgePendingDocument{}, fmt.Errorf("uploaded file not found: %s", safeName)
	}

	documentID := uuid.NewString()
	documentDir := knowledgeDocumentDir(h.fs.BaseDir(), userID, baseID, documentID)
	if err := os.MkdirAll(documentDir, 0755); err != nil {
		return knowledgePendingDocument{}, fmt.Errorf("mkdir knowledge document dir: %w", err)
	}
	targetPath := filepath.Join(documentDir, safeName)
	if err := copyFile(sourcePath, targetPath); err != nil {
		return knowledgePendingDocument{}, fmt.Errorf("copy uploaded file: %w", err)
	}
	return buildKnowledgePendingDocument(h.fs.BaseDir(), userID, baseID, documentID, safeName, targetPath)
}

func buildKnowledgePendingDocument(
	baseDir string,
	userID string,
	baseID string,
	documentID string,
	fileName string,
	sourcePath string,
) (knowledgePendingDocument, error) {
	markdownPath := ""
	if shouldBuildKnowledgeMarkdown(fileName) {
		generatedMarkdownPath, err := convertFileToMarkdown(sourcePath)
		if err == nil {
			markdownPath = generatedMarkdownPath
		}
	}

	previewPath := ""
	if isOfficeDocumentFile(sourcePath) {
		generatedPreviewPath, err := officePreviewConverter(sourcePath)
		if err == nil {
			previewPath = generatedPreviewPath
		}
	}

	return knowledgePendingDocument{
		ID:                  documentID,
		DisplayName:         fileName,
		FileName:            fileName,
		FileKind:            knowledgeFileKind(fileName),
		SourceAbsPath:       sourcePath,
		MarkdownAbsPath:     markdownPath,
		PreviewAbsPath:      previewPath,
		SourceStoragePath:   storageRef(baseDir, sourcePath),
		MarkdownStoragePath: storageRef(baseDir, markdownPath),
		PreviewStoragePath:  storageRef(baseDir, previewPath),
	}, nil
}

func shouldBuildKnowledgeMarkdown(fileName string) bool {
	return isMarkdownConvertible(fileName)
}

func knowledgeDocumentDir(baseDir string, userID string, baseID string, documentID string) string {
	return filepath.Join(baseDir, "knowledge", "users", userID, "bases", baseID, "documents", documentID)
}

func storageRef(baseDir string, absolutePath string) string {
	if strings.TrimSpace(absolutePath) == "" {
		return ""
	}
	relativePath, err := filepath.Rel(baseDir, absolutePath)
	if err != nil {
		return filepath.ToSlash(absolutePath)
	}
	return filepath.ToSlash(relativePath)
}

func manifestDocuments(pending []knowledgePendingDocument) []knowledgeManifestDocument {
	documents := make([]knowledgeManifestDocument, 0, len(pending))
	for _, document := range pending {
		documents = append(documents, knowledgeManifestDocument{
			ID:                  document.ID,
			DisplayName:         document.DisplayName,
			FileName:            document.FileName,
			FileKind:            document.FileKind,
			SourceStoragePath:   document.SourceStoragePath,
			MarkdownStoragePath: document.MarkdownStoragePath,
			PreviewStoragePath:  document.PreviewStoragePath,
		})
	}
	return documents
}

func knowledgeFileKind(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".md", ".markdown":
		return "markdown"
	case ".doc", ".docx":
		return "docx"
	case ".pdf":
		return "pdf"
	default:
		return strings.TrimPrefix(ext, ".")
	}
}

func copyFile(sourcePath string, targetPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer target.Close()

	if _, err := io.Copy(target, source); err != nil {
		return err
	}
	return nil
}

func (h *KnowledgeHandler) runKnowledgeIndexer(ctx context.Context, manifest knowledgeManifest) error {
	manifestFile, err := os.CreateTemp("", "openagents-knowledge-manifest-*.json")
	if err != nil {
		return fmt.Errorf("create manifest file: %w", err)
	}
	manifestPath := manifestFile.Name()

	if err := json.NewEncoder(manifestFile).Encode(manifest); err != nil {
		_ = manifestFile.Close()
		_ = os.Remove(manifestPath)
		return fmt.Errorf("encode knowledge manifest: %w", err)
	}
	if err := manifestFile.Close(); err != nil {
		_ = os.Remove(manifestPath)
		return fmt.Errorf("close knowledge manifest: %w", err)
	}

	command := exec.CommandContext(
		context.Background(),
		"uv",
		"run",
		"python",
		"-m",
		"src.knowledge.cli",
		"ingest",
		"--manifest",
		manifestPath,
	)
	command.Dir = filepath.Join(filepath.Dir(h.fs.BaseDir()), "backend", "agents")
	command.Env = os.Environ()
	go func(manifestPath string, cmd *exec.Cmd) {
		defer os.Remove(manifestPath)
		output, runErr := cmd.CombinedOutput()
		if runErr != nil {
			log.Printf(
				"knowledge indexer failed for base %s: %v: %s",
				manifest.KnowledgeBaseID,
				runErr,
				strings.TrimSpace(string(output)),
			)
			return
		}
		log.Printf(
			"knowledge indexer completed for base %s: %s",
			manifest.KnowledgeBaseID,
			strings.TrimSpace(string(output)),
		)
	}(manifestPath, command)
	return nil
}
