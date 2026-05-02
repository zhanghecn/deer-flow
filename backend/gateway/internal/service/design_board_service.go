package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/openagents/gateway/pkg/storage"
)

const (
	designVirtualPathPrefix   = "/mnt/user-data/outputs/designs"
	defaultDesignDocumentName = "canvas.op"
)

var emptyDesignDocument = []byte("{\n  \"version\": \"1.0.0\",\n  \"children\": []\n}\n")

var justifyContentAliases = map[string]string{
	"space-between": "space_between",
	"space-around":  "space_around",
	"flex-start":    "start",
	"flex-end":      "end",
}

var alignItemsAliases = map[string]string{
	"flex-start": "start",
	"flex-end":   "end",
}

type DesignBoardService struct {
	fs *storage.FS
}

func NewDesignBoardService(fs *storage.FS) *DesignBoardService {
	return &DesignBoardService{fs: fs}
}

func DefaultDesignDocumentVirtualPath() string {
	return designVirtualPathPrefix + "/" + defaultDesignDocumentName
}

// EnsureDocument makes the canonical thread-local design file exist under the
// user-visible outputs/designs artifact contract before any external editor
// reads it. Keeping the `.op` source under outputs lets the same file power the
// editor, artifact list, and downloads without a second mirrored copy.
func (s *DesignBoardService) EnsureDocument(userID string, threadID string, virtualPath string) (string, string, error) {
	actualPath, normalizedVirtualPath, err := s.resolveDocumentPath(userID, threadID, virtualPath)
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(actualPath), 0o755); err != nil {
		return "", "", err
	}
	if _, err := os.Stat(actualPath); os.IsNotExist(err) {
		if err := os.WriteFile(actualPath, emptyDesignDocument, 0o644); err != nil {
			return "", "", err
		}
	} else if err != nil {
		return "", "", err
	}
	return actualPath, normalizedVirtualPath, nil
}

func (s *DesignBoardService) ReadDocument(userID string, threadID string, virtualPath string) (json.RawMessage, string, string, error) {
	actualPath, normalizedVirtualPath, err := s.EnsureDocument(userID, threadID, virtualPath)
	if err != nil {
		return nil, "", "", err
	}
	data, err := os.ReadFile(actualPath)
	if err != nil {
		return nil, "", "", err
	}
	normalized, err := normalizePenDocumentJSON(data)
	if err != nil {
		return nil, "", "", err
	}
	// Reading through the board is also the migration point for older valid
	// `.op` files that were stored as one minified line. Rewriting them into the
	// canonical multiline format keeps later agent edits on the same readable
	// file shape without preserving a legacy on-disk contract.
	if string(data) != string(normalized) {
		if err := os.WriteFile(actualPath, normalized, 0o644); err != nil {
			return nil, "", "", err
		}
	}
	return json.RawMessage(normalized), documentRevision(normalized), normalizedVirtualPath, nil
}

// WriteDocument enforces optimistic concurrency so the external board and the
// runtime agent cannot silently overwrite each other's thread-local .op edits.
func (s *DesignBoardService) WriteDocument(userID string, threadID string, virtualPath string, document json.RawMessage, expectedRevision string) (string, string, error) {
	actualPath, normalizedVirtualPath, err := s.EnsureDocument(userID, threadID, virtualPath)
	if err != nil {
		return "", "", err
	}

	currentData, err := os.ReadFile(actualPath)
	if err != nil {
		return "", "", err
	}
	currentNormalized, err := normalizePenDocumentJSON(currentData)
	if err != nil {
		return "", "", err
	}
	currentRevision := documentRevision(currentNormalized)
	if trimmedExpectedRevision := strings.TrimSpace(expectedRevision); trimmedExpectedRevision != "" && trimmedExpectedRevision != currentRevision {
		return "", "", fmt.Errorf("design document revision conflict")
	}

	nextNormalized, err := normalizePenDocumentJSON(document)
	if err != nil {
		return "", "", err
	}
	if err := os.WriteFile(actualPath, nextNormalized, 0o644); err != nil {
		return "", "", err
	}
	return normalizedVirtualPath, documentRevision(nextNormalized), nil
}

