package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	ppath "path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/knowledgeasset"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type KnowledgeHandler struct {
	repo       *repository.KnowledgeRepo
	threadRepo *repository.ThreadRepo
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

type knowledgeImportUploadedRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Filenames   []string `json:"filenames"`
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

type knowledgeWorkspaceFileNode struct {
	Name     string                        `json:"name"`
	Path     string                        `json:"path"`
	IsDir    bool                          `json:"is_dir"`
	Children []*knowledgeWorkspaceFileNode `json:"children,omitempty"`
}

type knowledgeWorkspaceTreeResponse struct {
	Workspace repository.KnowledgeWorkspaceRecord `json:"workspace"`
	Tree      []*knowledgeWorkspaceFileNode       `json:"tree"`
}

type knowledgeWorkspaceFileResponse struct {
	Workspace repository.KnowledgeWorkspaceRecord `json:"workspace"`
	Path      string                              `json:"path"`
	Content   string                              `json:"content"`
}

type knowledgeWorkspaceGraphNode struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Type      string `json:"type"`
	Path      string `json:"path"`
	LinkCount int    `json:"link_count"`
	Community int    `json:"community"`
}

type knowledgeWorkspaceGraphEdge struct {
	Source string  `json:"source"`
	Target string  `json:"target"`
	Weight float64 `json:"weight"`
}

type knowledgeWorkspaceGraphCommunity struct {
	ID        int      `json:"id"`
	NodeCount int      `json:"node_count"`
	Cohesion  float64  `json:"cohesion"`
	TopNodes  []string `json:"top_nodes"`
}

type knowledgeWorkspaceGraphInsightNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type knowledgeWorkspaceGraphInsights struct {
	IsolatedNodes     []knowledgeWorkspaceGraphInsightNode `json:"isolated_nodes"`
	SparseCommunities []knowledgeWorkspaceGraphCommunity   `json:"sparse_communities"`
	EdgeCount         int                                  `json:"edge_count"`
}

type knowledgeWorkspaceGraphResponse struct {
	Workspace   repository.KnowledgeWorkspaceRecord `json:"workspace"`
	Nodes       []knowledgeWorkspaceGraphNode       `json:"nodes"`
	Edges       []knowledgeWorkspaceGraphEdge       `json:"edges"`
	Communities []knowledgeWorkspaceGraphCommunity  `json:"communities"`
	Insights    knowledgeWorkspaceGraphInsights     `json:"insights"`
}

type knowledgeWorkspaceGraphRawNode struct {
	id      string
	label   string
	kind    string
	path    string
	sources []string
	links   []string
	out     map[string]bool
	in      map[string]bool
}

var (
	knowledgeMarkdownImageRefPattern     = regexp.MustCompile(`!\[[^\]]*]\(([^)]+)\)`)
	knowledgeHTMLImageRefPattern         = regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']+)["']`)
	knowledgeWorkspaceFrontmatter        = regexp.MustCompile(`(?s)^---\n(.*?)\n---`)
	knowledgeWorkspaceTitlePattern       = regexp.MustCompile(`(?m)^title:\s*["']?(.+?)["']?\s*$`)
	knowledgeWorkspaceSourcesBlock       = regexp.MustCompile(`(?m)^sources:\s*\n((?:\s+-\s+.+\n?)*)`)
	knowledgeWorkspaceSourcesInline      = regexp.MustCompile(`(?m)^sources:\s*\[([^\]]*)\]`)
	knowledgeWorkspaceRelatedBlock       = regexp.MustCompile(`(?m)^related:\s*\n((?:\s+-\s+.+\n?)*)`)
	knowledgeWorkspaceRelatedInline      = regexp.MustCompile(`(?m)^related:\s*\[([^\]]*)\]`)
	knowledgeWorkspaceHeadingPattern     = regexp.MustCompile(`(?m)^#\s+(.+)$`)
	knowledgeWorkspaceBracketLinkPattern = regexp.MustCompile(`\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]`)
	knowledgeWorkspaceGraphKeySplit      = regexp.MustCompile(`[^0-9a-z\p{Han}]+`)
)

