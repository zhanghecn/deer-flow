package handler

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/uploadutil"
	"github.com/openagents/gateway/pkg/storage"
)

type UploadsHandler struct {
	fs *storage.FS
}

func NewUploadsHandler(fs *storage.FS) *UploadsHandler {
	return &UploadsHandler{fs: fs}
}

func isMarkdownConvertible(filename string) bool {
	return uploadutil.IsMarkdownConvertible(filename)
}

func markdownCompanionName(filename string) string {
	return uploadutil.MarkdownCompanionName(filename)
}

func originalConvertibleName(markdownFilename string, available map[string]os.DirEntry) string {
	return uploadutil.OriginalConvertibleName(markdownFilename, available)
}

func convertFileToMarkdown(filePath string) (string, error) {
	return uploadutil.ConvertFileToMarkdown(filePath)
}

func markitdownBinary() (string, error) {
	return uploadutil.MarkitdownBinary()
}

func uploadResponseFile(threadID string, name string, size int64, markdownName string) gin.H {
	file := gin.H{
		"filename":     name,
		"size":         size,
		"virtual_path": fmt.Sprintf("/mnt/user-data/uploads/%s", name),
		"artifact_url": fmt.Sprintf("/api/threads/%s/artifacts/mnt/user-data/uploads/%s", threadID, name),
	}
	if markdownName != "" {
		file["markdown_file"] = markdownName
		file["markdown_virtual_path"] = fmt.Sprintf("/mnt/user-data/uploads/%s", markdownName)
		file["markdown_artifact_url"] = fmt.Sprintf("/api/threads/%s/artifacts/mnt/user-data/uploads/%s", threadID, markdownName)
	}
	return file
}

func (h *UploadsHandler) Upload(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}
	threadID := c.Param("id")
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing thread id"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid multipart form"})
		return
	}

	uploadsDir := filepath.Join(h.fs.ThreadUserDataDirForUser(userID.String(), threadID), "uploads")
	_ = os.MkdirAll(uploadsDir, 0755)

	files := form.File["files"]
	var uploadedFiles []gin.H
	for _, f := range files {
		// Sanitize filename
		name := filepath.Base(f.Filename)
		if name == "." || name == ".." {
			continue
		}
		dst := filepath.Join(uploadsDir, name)
		if err := c.SaveUploadedFile(f, dst); err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: fmt.Sprintf("failed to save %s", name)})
			return
		}
		info, _ := os.Stat(dst)

		markdownName := ""
		if isMarkdownConvertible(name) {
			markdownPath, convertErr := uploadutil.ConvertFileToMarkdown(dst)
			if convertErr != nil {
				log.Printf("uploads: failed to convert %s to markdown: %v", name, convertErr)
			} else {
				markdownName = filepath.Base(markdownPath)
			}
		}

		uploadedFiles = append(uploadedFiles, uploadResponseFile(threadID, name, info.Size(), markdownName))
	}
	if uploadedFiles == nil {
		uploadedFiles = []gin.H{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"files":   uploadedFiles,
		"message": fmt.Sprintf("Successfully uploaded %d file(s)", len(uploadedFiles)),
	})
}

func (h *UploadsHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}
	threadID := c.Param("id")
	uploadsDir := filepath.Join(h.fs.ThreadUserDataDirForUser(userID.String(), threadID), "uploads")

	entries, err := os.ReadDir(uploadsDir)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, gin.H{"files": []gin.H{}, "count": 0})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list uploads"})
		return
	}

	var files []gin.H
	fileIndex := make(map[string]os.DirEntry, len(entries))
	for _, entry := range entries {
		fileIndex[entry.Name()] = entry
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, _ := e.Info()
		name := e.Name()
		if strings.EqualFold(filepath.Ext(name), ".md") && originalConvertibleName(name, fileIndex) != "" {
			continue
		}

		markdownName := ""
		if isMarkdownConvertible(name) {
			companion := markdownCompanionName(name)
			if _, ok := fileIndex[companion]; ok {
				markdownName = companion
			}
		}

		file := uploadResponseFile(threadID, name, info.Size(), markdownName)
		file["extension"] = filepath.Ext(name)
		file["modified"] = info.ModTime().Unix()
		files = append(files, file)
	}
	if files == nil {
		files = []gin.H{}
	}
	c.JSON(http.StatusOK, gin.H{"files": files, "count": len(files)})
}

func (h *UploadsHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}
	threadID := c.Param("id")
	filename := c.Param("filename")
	if filename == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing filename"})
		return
	}

	// Prevent path traversal
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid filename"})
		return
	}

	path := filepath.Join(h.fs.ThreadUserDataDirForUser(userID.String(), threadID), "uploads", filename)
	if err := os.Remove(path); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "file not found"})
		return
	}

	if isMarkdownConvertible(filename) {
		companionPath := filepath.Join(h.fs.ThreadUserDataDirForUser(userID.String(), threadID), "uploads", markdownCompanionName(filename))
		if err := os.Remove(companionPath); err != nil && !os.IsNotExist(err) {
			log.Printf("uploads: failed to remove markdown companion for %s: %v", filename, err)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("Deleted %s", filename)})
}
