package knowledgeasset

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/url"
	"os"
	ppath "path"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var packageSubdirNames = map[string]struct{}{
	"source":    {},
	"preview":   {},
	"markdown":  {},
	"canonical": {},
	"index":     {},
	"assets":    {},
}

type parsedStorageRef struct {
	scheme string
	bucket string
	key    string
}

type Store struct {
	baseDir       string
	backend       string
	bucket        string
	client        *minio.Client
	bucketChecked bool
}

func New(baseDir string) (*Store, error) {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("KNOWLEDGE_OBJECT_STORE")))
	// Backend selection is explicit on purpose. Missing config used to silently
	// route production KB assets onto local disk, which breaks rollouts and migrations.
	if backend == "" {
		return nil, fmt.Errorf("KNOWLEDGE_OBJECT_STORE must be explicitly set to filesystem or minio")
	}
	if backend == "filesystem" {
		return &Store{baseDir: filepath.Clean(baseDir), backend: "filesystem"}, nil
	}
	if backend != "minio" {
		return nil, fmt.Errorf("unsupported KNOWLEDGE_OBJECT_STORE backend: %s", backend)
	}

	rawEndpoint := strings.TrimSpace(os.Getenv("KNOWLEDGE_S3_ENDPOINT"))
	accessKey := strings.TrimSpace(os.Getenv("KNOWLEDGE_S3_ACCESS_KEY"))
	secretKey := strings.TrimSpace(os.Getenv("KNOWLEDGE_S3_SECRET_KEY"))
	bucket := strings.TrimSpace(os.Getenv("KNOWLEDGE_S3_BUCKET"))
	if rawEndpoint == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return nil, fmt.Errorf("KNOWLEDGE_S3_ENDPOINT, KNOWLEDGE_S3_ACCESS_KEY, KNOWLEDGE_S3_SECRET_KEY, and KNOWLEDGE_S3_BUCKET are required when KNOWLEDGE_OBJECT_STORE=minio")
	}

	parsedEndpoint, err := url.Parse(rawEndpoint)
	if err != nil || parsedEndpoint.Host == "" {
		parsedEndpoint, err = url.Parse("http://" + rawEndpoint)
		if err != nil {
			return nil, fmt.Errorf("parse KNOWLEDGE_S3_ENDPOINT: %w", err)
		}
	}

	secure := strings.EqualFold(parsedEndpoint.Scheme, "https")
	switch strings.ToLower(strings.TrimSpace(os.Getenv("KNOWLEDGE_S3_SECURE"))) {
	case "1", "true", "yes", "on":
		secure = true
	case "0", "false", "no", "off":
		secure = false
	}

	client, err := minio.New(parsedEndpoint.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
		Region: strings.TrimSpace(os.Getenv("KNOWLEDGE_S3_REGION")),
	})
	if err != nil {
		return nil, fmt.Errorf("create knowledge object store client: %w", err)
	}

	return &Store{
		baseDir: filepath.Clean(baseDir),
		backend: "s3",
		bucket:  bucket,
		client:  client,
	}, nil
}

func (s *Store) UsesObjectStore() bool {
	return s.backend == "s3"
}

func (s *Store) RefForRelativePath(relativePath string) string {
	clean := cleanRelativeRef(relativePath)
	if s.backend != "s3" {
		return clean
	}
	return fmt.Sprintf("s3://%s/%s", s.bucket, normalizeObjectKey(clean))
}

func (s *Store) ReadAll(ctx context.Context, storageRef string) ([]byte, error) {
	parsed, err := s.parseStorageRef(storageRef)
	if err != nil {
		return nil, err
	}
	if parsed.scheme == "filesystem" {
		return os.ReadFile(s.filesystemPath(parsed.key))
	}
	object, err := s.client.GetObject(ctx, parsed.bucket, parsed.key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer object.Close()
	return io.ReadAll(object)
}

func (s *Store) SyncDirectory(ctx context.Context, relativePrefix string, localDir string) error {
	if s.backend != "s3" {
		return nil
	}
	if err := s.ensureBucket(ctx); err != nil {
		return err
	}
	cleanPrefix := normalizeObjectKey(relativePrefix)
	return filepath.Walk(localDir, func(currentPath string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		relPath, err := filepath.Rel(localDir, currentPath)
		if err != nil {
			return err
		}
		objectKey := joinKey(cleanPrefix, filepath.ToSlash(relPath))
		contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(currentPath)))
		_, err = s.client.FPutObject(
			ctx,
			s.bucket,
			objectKey,
			currentPath,
			minio.PutObjectOptions{ContentType: contentType},
		)
		return err
	})
}