func (s *DesignBoardService) resolveDocumentPath(userID string, threadID string, virtualPath string) (string, string, error) {
	normalizedVirtualPath := strings.TrimSpace(virtualPath)
	if normalizedVirtualPath == "" {
		normalizedVirtualPath = DefaultDesignDocumentVirtualPath()
	}
	if !strings.HasPrefix(normalizedVirtualPath, designVirtualPathPrefix) {
		return "", "", fmt.Errorf("path must stay under %s", designVirtualPathPrefix)
	}

	threadUserDataDir := filepath.Clean(s.fs.ThreadUserDataDirForUser(userID, threadID))
	// The design board only serves `.op` files from the dedicated outputs/designs
	// subtree so chat-visible design artifacts and editor sessions always point
	// at the same canonical thread-local document.
	designRoot := filepath.Join(threadUserDataDir, "outputs", "designs")
	relativePath := strings.TrimPrefix(normalizedVirtualPath, "/mnt/user-data")
	actualPath := filepath.Clean(filepath.Join(threadUserDataDir, relativePath))
	if actualPath != designRoot && !strings.HasPrefix(actualPath, designRoot+string(os.PathSeparator)) {
		return "", "", fmt.Errorf("access denied: design path traversal detected")
	}
	if filepath.Ext(actualPath) != ".op" {
		return "", "", fmt.Errorf("design documents must use the .op extension")
	}
	return actualPath, normalizedVirtualPath, nil
}

func normalizePenDocumentJSON(payload []byte) ([]byte, error) {
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		return nil, fmt.Errorf("invalid design document json: %w", err)
	}
	document = normalizePenDocumentObject(document)

	version, _ := document["version"].(string)
	if strings.TrimSpace(version) == "" {
		return nil, fmt.Errorf("design document must include a string version")
	}
	_, hasChildren := document["children"].([]any)
	_, hasPages := document["pages"].([]any)
	if !hasChildren && !hasPages {
		return nil, fmt.Errorf("design document must include children or pages")
	}

	// Keep the canonical `.op` file multiline on disk so agent file tools and
	// the external board can keep editing the same shared document without
	// forcing later turns to reconstruct one giant minified JSON line.
	normalized, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to serialize design document: %w", err)
	}
	return append(normalized, '\n'), nil
}

func normalizePenDocumentObject(document map[string]any) map[string]any {
	normalized := make(map[string]any, len(document))
	for key, value := range document {
		normalized[key] = value
	}

	if children, ok := normalized["children"].([]any); ok {
		normalizedChildren := make([]any, 0, len(children))
		for _, child := range children {
			normalizedChildren = append(normalizedChildren, normalizePenNode(child))
		}
		normalized["children"] = normalizedChildren
	}
	if pages, ok := normalized["pages"].([]any); ok {
		normalizedPages := make([]any, 0, len(pages))
		for _, page := range pages {
			pageMap, ok := page.(map[string]any)
			if !ok {
				normalizedPages = append(normalizedPages, page)
				continue
			}
			normalizedPage := make(map[string]any, len(pageMap))
			for key, value := range pageMap {
				normalizedPage[key] = value
			}
			if children, ok := normalizedPage["children"].([]any); ok {
				normalizedChildren := make([]any, 0, len(children))
				for _, child := range children {
					normalizedChildren = append(normalizedChildren, normalizePenNode(child))
				}
				normalizedPage["children"] = normalizedChildren
			}
			normalizedPages = append(normalizedPages, normalizedPage)
		}
		normalized["pages"] = normalizedPages
	}
	return normalized
}