func NewKnowledgeHandler(
	repo *repository.KnowledgeRepo,
	threadRepo *repository.ThreadRepo,
	fs *storage.FS,
	assetStore *knowledgeasset.Store,
) *KnowledgeHandler {
	return &KnowledgeHandler{repo: repo, threadRepo: threadRepo, fs: fs, assetStore: assetStore}
}

func (h *KnowledgeHandler) materializeAgentDefaultKnowledgeBases(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) error {
	if h.threadRepo == nil || h.repo == nil || h.fs == nil || userID == uuid.Nil || strings.TrimSpace(threadID) == "" {
		return nil
	}

	binding, err := h.threadRepo.GetRuntimeByUser(ctx, userID, threadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if binding == nil {
		return nil
	}

	agentName := ""
	if binding.AgentName != nil {
		agentName = strings.TrimSpace(*binding.AgentName)
	}
	if agentName == "" {
		return nil
	}

	agentStatus := strings.TrimSpace(binding.AgentStatus)
	if agentStatus == "" {
		agentStatus = "dev"
	}
	agent, err := agentfs.LoadAgent(h.fs, agentName, agentStatus, false)
	if err != nil {
		return fmt.Errorf("load bound agent %s (%s): %w", agentName, agentStatus, err)
	}
	if agent == nil {
		return fmt.Errorf("bound agent %s (%s) not found", agentName, agentStatus)
	}

	for _, knowledgeBaseID := range agent.KnowledgeBaseIDs {
		// Agent archive defaults become persisted thread attachments before
		// listing so existing chats, selectors, and runtime prompts all observe
		// the same knowledge_thread_bindings contract.
		if err := h.repo.AttachBaseToThread(ctx, userID, threadID, knowledgeBaseID); err != nil {
			return fmt.Errorf("attach default knowledge base %s to thread %s: %w", knowledgeBaseID, threadID, err)
		}
	}
	return nil
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

	if err := h.materializeAgentDefaultKnowledgeBases(c.Request.Context(), userID, threadID); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to attach agent default knowledge bases"})
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
	if err := h.materializeAgentDefaultKnowledgeBases(c.Request.Context(), userID, threadID); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to attach agent default knowledge bases"})
		return
	}
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

func (h *KnowledgeHandler) WorkspaceTree(c *gin.Context) {
	workspace, ok := h.resolveVisibleWorkspace(c)
	if !ok {
		return
	}
	prefix := knowledgeWorkspaceRelativePrefix(workspace.OwnerID, workspace.ID)
	paths, err := h.assetStore.ListRelativePaths(c.Request.Context(), prefix)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list knowledge workspace"})
		return
	}
	paths = filterSourceWorkspaceMarkdownPaths(paths)
	c.JSON(http.StatusOK, knowledgeWorkspaceTreeResponse{
		Workspace: *workspace,
		Tree:      buildWorkspaceFileTree(paths),
	})
}

func (h *KnowledgeHandler) WorkspaceFile(c *gin.Context) {
	workspace, ok := h.resolveVisibleWorkspace(c)
	if !ok {
		return
	}
	relativePath, err := cleanWorkspaceRelativePath(c.Query("path"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	if !isSourceWorkspaceMarkdownPath(relativePath) {
		// The management preview mirrors the agent-facing source-only contract:
		// old compiled wiki/cache objects may still exist in storage during
		// migrations, but they must not be readable as workspace files.
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "knowledge workspace files must be under sources/*.md"})
		return
	}
	storageRef := h.assetStore.RefForRelativePath(filepath.ToSlash(filepath.Join(
		knowledgeWorkspaceRelativePrefix(workspace.OwnerID, workspace.ID),
		relativePath,
	)))
	data, err := h.assetStore.ReadAll(c.Request.Context(), storageRef)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge workspace file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read knowledge workspace file"})
		return
	}
	c.JSON(http.StatusOK, knowledgeWorkspaceFileResponse{
		Workspace: *workspace,
		Path:      relativePath,
		Content:   string(data),
	})
}