func (s *Store) DeleteRelativePrefix(ctx context.Context, relativePrefix string) error {
	if s.backend != "s3" {
		return nil
	}
	cleanPrefix := normalizeObjectKey(relativePrefix)
	for object := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    cleanPrefix,
		Recursive: true,
	}) {
		if object.Err != nil {
			return object.Err
		}
		if err := s.client.RemoveObject(ctx, s.bucket, object.Key, minio.RemoveObjectOptions{}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ResolvePackageRelativeRef(storageRef string, relativePath string) (string, error) {
	rootRef, err := s.PackageRootRef(storageRef)
	if err != nil {
		return "", err
	}
	parsed, err := s.parseStorageRef(rootRef)
	if err != nil {
		return "", err
	}
	cleanRelativePath := cleanRelativeRef(relativePath)
	if cleanRelativePath == "" {
		return "", fmt.Errorf("asset path must stay within the knowledge document")
	}
	return s.buildStorageRef(parsed.scheme, parsed.bucket, joinKey(parsed.key, cleanRelativePath)), nil
}

func (s *Store) PackageRootRef(storageRef string) (string, error) {
	parsed, err := s.parseStorageRef(storageRef)
	if err != nil {
		return "", err
	}
	parentKey := ppath.Dir(parsed.key)
	rootKey := parentKey
	if _, ok := packageSubdirNames[ppath.Base(parentKey)]; ok {
		rootKey = ppath.Dir(parentKey)
	}
	return s.buildStorageRef(parsed.scheme, parsed.bucket, rootKey), nil
}

func (s *Store) parseStorageRef(storageRef string) (parsedStorageRef, error) {
	ref := strings.TrimSpace(storageRef)
	if ref == "" {
		return parsedStorageRef{}, fmt.Errorf("knowledge storage ref is required")
	}
	if strings.HasPrefix(ref, "s3://") {
		parsed, err := url.Parse(ref)
		if err != nil {
			return parsedStorageRef{}, fmt.Errorf("parse s3 storage ref: %w", err)
		}
		bucket := strings.TrimSpace(parsed.Host)
		key := cleanRelativeRef(strings.TrimPrefix(parsed.Path, "/"))
		if bucket == "" || key == "" {
			return parsedStorageRef{}, fmt.Errorf("invalid s3 storage ref: %s", storageRef)
		}
		return parsedStorageRef{scheme: "s3", bucket: bucket, key: key}, nil
	}
	if filepath.IsAbs(ref) {
		return parsedStorageRef{}, fmt.Errorf("filesystem knowledge storage refs must be relative to OPENAGENTS_HOME")
	}
	return parsedStorageRef{scheme: "filesystem", key: cleanRelativeRef(ref)}, nil
}

func (s *Store) buildStorageRef(scheme string, bucket string, key string) string {
	cleanKey := cleanRelativeRef(key)
	if scheme == "s3" {
		return fmt.Sprintf("s3://%s/%s", bucket, cleanKey)
	}
	return cleanKey
}

func (s *Store) filesystemPath(key string) string {
	return filepath.Join(s.baseDir, filepath.FromSlash(filepath.Clean(key)))
}

func (s *Store) ensureBucket(ctx context.Context) error {
	if s.backend != "s3" || s.bucketChecked {
		return nil
	}
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !exists {
		if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
			return err
		}
	}
	s.bucketChecked = true
	return nil
}

func cleanRelativeRef(value string) string {
	clean := ppath.Clean(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"))
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" || clean == "." {
		return ""
	}
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return ""
	}
	return clean
}

func joinKey(base string, rel string) string {
	cleanBase := cleanRelativeRef(base)
	cleanRel := cleanRelativeRef(rel)
	if cleanBase == "" {
		return cleanRel
	}
	if cleanRel == "" {
		return cleanBase
	}
	return cleanRelativeRef(cleanBase + "/" + cleanRel)
}

func normalizeObjectKey(value string) string {
	clean := cleanRelativeRef(value)
	trimmedLegacyPrefix := strings.TrimPrefix(clean, "knowledge/")
	if trimmedLegacyPrefix == clean {
		return clean
	}
	normalized := cleanRelativeRef(trimmedLegacyPrefix)
	if normalized == "" {
		return clean
	}
	return normalized
}