func normalizePenNode(raw any) any {
	node, ok := raw.(map[string]any)
	if !ok {
		return raw
	}

	normalized := make(map[string]any, len(node))
	for key, value := range node {
		normalized[key] = value
	}

	if fill, exists := normalized["fill"]; exists {
		normalized["fill"] = normalizeFills(fill)
	}
	if stroke, exists := normalized["stroke"]; exists {
		if normalizedStroke, ok := normalizeStroke(stroke); ok {
			normalized["stroke"] = normalizedStroke
		} else {
			delete(normalized, "stroke")
		}
	}
	if effects, exists := normalized["effects"]; exists {
		normalized["effects"] = normalizeEffects(effects)
	}
	if padding, exists := normalized["padding"]; exists {
		normalized["padding"] = normalizePadding(padding)
	}
	if width, exists := normalized["width"]; exists {
		normalized["width"] = normalizeNumeric(width)
	}
	if height, exists := normalized["height"]; exists {
		normalized["height"] = normalizeNumeric(height)
	}
	if justifyContent, ok := normalized["justifyContent"].(string); ok {
		if alias, exists := justifyContentAliases[justifyContent]; exists {
			normalized["justifyContent"] = alias
		}
	}
	if alignItems, ok := normalized["alignItems"].(string); ok {
		if alias, exists := alignItemsAliases[alignItems]; exists {
			normalized["alignItems"] = alias
		}
	}
	if nodeType, ok := normalized["type"].(string); ok && nodeType == "text" {
		if _, hasContent := normalized["content"]; !hasContent {
			if text, ok := normalized["text"].(string); ok {
				normalized["content"] = text
				delete(normalized, "text")
			}
		}
	}
	if children, ok := normalized["children"].([]any); ok {
		normalizedChildren := make([]any, 0, len(children))
		for _, child := range children {
			normalizedChildren = append(normalizedChildren, normalizePenNode(child))
		}
		normalized["children"] = normalizedChildren
	}
	return normalized
}

func normalizeFills(raw any) []any {
	if raw == nil {
		return []any{}
	}

	switch value := raw.(type) {
	case []any:
		normalized := make([]any, 0, len(value))
		for _, item := range value {
			if fill, ok := normalizeSingleFill(item); ok {
				normalized = append(normalized, fill)
			}
		}
		return normalized
	default:
		fill, ok := normalizeSingleFill(value)
		if !ok {
			return []any{}
		}
		return []any{fill}
	}
}

func normalizeSingleFill(raw any) (map[string]any, bool) {
	switch value := raw.(type) {
	case string:
		if strings.TrimSpace(value) == "" {
			return nil, false
		}
		return map[string]any{
			"type":  "solid",
			"color": value,
		}, true
	case map[string]any:
		fillType, _ := value["type"].(string)
		if (fillType == "" || fillType == "color" || fillType == "solid") && value["color"] != nil {
			normalized := map[string]any{
				"type":  "solid",
				"color": fmt.Sprint(value["color"]),
			}
			if opacity, exists := value["opacity"]; exists {
				normalized["opacity"] = normalizeNumeric(opacity)
			}
			if blendMode, exists := value["blendMode"]; exists {
				normalized["blendMode"] = blendMode
			}
			return normalized, true
		}
		if fillType == "gradient" {
			gradientType, _ := value["gradientType"].(string)
			stops := normalizeGradientStops(value["colors"])
			if gradientType == "radial" {
				center, _ := value["center"].(map[string]any)
				return map[string]any{
					"type":   "radial_gradient",
					"cx":     normalizeNumeric(center["x"]),
					"cy":     normalizeNumeric(center["y"]),
					"radius": 0.5,
					"stops":  stops,
				}, true
			}
			return map[string]any{
				"type":  "linear_gradient",
				"angle": normalizeNumeric(value["rotation"]),
				"stops": stops,
			}, true
		}
		if fillType == "linear_gradient" || fillType == "radial_gradient" {
			normalized := make(map[string]any, len(value))
			for key, innerValue := range value {
				normalized[key] = innerValue
			}
			if stops, exists := value["stops"]; exists {
				normalized["stops"] = normalizeGradientStops(stops)
			} else {
				normalized["stops"] = normalizeGradientStops(value["colors"])
			}
			return normalized, true
		}
		if fillType == "image" {
			normalized := make(map[string]any, len(value))
			for key, innerValue := range value {
				normalized[key] = innerValue
			}
			return normalized, true
		}
		if color, exists := value["color"]; exists {
			return map[string]any{
				"type":  "solid",
				"color": fmt.Sprint(color),
			}, true
		}
	}
	return nil, false
}