func (h *KnowledgeHandler) WorkspaceGraph(c *gin.Context) {
	workspace, ok := h.resolveVisibleWorkspace(c)
	if !ok {
		return
	}
	prefix := knowledgeWorkspaceRelativePrefix(workspace.OwnerID, workspace.ID)
	paths, err := h.assetStore.ListRelativePaths(c.Request.Context(), filepath.ToSlash(filepath.Join(prefix, "sources")))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list knowledge workspace graph"})
		return
	}

	nodes := map[string]*knowledgeWorkspaceGraphRawNode{}
	for _, path := range paths {
		if !strings.HasSuffix(path, ".md") {
			continue
		}
		workspacePath := filepath.ToSlash(filepath.Join("sources", path))
		storageRef := h.assetStore.RefForRelativePath(filepath.ToSlash(filepath.Join(prefix, workspacePath)))
		data, err := h.assetStore.ReadAll(c.Request.Context(), storageRef)
		if err != nil {
			continue
		}
		nodeID := strings.TrimSuffix(filepath.Base(path), ".md")
		content := string(data)
		nodes[nodeID] = &knowledgeWorkspaceGraphRawNode{
			id:      nodeID,
			label:   workspaceMarkdownTitle(content, filepath.Base(path)),
			kind:    "source",
			path:    workspacePath,
			sources: workspaceMarkdownSources(content),
			links:   workspaceMarkdownLinks(content),
			out:     map[string]bool{},
			in:      map[string]bool{},
		}
	}
	for sourceID, node := range nodes {
		for _, rawTarget := range node.links {
			targetID := resolveWorkspaceGraphTarget(rawTarget, nodes)
			if targetID == "" || targetID == sourceID {
				continue
			}
			node.out[targetID] = true
			nodes[targetID].in[sourceID] = true
		}
	}
	edges := make([]knowledgeWorkspaceGraphEdge, 0)
	seenEdges := map[string]bool{}
	for sourceID, node := range nodes {
		for targetID := range node.out {
			keyParts := []string{sourceID, targetID}
			sort.Strings(keyParts)
			key := strings.Join(keyParts, ":::")
			if seenEdges[key] {
				continue
			}
			seenEdges[key] = true
			edges = append(edges, knowledgeWorkspaceGraphEdge{
				Source: sourceID,
				Target: targetID,
				Weight: calculateWorkspaceGraphRelevance(nodes[sourceID], nodes[targetID], nodes),
			})
		}
	}
	communities, communityInfo := assignWorkspaceGraphCommunities(nodes, edges)
	responseNodes := make([]knowledgeWorkspaceGraphNode, 0, len(nodes))
	for _, node := range nodes {
		responseNodes = append(responseNodes, knowledgeWorkspaceGraphNode{
			ID:        node.id,
			Label:     node.label,
			Type:      node.kind,
			Path:      node.path,
			LinkCount: len(node.out) + len(node.in),
			Community: communities[node.id],
		})
	}
	sort.Slice(responseNodes, func(i, j int) bool {
		if responseNodes[i].Community != responseNodes[j].Community {
			return responseNodes[i].Community < responseNodes[j].Community
		}
		return responseNodes[i].Label < responseNodes[j].Label
	})
	c.JSON(http.StatusOK, knowledgeWorkspaceGraphResponse{
		Workspace:   *workspace,
		Nodes:       responseNodes,
		Edges:       edges,
		Communities: communityInfo,
		Insights:    buildWorkspaceGraphInsights(responseNodes, edges, communityInfo),
	})
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
	relativePaths, err := knowledgeUploadRelativePaths(form, files)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
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
	baseID := uuid.NewString()
	pendingDocuments := make([]knowledgePendingDocument, 0, len(files))
	for index, fileHeader := range files {
		document, err := h.saveUploadedKnowledgeFile(c, userID.String(), baseID, fileHeader, relativePaths[index])
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

func (h *KnowledgeHandler) ImportUploaded(c *gin.Context) {
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

	var req knowledgeImportUploadedRequest
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
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "knowledge source preparation completed but listing failed"})
		return
	}
	if items == nil {
		items = []repository.KnowledgeBaseRecord{}
	}
	c.JSON(http.StatusOK, knowledgeCreateResponse{KnowledgeBases: items})
}

