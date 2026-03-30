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
	"net/url"
	"os"
	ppath "path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/knowledgeasset"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type KnowledgeHandler struct {
	repo       *repository.KnowledgeRepo
	modelRepo  *repository.ModelRepo
	fs         *storage.FS
	assetStore *knowledgeasset.Store
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

type knowledgeClearResponse struct {
	OwnerID      string `json:"owner_id"`
	DeletedCount int    `json:"deleted_count"`
	Status       string `json:"status"`
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

var (
	knowledgeMarkdownImageRefPattern = regexp.MustCompile(`!\[[^\]]*]\(([^)]+)\)`)
	knowledgeHTMLImageRefPattern     = regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']+)["']`)
)

func NewKnowledgeHandler(
	repo *repository.KnowledgeRepo,
	modelRepo *repository.ModelRepo,
	fs *storage.FS,
	assetStore *knowledgeasset.Store,
) *KnowledgeHandler {
	return &KnowledgeHandler{repo: repo, modelRepo: modelRepo, fs: fs, assetStore: assetStore}
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
	if queryReadyOnly(c) {
		items = filterKnowledgeBasesForReadyDocuments(items)
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
	if queryReadyOnly(c) {
		items = filterKnowledgeBasesForReadyDocuments(items)
	}
	if items == nil {
		items = []repository.KnowledgeBaseRecord{}
	}
	c.JSON(http.StatusOK, knowledgeCreateResponse{KnowledgeBases: items})
}

func queryReadyOnly(c *gin.Context) bool {
	value := strings.TrimSpace(c.Query("ready_only"))
	if value == "" {
		return false
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false
	}
	return parsed
}

func filterKnowledgeBasesForReadyDocuments(
	items []repository.KnowledgeBaseRecord,
) []repository.KnowledgeBaseRecord {
	if len(items) == 0 {
		return items
	}

	filtered := make([]repository.KnowledgeBaseRecord, 0, len(items))
	for _, item := range items {
		readyDocuments := make([]repository.KnowledgeDocumentRecord, 0, len(item.Documents))
		for _, document := range item.Documents {
			// `ready_degraded` is still attachable and retrievable by the agent.
			// The selector must not hide those documents or its document counts
			// diverge from thread bindings and runtime knowledge tools.
			status := strings.TrimSpace(document.Status)
			if strings.EqualFold(status, "ready") || strings.EqualFold(status, "ready_degraded") {
				readyDocuments = append(readyDocuments, document)
			}
		}
		if len(readyDocuments) == 0 {
			continue
		}
		item.Documents = readyDocuments
		filtered = append(filtered, item)
	}
	return filtered
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
		if canonicalRef := debugCanonicalStorageRef(record.Document); canonicalRef != "" {
			canonical := h.readStorageText(canonicalRef)
			if canonical != nil {
				record.CanonicalMarkdown = canonical
			}
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

func debugCanonicalStorageRef(document repository.KnowledgeDocumentRecord) string {
	if ref := firstNonEmptyRef(document.CanonicalStoragePath, document.MarkdownStoragePath); ref != "" {
		return ref
	}
	if strings.EqualFold(strings.TrimSpace(document.FileKind), "markdown") {
		return firstNonEmptyRef(document.SourceStoragePath)
	}
	return ""
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
	storageRef, err := visibleDocumentStorageRef(record, variant)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "unsupported file variant"})
		return
	}
	if strings.TrimSpace(storageRef) == "" {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document file not available"})
		return
	}

	data, err := h.assetStore.ReadAll(c.Request.Context(), storageRef)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read knowledge document file"})
		return
	}

	filename := storageRefFilename(storageRef, record.DisplayName)
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

func (h *KnowledgeHandler) VisibleDocumentAsset(c *gin.Context) {
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

	assetPath := strings.TrimSpace(c.Query("path"))
	if assetPath == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "asset path is required"})
		return
	}

	record, err := h.repo.GetVisibleDocumentFile(c.Request.Context(), userID, documentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document not found or preview is disabled"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load knowledge document asset"})
		return
	}

	variant := strings.TrimSpace(c.DefaultQuery("variant", "canonical"))
	storageRef, err := visibleDocumentStorageRef(record, variant)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "unsupported file variant"})
		return
	}
	if strings.TrimSpace(storageRef) == "" {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document file not available"})
		return
	}

	assetStorageRef, err := h.assetStore.ResolvePackageRelativeRef(storageRef, assetPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	data, err := h.assetStore.ReadAll(c.Request.Context(), assetStorageRef)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge document asset not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read knowledge document asset"})
		return
	}

	filename := storageRefFilename(assetStorageRef, filepath.Base(assetPath))
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

func visibleDocumentStorageRef(record *repository.KnowledgeDocumentFileRecord, variant string) (string, error) {
	switch variant {
	case "preview":
		return firstNonEmptyRef(record.PreviewStoragePath, record.SourceStoragePath), nil
	case "source":
		return firstNonEmptyRef(record.SourceStoragePath, record.PreviewStoragePath), nil
	case "markdown":
		return firstNonEmptyRef(record.MarkdownStoragePath, record.CanonicalStoragePath), nil
	case "canonical":
		return firstNonEmptyRef(record.CanonicalStoragePath, record.MarkdownStoragePath), nil
	default:
		return "", fmt.Errorf("unsupported file variant")
	}
}

func storageRefFilename(storageRef string, fallback string) string {
	trimmed := strings.TrimSpace(storageRef)
	if trimmed == "" {
		return fallback
	}
	if strings.HasPrefix(trimmed, "s3://") {
		parsed, err := url.Parse(trimmed)
		if err == nil {
			if base := ppath.Base(parsed.Path); base != "." && base != "/" && base != "" {
				return base
			}
		}
	}
	if base := filepath.Base(trimmed); base != "." && base != "/" && base != "" {
		return base
	}
	return fallback
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

	h.queueKnowledgeBaseCreate(c, userID, threadID, "sidebar", "")
}

func (h *KnowledgeHandler) CreateLibraryBase(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	h.queueKnowledgeBaseCreate(c, userID, "", "library", "")
}

func (h *KnowledgeHandler) queueKnowledgeBaseCreate(
	c *gin.Context,
	userID uuid.UUID,
	threadID string,
	sourceType string,
	commandName string,
) {
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
	if err := h.requireEnabledModel(c.Request.Context(), modelName); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	baseID := uuid.NewString()
	pendingDocuments := make([]knowledgePendingDocument, 0, len(files))
	for _, fileHeader := range files {
		document, err := h.saveUploadedKnowledgeFile(c, userID.String(), baseID, fileHeader)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
			return
		}
		if err := h.persistPendingKnowledgeDocument(c.Request.Context(), &document); err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
			return
		}
		pendingDocuments = append(pendingDocuments, document)
	}

	if err := h.queuePendingKnowledgeBuild(
		c.Request.Context(),
		userID,
		threadID,
		baseID,
		baseName,
		description,
		sourceType,
		commandName,
		modelName,
		pendingDocuments,
	); err != nil {
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

func (h *KnowledgeHandler) DeleteBase(c *gin.Context) {
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

	isAdmin := strings.EqualFold(strings.TrimSpace(middleware.GetRole(c)), "admin")
	record, err := h.repo.DeleteBase(c.Request.Context(), userID, isAdmin, knowledgeBaseID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge base not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to delete knowledge base"})
		return
	}

	basePath := knowledgeBaseDir(h.fs.BaseDir(), record.OwnerID, record.ID)
	if removeErr := os.RemoveAll(basePath); removeErr != nil {
		log.Printf("knowledge base file cleanup failed for %s: %v", record.ID, removeErr)
	}
	if removeErr := h.assetStore.DeleteRelativePrefix(
		c.Request.Context(),
		knowledgeBaseRelativePrefix(record.OwnerID, record.ID),
	); removeErr != nil {
		log.Printf("knowledge base object cleanup failed for %s: %v", record.ID, removeErr)
	}

	c.JSON(http.StatusOK, gin.H{
		"knowledge_base_id": record.ID,
		"status":            "deleted",
	})
}

func (h *KnowledgeHandler) DeleteAllBases(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	isAdmin := strings.EqualFold(strings.TrimSpace(middleware.GetRole(c)), "admin")
	targetOwnerID := userID
	rawOwnerID := strings.TrimSpace(c.Query("owner_id"))
	if rawOwnerID != "" {
		parsedOwnerID, err := uuid.Parse(rawOwnerID)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid owner id"})
			return
		}
		if !isAdmin && parsedOwnerID != userID {
			c.JSON(http.StatusForbidden, model.ErrorResponse{Error: "forbidden"})
			return
		}
		targetOwnerID = parsedOwnerID
	}

	records, err := h.repo.DeleteBasesByOwner(c.Request.Context(), targetOwnerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to clear knowledge bases"})
		return
	}

	for _, record := range records {
		basePath := knowledgeBaseDir(h.fs.BaseDir(), record.OwnerID, record.ID)
		if removeErr := os.RemoveAll(basePath); removeErr != nil {
			log.Printf("knowledge base file cleanup failed for %s: %v", record.ID, removeErr)
		}
		if removeErr := h.assetStore.DeleteRelativePrefix(
			c.Request.Context(),
			knowledgeBaseRelativePrefix(record.OwnerID, record.ID),
		); removeErr != nil {
			log.Printf("knowledge base object cleanup failed for %s: %v", record.ID, removeErr)
		}
	}

	c.JSON(http.StatusOK, knowledgeClearResponse{
		OwnerID:      targetOwnerID.String(),
		DeletedCount: len(records),
		Status:       "cleared",
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
	if err := h.requireEnabledModel(c.Request.Context(), strings.TrimSpace(req.ModelName)); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
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
		if err := h.persistPendingKnowledgeDocument(c.Request.Context(), &document); err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
			return
		}
		pendingDocuments = append(pendingDocuments, document)
	}

	if err := h.queuePendingKnowledgeBuild(
		c.Request.Context(),
		userID,
		threadID,
		baseID,
		baseName,
		strings.TrimSpace(req.Description),
		"command",
		"knowledge-add",
		strings.TrimSpace(req.ModelName),
		pendingDocuments,
	); err != nil {
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

func (h *KnowledgeHandler) requireEnabledModel(ctx context.Context, modelName string) error {
	normalized := strings.TrimSpace(modelName)
	if normalized == "" {
		return fmt.Errorf("model_name is required")
	}
	record, err := h.modelRepo.FindEnabledByName(ctx, normalized)
	if err != nil {
		return fmt.Errorf("failed to validate model_name: %w", err)
	}
	if record == nil {
		return fmt.Errorf("model_name %q is not enabled", normalized)
	}
	return nil
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
	data, err := h.assetStore.ReadAll(context.Background(), trimmed)
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
	candidates := make([]string, 0, 2)
	if packageRef, err := h.assetStore.ResolvePackageRelativeRef(trimmed, filepath.ToSlash(filepath.Join("index", fallbackFileName))); err == nil {
		candidates = append(candidates, packageRef)
	}
	if siblingRef, err := h.assetStore.ResolveSiblingRef(trimmed, fallbackFileName); err == nil {
		candidates = append(candidates, siblingRef)
	}
	for _, candidate := range candidates {
		data, err := h.assetStore.ReadAll(context.Background(), candidate)
		if err == nil {
			return json.RawMessage(data)
		}
	}
	return nil
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
	sourceDir := filepath.Join(documentDir, "source")
	if err := os.MkdirAll(sourceDir, 0755); err != nil {
		return knowledgePendingDocument{}, fmt.Errorf("mkdir knowledge source dir: %w", err)
	}
	sourcePath := filepath.Join(sourceDir, safeName)
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
	sourceDir := filepath.Join(documentDir, "source")
	if err := os.MkdirAll(sourceDir, 0755); err != nil {
		return knowledgePendingDocument{}, fmt.Errorf("mkdir knowledge source dir: %w", err)
	}
	targetPath := filepath.Join(sourceDir, safeName)
	if err := copyFile(sourcePath, targetPath); err != nil {
		return knowledgePendingDocument{}, fmt.Errorf("copy uploaded file: %w", err)
	}
	if knowledgeFileKind(safeName) == "markdown" {
		if err := copyMarkdownReferencedAssets(sourcePath, targetPath); err != nil {
			return knowledgePendingDocument{}, fmt.Errorf("copy markdown assets: %w", err)
		}
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
	documentDir := knowledgeDocumentDir(baseDir, userID, baseID, documentID)
	markdownPath := ""
	if shouldBuildKnowledgeMarkdown(fileName) {
		generatedMarkdownPath, err := convertFileToMarkdown(sourcePath)
		if err == nil {
			targetPath := filepath.Join(documentDir, "markdown", strings.TrimSuffix(fileName, filepath.Ext(fileName))+".md")
			if err := moveGeneratedKnowledgeArtifactWithAssets(generatedMarkdownPath, targetPath); err == nil {
				markdownPath = targetPath
			} else {
				return knowledgePendingDocument{}, fmt.Errorf("persist knowledge markdown companion: %w", err)
			}
		}
	}

	previewPath := ""
	if isOfficeDocumentFile(sourcePath) {
		generatedPreviewPath, err := officePreviewConverter(sourcePath)
		if err == nil {
			targetPath := filepath.Join(documentDir, "preview", "preview.pdf")
			if err := moveGeneratedKnowledgeArtifact(generatedPreviewPath, targetPath); err == nil {
				previewPath = targetPath
			} else {
				return knowledgePendingDocument{}, fmt.Errorf("persist knowledge preview pdf: %w", err)
			}
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

func (h *KnowledgeHandler) persistPendingKnowledgeDocument(
	ctx context.Context,
	document *knowledgePendingDocument,
) error {
	relativePrefix := knowledgeDocumentRelativePrefixFromStorageRef(document.SourceStoragePath)
	localDir := filepath.Join(h.fs.BaseDir(), filepath.FromSlash(relativePrefix))
	if err := h.assetStore.SyncDirectory(ctx, relativePrefix, localDir); err != nil {
		return fmt.Errorf("sync knowledge document package: %w", err)
	}
	document.SourceStoragePath = mapKnowledgeStorageRef(h.assetStore, document.SourceStoragePath)
	document.MarkdownStoragePath = mapKnowledgeStorageRef(h.assetStore, document.MarkdownStoragePath)
	document.PreviewStoragePath = mapKnowledgeStorageRef(h.assetStore, document.PreviewStoragePath)
	return nil
}

func shouldBuildKnowledgeMarkdown(fileName string) bool {
	return isMarkdownConvertible(fileName)
}

func knowledgeDocumentDir(baseDir string, userID string, baseID string, documentID string) string {
	return filepath.Join(knowledgeBaseDir(baseDir, userID, baseID), "documents", documentID)
}

func knowledgeBaseDir(baseDir string, userID string, baseID string) string {
	return filepath.Join(baseDir, "knowledge", "users", userID, "bases", baseID)
}

func knowledgeBaseRelativePrefix(userID string, baseID string) string {
	return filepath.ToSlash(filepath.Join("knowledge", "users", userID, "bases", baseID))
}

func knowledgeDocumentRelativePrefixFromStorageRef(storageRef string) string {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(storageRef)))
	parent := filepath.ToSlash(filepath.Dir(clean))
	switch filepath.Base(parent) {
	case "source", "preview", "markdown", "canonical", "index", "assets":
		return filepath.ToSlash(filepath.Dir(parent))
	default:
		return parent
	}
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

func mapKnowledgeStorageRef(assetStore *knowledgeasset.Store, storageRef string) string {
	trimmed := strings.TrimSpace(storageRef)
	if trimmed == "" {
		return ""
	}
	return assetStore.RefForRelativePath(trimmed)
}

func (h *KnowledgeHandler) queuePendingKnowledgeBuild(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	baseID string,
	baseName string,
	description string,
	sourceType string,
	commandName string,
	modelName string,
	pending []knowledgePendingDocument,
) error {
	documents := make([]repository.QueuedKnowledgeDocumentInput, 0, len(pending))
	for _, document := range pending {
		documents = append(documents, repository.QueuedKnowledgeDocumentInput{
			ID:                  document.ID,
			DisplayName:         document.DisplayName,
			FileName:            document.FileName,
			FileKind:            document.FileKind,
			LocatorType:         queuedKnowledgeLocatorType(document.FileKind),
			SourceStoragePath:   document.SourceStoragePath,
			MarkdownStoragePath: optionalTrimmedString(document.MarkdownStoragePath),
			PreviewStoragePath:  optionalTrimmedString(document.PreviewStoragePath),
			ModelName:           modelName,
		})
	}
	return h.repo.QueueBaseBuild(ctx, repository.QueueKnowledgeBaseBuildParams{
		ID:          baseID,
		UserID:      userID,
		ThreadID:    threadID,
		Name:        baseName,
		Description: optionalTrimmedString(description),
		SourceType:  sourceType,
		CommandName: optionalTrimmedString(commandName),
		Documents:   documents,
	})
}

func optionalTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func queuedKnowledgeLocatorType(fileKind string) string {
	if strings.EqualFold(strings.TrimSpace(fileKind), "markdown") {
		return "heading"
	}
	return "page"
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

func moveGeneratedKnowledgeArtifact(sourcePath string, targetPath string) error {
	if strings.TrimSpace(sourcePath) == "" {
		return fmt.Errorf("generated artifact path is required")
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return err
	}
	if err := os.Rename(sourcePath, targetPath); err == nil {
		return nil
	}
	if err := copyFile(sourcePath, targetPath); err != nil {
		return err
	}
	return os.Remove(sourcePath)
}

func moveGeneratedKnowledgeArtifactWithAssets(sourcePath string, targetPath string) error {
	if err := copyMarkdownReferencedAssets(sourcePath, targetPath); err != nil {
		return err
	}
	return moveGeneratedKnowledgeArtifact(sourcePath, targetPath)
}

func copyMarkdownReferencedAssets(sourceMarkdownPath string, targetMarkdownPath string) error {
	sourceMarkdownPath = strings.TrimSpace(sourceMarkdownPath)
	targetMarkdownPath = strings.TrimSpace(targetMarkdownPath)
	if sourceMarkdownPath == "" || targetMarkdownPath == "" {
		return nil
	}

	sourceBytes, err := os.ReadFile(sourceMarkdownPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	sourceDir := filepath.Dir(sourceMarkdownPath)
	targetDir := filepath.Dir(targetMarkdownPath)
	for _, relativeRef := range collectMarkdownRelativeAssetRefs(string(sourceBytes)) {
		sourceAssetPath := filepath.Join(sourceDir, filepath.FromSlash(relativeRef))
		info, statErr := os.Stat(sourceAssetPath)
		if statErr != nil || info.IsDir() {
			continue
		}

		targetAssetPath := filepath.Join(targetDir, filepath.FromSlash(relativeRef))
		if err := os.MkdirAll(filepath.Dir(targetAssetPath), 0755); err != nil {
			return err
		}
		if err := copyFile(sourceAssetPath, targetAssetPath); err != nil {
			return err
		}
	}

	return nil
}

func collectMarkdownRelativeAssetRefs(markdown string) []string {
	refs := make([]string, 0, 8)
	seen := make(map[string]struct{})
	appendRef := func(raw string) {
		normalized := normalizeMarkdownRelativeAssetRef(raw)
		if normalized == "" {
			return
		}
		if _, ok := seen[normalized]; ok {
			return
		}
		seen[normalized] = struct{}{}
		refs = append(refs, normalized)
	}

	for _, match := range knowledgeMarkdownImageRefPattern.FindAllStringSubmatch(markdown, -1) {
		if len(match) > 1 {
			appendRef(match[1])
		}
	}
	for _, match := range knowledgeHTMLImageRefPattern.FindAllStringSubmatch(markdown, -1) {
		if len(match) > 1 {
			appendRef(match[1])
		}
	}

	return refs
}

func normalizeMarkdownRelativeAssetRef(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if fields := strings.Fields(value); len(fields) > 0 {
		value = fields[0]
	}
	value = strings.Trim(value, "<>")
	if value == "" {
		return ""
	}
	if queryIndex := strings.IndexAny(value, "?#"); queryIndex >= 0 {
		value = value[:queryIndex]
	}

	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "data:") ||
		strings.HasPrefix(lower, "kb://") ||
		strings.HasPrefix(lower, "/mnt/user-data/") {
		return ""
	}

	cleanPath := filepath.Clean(filepath.FromSlash(value))
	if cleanPath == "." || cleanPath == ".." || filepath.IsAbs(cleanPath) {
		return ""
	}
	parentPrefix := ".." + string(filepath.Separator)
	if strings.HasPrefix(cleanPath, parentPrefix) {
		return ""
	}
	return filepath.ToSlash(cleanPath)
}