func normalizeGradientStops(raw any) []any {
	stops, ok := raw.([]any)
	if !ok || len(stops) == 0 {
		return []any{}
	}

	normalized := make([]any, 0, len(stops))
	count := len(stops)
	for index, item := range stops {
		stop, ok := item.(map[string]any)
		if !ok {
			continue
		}
		offsetValue, hasOffset := stop["offset"]
		if !hasOffset {
			offsetValue = stop["position"]
		}
		offset, ok := toFloat64(offsetValue)
		if ok && offset > 1 {
			offset = offset / 100
		}
		if !ok {
			offset = float64(index) / float64(max(count-1, 1))
		}
		if offset < 0 {
			offset = 0
		}
		if offset > 1 {
			offset = 1
		}
		normalized = append(normalized, map[string]any{
			"offset": offset,
			"color":  fmt.Sprint(stop["color"]),
		})
	}
	return normalized
}

func normalizeStroke(raw any) (map[string]any, bool) {
	stroke, ok := raw.(map[string]any)
	if !ok {
		return nil, false
	}

	normalized := make(map[string]any, len(stroke))
	for key, value := range stroke {
		normalized[key] = value
	}

	if fill, exists := normalized["fill"]; exists {
		normalized["fill"] = normalizeFills(fill)
	} else if color, exists := normalized["color"]; exists {
		normalized["fill"] = normalizeFills(color)
		delete(normalized, "color")
	}
	if _, exists := normalized["thickness"]; !exists {
		if width, exists := normalized["width"]; exists {
			normalized["thickness"] = normalizeNumeric(width)
			delete(normalized, "width")
		}
	} else {
		normalized["thickness"] = normalizeNumeric(normalized["thickness"])
	}
	return normalized, true
}

func normalizeEffects(raw any) []any {
	effects, ok := raw.([]any)
	if !ok {
		return []any{}
	}

	normalized := make([]any, 0, len(effects))
	for _, item := range effects {
		effect, ok := item.(map[string]any)
		if !ok {
			continue
		}
		next := make(map[string]any, len(effect))
		for key, value := range effect {
			next[key] = value
		}
		effectType, _ := next["type"].(string)
		if effectType == "shadow" {
			if _, exists := next["offsetX"]; !exists {
				next["offsetX"] = 0
			}
			if _, exists := next["offsetY"]; !exists {
				next["offsetY"] = 0
			}
			if _, exists := next["spread"]; !exists {
				next["spread"] = 0
			}
		}
		if (effectType == "blur" || effectType == "background_blur") && next["radius"] == nil && next["blur"] != nil {
			next["radius"] = normalizeNumeric(next["blur"])
			delete(next, "blur")
		}
		normalized = append(normalized, next)
	}
	return normalized
}

func normalizePadding(raw any) any {
	if paddingMap, ok := raw.(map[string]any); ok {
		// Agents often emit CSS-like objects here. Convert them into the tuple
		// forms the OpenPencil renderer already understands so artifact files and
		// editor reads stay on one stable schema.
		vertical := normalizeNumeric(firstNonNil(paddingMap["vertical"], paddingMap["y"], 0))
		horizontal := normalizeNumeric(firstNonNil(paddingMap["horizontal"], paddingMap["x"], 0))
		top := normalizeNumeric(firstNonNil(paddingMap["top"], vertical))
		right := normalizeNumeric(firstNonNil(paddingMap["right"], horizontal))
		bottom := normalizeNumeric(firstNonNil(paddingMap["bottom"], vertical))
		left := normalizeNumeric(firstNonNil(paddingMap["left"], horizontal))
		if top == right && right == bottom && bottom == left {
			return top
		}
		if top == bottom && right == left {
			return []any{top, right}
		}
		return []any{top, right, bottom, left}
	}
	if paddingList, ok := raw.([]any); ok {
		normalized := make([]any, 0, len(paddingList))
		for _, item := range paddingList {
			normalized = append(normalized, normalizeNumeric(item))
		}
		return normalized
	}
	return normalizeNumeric(raw)
}

func normalizeNumeric(raw any) any {
	switch value := raw.(type) {
	case nil:
		return 0
	case float64, bool:
		return value
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || strings.HasPrefix(trimmed, "$") {
			return trimmed
		}
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return value
		}
		return parsed
	default:
		return value
	}
}

func toFloat64(raw any) (float64, bool) {
	switch value := raw.(type) {
	case float64:
		return value, true
	case int:
		return float64(value), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func documentRevision(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