func knowledgeUploadRelativePaths(form *multipart.Form, files []*multipart.FileHeader) ([]string, error) {
	values := form.Value["relative_paths"]
	result := make([]string, 0, len(files))
	for index, fileHeader := range files {
		rawPath := fileHeader.Filename
		if index < len(values) && strings.TrimSpace(values[index]) != "" {
			rawPath = values[index]
		}
		relativePath, err := cleanKnowledgeUploadRelativePath(rawPath)
		if err != nil {
			return nil, err
		}
		result = append(result, relativePath)
	}
	return result, nil
}

func cleanKnowledgeUploadRelativePath(value string) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if normalized == "" {
		return "", fmt.Errorf("knowledge upload path is required")
	}
	if strings.HasPrefix(normalized, "/") {
		return "", fmt.Errorf("knowledge upload path must be relative: %s", value)
	}
	clean := ppath.Clean(normalized)
	clean = strings.TrimPrefix(clean, "/")
	if clean == "." || clean == "" {
		return "", fmt.Errorf("knowledge upload path is required")
	}
	if clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") {
		return "", fmt.Errorf("knowledge upload path must stay within the uploaded folder: %s", value)
	}
	if filepath.Base(clean) == "." || filepath.Base(clean) == ".." || filepath.Base(clean) == "" {
		return "", fmt.Errorf("invalid knowledge upload filename: %s", value)
	}
	// The relative path is part of the source identity, while the physical file
	// stays inside a per-document package. Preserving this path lets folder
	// imports surface useful source workspace names instead of many
	// indistinguishable `cases.md` files.
	return clean, nil
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

func (h *KnowledgeHandler) saveUploadedKnowledgeFile(
	c *gin.Context,
	userID string,
	baseID string,
	fileHeader *multipart.FileHeader,
	relativePath string,
) (knowledgePendingDocument, error) {
	safeName := filepath.Base(relativePath)
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
	return buildKnowledgePendingDocument(h.fs.BaseDir(), userID, baseID, documentID, relativePath, sourcePath)
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
	sourcePath := filepath.Join(h.fs.ThreadUserDataDirForUser(userID, threadID), "uploads", safeName)
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

	sourceStoragePath, err := storageRef(baseDir, sourcePath)
	if err != nil {
		return knowledgePendingDocument{}, err
	}
	markdownStoragePath, err := storageRef(baseDir, markdownPath)
	if err != nil {
		return knowledgePendingDocument{}, err
	}
	previewStoragePath, err := storageRef(baseDir, previewPath)
	if err != nil {
		return knowledgePendingDocument{}, err
	}

	return knowledgePendingDocument{
		ID:                  documentID,
		DisplayName:         fileName,
		FileName:            fileName,
		FileKind:            knowledgeFileKind(fileName),
		SourceAbsPath:       sourcePath,
		MarkdownAbsPath:     markdownPath,
		PreviewAbsPath:      previewPath,
		SourceStoragePath:   sourceStoragePath,
		MarkdownStoragePath: markdownStoragePath,
		PreviewStoragePath:  previewStoragePath,
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

func knowledgeWorkspaceRelativePrefix(userID string, baseID string) string {
	return filepath.ToSlash(filepath.Join(knowledgeBaseRelativePrefix(userID, baseID), "workspace"))
}

func (h *KnowledgeHandler) resolveVisibleWorkspace(c *gin.Context) (*repository.KnowledgeWorkspaceRecord, bool) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return nil, false
	}
	knowledgeBaseID := strings.TrimSpace(c.Param("knowledge_base_id"))
	if knowledgeBaseID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "knowledge base id is required"})
		return nil, false
	}
	workspace, err := h.repo.GetVisibleWorkspace(c.Request.Context(), userID, knowledgeBaseID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "knowledge workspace not found or preview is disabled"})
			return nil, false
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load knowledge workspace"})
		return nil, false
	}
	return workspace, true
}

