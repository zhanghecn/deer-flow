package handler

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

var markdownConvertibleExtensions = map[string]struct{}{
	".pdf":  {},
	".ppt":  {},
	".pptx": {},
	".xls":  {},
	".xlsx": {},
	".doc":  {},
	".docx": {},
}

type UploadsHandler struct {
	fs *storage.FS
}

func NewUploadsHandler(fs *storage.FS) *UploadsHandler {
	return &UploadsHandler{fs: fs}
}

func isMarkdownConvertible(filename string) bool {
	_, ok := markdownConvertibleExtensions[strings.ToLower(filepath.Ext(filename))]
	return ok
}

func markdownCompanionName(filename string) string {
	return strings.TrimSuffix(filename, filepath.Ext(filename)) + ".md"
}

func originalConvertibleName(markdownFilename string, available map[string]os.DirEntry) string {
	stem := strings.TrimSuffix(markdownFilename, filepath.Ext(markdownFilename))
	for extension := range markdownConvertibleExtensions {
		candidate := stem + extension
		if _, ok := available[candidate]; ok {
			return candidate
		}
	}
	return ""
}

func markitdownBinary() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("OPENAGENTS_MARKITDOWN_BIN")); configured != "" {
		return configured, nil
	}
	return exec.LookPath("markitdown")
}

func convertFileToMarkdown(filePath string) (string, error) {
	binary, err := markitdownBinary()
	if err != nil {
		return "", fmt.Errorf("resolve markitdown binary: %w", err)
	}

	markdownPath := strings.TrimSuffix(filePath, filepath.Ext(filePath)) + ".md"
	command := exec.Command(binary, filePath, "-o", markdownPath)
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("markitdown conversion failed: %w: %s", err, strings.TrimSpace(string(output)))
	}

	return markdownPath, nil
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

	uploadsDir := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads")
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
			markdownPath, convertErr := convertFileToMarkdown(dst)
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
	threadID := c.Param("id")
	uploadsDir := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads")

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

	path := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads", filename)
	if err := os.Remove(path); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "file not found"})
		return
	}

	if isMarkdownConvertible(filename) {
		companionPath := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads", markdownCompanionName(filename))
		if err := os.Remove(companionPath); err != nil && !os.IsNotExist(err) {
			log.Printf("uploads: failed to remove markdown companion for %s: %v", filename, err)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("Deleted %s", filename)})
}