func cleanWorkspaceRelativePath(value string) (string, error) {
	clean := ppath.Clean(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"))
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" || clean == "." {
		return "", fmt.Errorf("workspace path is required")
	}
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("workspace path must stay within the knowledge workspace")
	}
	return clean, nil
}

func buildWorkspaceFileTree(paths []string) []*knowledgeWorkspaceFileNode {
	root := &knowledgeWorkspaceFileNode{Children: []*knowledgeWorkspaceFileNode{}}
	for _, rawPath := range paths {
		cleanPath := filepath.ToSlash(filepath.Clean(rawPath))
		if cleanPath == "." || cleanPath == "" {
			continue
		}
		current := root
		parts := strings.Split(cleanPath, "/")
		for index, part := range parts {
			childPath := strings.Join(parts[:index+1], "/")
			child := findWorkspaceTreeChild(current, part)
			if child == nil {
				child = &knowledgeWorkspaceFileNode{
					Name:  part,
					Path:  childPath,
					IsDir: index < len(parts)-1,
				}
				current.Children = append(current.Children, child)
			}
			if index < len(parts)-1 {
				child.IsDir = true
			}
			current = child
		}
	}
	sortWorkspaceTree(root.Children)
	return root.Children
}

func filterSourceWorkspaceMarkdownPaths(paths []string) []string {
	filtered := make([]string, 0, len(paths))
	for _, path := range paths {
		if isSourceWorkspaceMarkdownPath(path) {
			filtered = append(filtered, filepath.ToSlash(filepath.Clean(path)))
		}
	}
	return filtered
}

func isSourceWorkspaceMarkdownPath(path string) bool {
	cleanPath := filepath.ToSlash(filepath.Clean(strings.ReplaceAll(strings.TrimSpace(path), "\\", "/")))
	fileName := strings.TrimPrefix(cleanPath, "sources/")
	// Source workspace generation writes a flat `sources/{slug}.md` file per
	// source document. Nested directories are treated as stale/generated data.
	return fileName != cleanPath && fileName != "" && !strings.Contains(fileName, "/") && strings.HasSuffix(fileName, ".md")
}

func findWorkspaceTreeChild(parent *knowledgeWorkspaceFileNode, name string) *knowledgeWorkspaceFileNode {
	for _, child := range parent.Children {
		if child.Name == name {
			return child
		}
	}
	return nil
}

func sortWorkspaceTree(nodes []*knowledgeWorkspaceFileNode) {
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].IsDir != nodes[j].IsDir {
			return nodes[i].IsDir
		}
		return nodes[i].Name < nodes[j].Name
	})
	for _, node := range nodes {
		sortWorkspaceTree(node.Children)
	}
}

func workspaceFrontmatter(content string) string {
	if match := knowledgeWorkspaceFrontmatter.FindStringSubmatch(content); len(match) == 2 {
		return match[1]
	}
	return ""
}

func workspaceMarkdownTitle(content string, filename string) string {
	if match := knowledgeWorkspaceTitlePattern.FindStringSubmatch(workspaceFrontmatter(content)); len(match) == 2 {
		return strings.Trim(strings.TrimSpace(match[1]), `"'`)
	}
	if match := knowledgeWorkspaceHeadingPattern.FindStringSubmatch(content); len(match) == 2 {
		return strings.TrimSpace(match[1])
	}
	return strings.ReplaceAll(strings.TrimSuffix(filename, ".md"), "-", " ")
}

func workspaceMarkdownSources(content string) []string {
	fm := workspaceFrontmatter(content)
	sources := make([]string, 0)
	if match := knowledgeWorkspaceSourcesBlock.FindStringSubmatch(fm); len(match) == 2 {
		for _, line := range strings.Split(match[1], "\n") {
			item := strings.TrimSpace(line)
			item = strings.TrimSpace(strings.TrimPrefix(item, "-"))
			item = strings.Trim(item, `"'`)
			if item != "" {
				sources = append(sources, item)
			}
		}
	}
	if match := knowledgeWorkspaceSourcesInline.FindStringSubmatch(fm); len(match) == 2 {
		for _, rawItem := range strings.Split(match[1], ",") {
			item := strings.Trim(strings.TrimSpace(rawItem), `"'`)
			if item != "" {
				sources = append(sources, item)
			}
		}
	}
	return dedupeStrings(sources)
}

func workspaceMarkdownLinks(content string) []string {
	matches := knowledgeWorkspaceBracketLinkPattern.FindAllStringSubmatch(content, -1)
	links := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) == 2 {
			links = append(links, strings.TrimSpace(match[1]))
		}
	}
	// Browser graph construction runs in the gateway. If source Markdown carries
	// `related` frontmatter, treat those entries as graph targets without
	// mutating the stored source text.
	links = append(links, workspaceRelatedLinks(content)...)
	return links
}

func workspaceRelatedLinks(content string) []string {
	fm := workspaceFrontmatter(content)
	links := make([]string, 0)
	appendRelated := func(raw string) {
		item := normalizeWorkspaceRelatedTarget(raw)
		if item != "" {
			links = append(links, item)
		}
	}
	if match := knowledgeWorkspaceRelatedBlock.FindStringSubmatch(fm); len(match) == 2 {
		for _, line := range strings.Split(match[1], "\n") {
			item := strings.TrimSpace(line)
			item = strings.TrimSpace(strings.TrimPrefix(item, "-"))
			appendRelated(item)
		}
	}
	if match := knowledgeWorkspaceRelatedInline.FindStringSubmatch(fm); len(match) == 2 {
		for _, rawItem := range strings.Split(match[1], ",") {
			appendRelated(rawItem)
		}
	}
	return dedupeStrings(links)
}

func normalizeWorkspaceRelatedTarget(raw string) string {
	item := strings.TrimSpace(raw)
	item = strings.Trim(item, "[]")
	item = strings.Trim(strings.TrimSpace(item), `"'`)
	if item == "" {
		return ""
	}
	if matches := knowledgeWorkspaceBracketLinkPattern.FindAllStringSubmatch(item, -1); len(matches) > 0 {
		return workspaceGraphTargetSlug(matches[0][1])
	}
	return workspaceGraphTargetSlug(item)
}

func resolveWorkspaceGraphTarget(raw string, nodes map[string]*knowledgeWorkspaceGraphRawNode) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if _, ok := nodes[trimmed]; ok {
		return trimmed
	}
	normalized := strings.ReplaceAll(strings.ToLower(trimmed), " ", "-")
	normalizedKey := workspaceGraphResolutionKey(trimmed)
	for id := range nodes {
		idLower := strings.ToLower(id)
		if idLower == strings.ToLower(trimmed) || idLower == normalized || strings.ReplaceAll(idLower, " ", "-") == normalized {
			return id
		}
		if normalizedKey != "" && (workspaceGraphResolutionKey(id) == normalizedKey || workspaceGraphResolutionKey(nodes[id].label) == normalizedKey) {
			return id
		}
	}
	return ""
}

func workspaceGraphTargetSlug(raw string) string {
	cleaned := strings.Trim(strings.TrimSpace(raw), `"'`)
	cleaned = strings.ReplaceAll(cleaned, "\\", "/")
	cleaned = strings.TrimSuffix(cleaned, ".md")
	if cleaned == "" {
		return ""
	}
	return ppath.Base(cleaned)
}

func workspaceGraphResolutionKey(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	parts := knowledgeWorkspaceGraphKeySplit.Split(lower, -1)
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, "-")
}

func calculateWorkspaceGraphRelevance(
	a *knowledgeWorkspaceGraphRawNode,
	b *knowledgeWorkspaceGraphRawNode,
	nodes map[string]*knowledgeWorkspaceGraphRawNode,
) float64 {
	if a == nil || b == nil || a.id == b.id {
		return 0
	}
	direct := 0.0
	if a.out[b.id] {
		direct += 1
	}
	if b.out[a.id] {
		direct += 1
	}

	sourceOverlap := 0.0
	aSources := map[string]bool{}
	for _, source := range a.sources {
		aSources[source] = true
	}
	for _, source := range b.sources {
		if aSources[source] {
			sourceOverlap += 1
		}
	}

	neighborsA := workspaceGraphNeighbors(a)
	neighborsB := workspaceGraphNeighbors(b)
	adamic := 0.0
	for neighborID := range neighborsA {
		if !neighborsB[neighborID] {
			continue
		}
		neighbor := nodes[neighborID]
		if neighbor == nil {
			continue
		}
		degree := workspaceGraphDegree(neighbor)
		if degree < 2 {
			degree = 2
		}
		adamic += 1 / math.Log(float64(degree))
	}

	// Keep graph relevance explainable: direct links, shared source labels,
	// and common neighbors are deterministic and auditable source-only signals.
	score := direct*3.0 + sourceOverlap*4.0 + adamic*1.5
	return math.Round(score*1000) / 1000
}

func workspaceGraphNeighbors(node *knowledgeWorkspaceGraphRawNode) map[string]bool {
	neighbors := map[string]bool{}
	for id := range node.out {
		neighbors[id] = true
	}
	for id := range node.in {
		neighbors[id] = true
	}
	return neighbors
}

func workspaceGraphDegree(node *knowledgeWorkspaceGraphRawNode) int {
	if node == nil {
		return 0
	}
	return len(node.out) + len(node.in)
}

func assignWorkspaceGraphCommunities(
	nodes map[string]*knowledgeWorkspaceGraphRawNode,
	edges []knowledgeWorkspaceGraphEdge,
) (map[string]int, []knowledgeWorkspaceGraphCommunity) {
	adjacency := make(map[string]map[string]float64, len(nodes))
	for id := range nodes {
		adjacency[id] = map[string]float64{}
	}
	totalWeight := 0.0
	for _, edge := range edges {
		if adjacency[edge.Source] == nil || adjacency[edge.Target] == nil {
			continue
		}
		weight := edge.Weight
		if weight <= 0 {
			weight = 1
		}
		adjacency[edge.Source][edge.Target] += weight
		adjacency[edge.Target][edge.Source] += weight
		totalWeight += weight
	}
	assignments := map[string]int{}
	ids := make([]string, 0, len(nodes))
	for id := range nodes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	degrees := make(map[string]float64, len(nodes))
	communityTotals := make(map[int]float64, len(nodes))
	for index, id := range ids {
		assignments[id] = index
		for _, weight := range adjacency[id] {
			degrees[id] += weight
		}
		communityTotals[index] = degrees[id]
	}

	if totalWeight > 0 {
		doubleTotalWeight := 2 * totalWeight
		// This mirrors the Python worker's deterministic Louvain-style first
		// phase. The gateway serves the browser graph, so it must not collapse
		// every connected component into one community when weak bridge edges
		// connect otherwise distinct topics.
		for iteration := 0; iteration < 20; iteration++ {
			moved := false
			for _, nodeID := range ids {
				current := assignments[nodeID]
				nodeDegree := degrees[nodeID]
				communityTotals[current] -= nodeDegree
				weightsByCommunity := map[int]float64{}
				communityIDs := make([]int, 0)
				for neighborID, weight := range adjacency[nodeID] {
					communityID := assignments[neighborID]
					if _, ok := weightsByCommunity[communityID]; !ok {
						communityIDs = append(communityIDs, communityID)
					}
					weightsByCommunity[communityID] += weight
				}
				sort.Ints(communityIDs)
				bestCommunity := current
				bestGain := 0.0
				for _, communityID := range communityIDs {
					gain := weightsByCommunity[communityID] - nodeDegree*communityTotals[communityID]/doubleTotalWeight
					if gain > bestGain+1e-9 {
						bestGain = gain
						bestCommunity = communityID
					}
				}
				assignments[nodeID] = bestCommunity
				communityTotals[bestCommunity] += nodeDegree
				if bestCommunity != current {
					moved = true
				}
			}
			if !moved {
				break
			}
		}
	}

	groups := map[int][]string{}
	for _, nodeID := range ids {
		communityID := assignments[nodeID]
		groups[communityID] = append(groups[communityID], nodeID)
	}
	groupIDs := make([]int, 0, len(groups))
	for communityID := range groups {
		groupIDs = append(groupIDs, communityID)
	}
	sort.Ints(groupIDs)

	communities := make([]knowledgeWorkspaceGraphCommunity, 0, len(groups))
	for _, communityID := range groupIDs {
		members := groups[communityID]
		memberSet := map[string]bool{}
		for _, member := range members {
			memberSet[member] = true
		}
		actualEdges := 0
		for _, edge := range edges {
			if memberSet[edge.Source] && memberSet[edge.Target] {
				actualEdges++
			}
		}
		possibleEdges := 1.0
		if len(members) > 1 {
			possibleEdges = float64(len(members)*(len(members)-1)) / 2
		}
		sort.Slice(members, func(i, j int) bool {
			leftDegree := workspaceGraphDegree(nodes[members[i]])
			rightDegree := workspaceGraphDegree(nodes[members[j]])
			if leftDegree != rightDegree {
				return leftDegree > rightDegree
			}
			return nodes[members[i]].label < nodes[members[j]].label
		})
		topNodes := make([]string, 0)
		for _, member := range members {
			if len(topNodes) >= 5 {
				break
			}
			topNodes = append(topNodes, nodes[member].label)
		}
		communities = append(communities, knowledgeWorkspaceGraphCommunity{
			ID:        communityID,
			NodeCount: len(memberSet),
			Cohesion:  math.Round((float64(actualEdges)/possibleEdges)*1000) / 1000,
			TopNodes:  topNodes,
		})
	}
	// Largest communities get the lowest ids so node.community points at the
	// displayed order instead of an incidental traversal order.
	sort.Slice(communities, func(i, j int) bool {
		if communities[i].NodeCount != communities[j].NodeCount {
			return communities[i].NodeCount > communities[j].NodeCount
		}
		return communities[i].ID < communities[j].ID
	})
	remap := map[int]int{}
	for nextID := range communities {
		oldID := communities[nextID].ID
		remap[oldID] = nextID
		communities[nextID].ID = nextID
	}
	for nodeID, oldID := range assignments {
		assignments[nodeID] = remap[oldID]
	}
	return assignments, communities
}

func buildWorkspaceGraphInsights(
	nodes []knowledgeWorkspaceGraphNode,
	edges []knowledgeWorkspaceGraphEdge,
	communities []knowledgeWorkspaceGraphCommunity,
) knowledgeWorkspaceGraphInsights {
	isolated := make([]knowledgeWorkspaceGraphInsightNode, 0)
	for _, node := range nodes {
		if len(isolated) >= 8 {
			break
		}
		if node.LinkCount <= 1 {
			isolated = append(isolated, knowledgeWorkspaceGraphInsightNode{ID: node.ID, Label: node.Label})
		}
	}
	sparse := make([]knowledgeWorkspaceGraphCommunity, 0)
	for _, community := range communities {
		if len(sparse) >= 5 {
			break
		}
		if community.Cohesion < 0.15 && community.NodeCount >= 3 {
			sparse = append(sparse, community)
		}
	}
	return knowledgeWorkspaceGraphInsights{
		IsolatedNodes:     isolated,
		SparseCommunities: sparse,
		EdgeCount:         len(edges),
	}
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func knowledgeDocumentRelativePrefixFromStorageRef(storageRef string) string {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(storageRef)))
	parent := filepath.ToSlash(filepath.Dir(clean))
	switch filepath.Base(parent) {
	case "source", "preview", "markdown", "canonical", "assets":
		return filepath.ToSlash(filepath.Dir(parent))
	default:
		return parent
	}
}

func storageRef(baseDir string, absolutePath string) (string, error) {
	if strings.TrimSpace(absolutePath) == "" {
		return "", nil
	}
	relativePath, err := filepath.Rel(baseDir, absolutePath)
	if err != nil {
		return "", fmt.Errorf("knowledge storage path must stay under %s: %w", baseDir, err)
	}
	if strings.HasPrefix(relativePath, "..") {
		return "", fmt.Errorf("knowledge storage path escaped base dir: %s", absolutePath)
	}
	return filepath.ToSlash(relativePath), nil
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
	case ".ppt", ".pptx":
		return "pptx"
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
