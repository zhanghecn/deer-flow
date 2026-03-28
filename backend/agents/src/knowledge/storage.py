from __future__ import annotations

import io
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from src.config.paths import Paths, get_paths


_PACKAGE_SUBDIR_NAMES = frozenset({"source", "preview", "markdown", "canonical", "index", "assets"})


@dataclass(frozen=True)
class _ParsedStorageRef:
    scheme: str
    bucket: str | None
    key: str


class KnowledgeAssetStore:
    def __init__(self, paths: Paths | None = None) -> None:
        self._paths = paths or get_paths()
        backend = os.getenv("KNOWLEDGE_OBJECT_STORE", "filesystem").strip().lower()
        if backend in {"", "filesystem", "fs", "local"}:
            self._backend = "filesystem"
        elif backend in {"minio", "s3"}:
            self._backend = "s3"
        else:
            raise ValueError(f"Unsupported KNOWLEDGE_OBJECT_STORE backend: {backend}")

        self._cache_dir = self._paths.base_dir / ".knowledge-cache"
        self._client = None
        self._bucket: str | None = None
        self._bucket_checked = False
        if self._backend == "s3":
            self._s3_options = self._load_s3_options()
            self._bucket = self._s3_options["bucket"]
        else:
            self._s3_options = None

    @property
    def uses_object_store(self) -> bool:
        return self._backend == "s3"

    def storage_ref_from_relative_path(self, relative_path: str) -> str:
        key = self._clean_relative_key(relative_path)
        if self._backend != "s3":
            return key
        assert self._bucket is not None
        return f"s3://{self._bucket}/{self._normalize_object_key(key)}"

    def resolve_local_path(self, storage_ref: str) -> Path:
        parsed = self._parse_storage_ref(storage_ref)
        if parsed.scheme == "filesystem":
            return self._filesystem_path(parsed.key)
        local_path = self._cache_path(parsed)
        if local_path.is_file():
            return local_path
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client = self._client_instance()
        assert parsed.bucket is not None
        client.fget_object(parsed.bucket, parsed.key, str(local_path))
        return local_path

    def prepare_local_path(self, storage_ref: str) -> Path:
        parsed = self._parse_storage_ref(storage_ref)
        if parsed.scheme == "filesystem":
            target_path = self._filesystem_path(parsed.key)
        else:
            target_path = self._cache_path(parsed)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        return target_path

    def sync_local_file(self, *, storage_ref: str, local_path: Path, content_type: str | None = None) -> Path:
        parsed = self._parse_storage_ref(storage_ref)
        if parsed.scheme == "filesystem":
            target_path = self._filesystem_path(parsed.key)
            if local_path.resolve() != target_path.resolve():
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(local_path.read_bytes())
            return target_path

        self._ensure_bucket()
        client = self._client_instance()
        assert parsed.bucket is not None
        payload = local_path.read_bytes()
        client.put_object(
            parsed.bucket,
            parsed.key,
            io.BytesIO(payload),
            len(payload),
            content_type=content_type or self._guess_content_type(local_path.name),
        )
        cache_path = self._cache_path(parsed)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        if local_path.resolve() != cache_path.resolve():
            cache_path.write_bytes(payload)
        return cache_path

    def write_bytes(
        self,
        *,
        storage_ref: str,
        payload: bytes,
        content_type: str | None = None,
    ) -> Path:
        target_path = self.prepare_local_path(storage_ref)
        target_path.write_bytes(payload)
        return self.sync_local_file(
            storage_ref=storage_ref,
            local_path=target_path,
            content_type=content_type,
        )

    def write_text(self, *, storage_ref: str, text: str, encoding: str = "utf-8") -> Path:
        return self.write_bytes(
            storage_ref=storage_ref,
            payload=text.encode(encoding),
            content_type=self._guess_content_type(storage_ref),
        )

    def read_bytes(self, storage_ref: str) -> bytes:
        return self.resolve_local_path(storage_ref).read_bytes()

    def read_text(self, storage_ref: str, encoding: str = "utf-8") -> str:
        return self.resolve_local_path(storage_ref).read_text(encoding=encoding)

    def package_root_ref(self, storage_ref: str) -> str:
        parsed = self._parse_storage_ref(storage_ref)
        parent = PurePosixPath(parsed.key).parent
        if parent.name in _PACKAGE_SUBDIR_NAMES:
            root_key = parent.parent.as_posix()
        else:
            root_key = parent.as_posix()
        return self._build_storage_ref(parsed.scheme, parsed.bucket, root_key)

    def join_package_ref(self, *, storage_ref: str, relative_path: str) -> str:
        root_ref = self.package_root_ref(storage_ref)
        parsed = self._parse_storage_ref(root_ref)
        relative_key = self._clean_relative_key(relative_path)
        joined_key = self._join_key(parsed.key, relative_key)
        return self._build_storage_ref(parsed.scheme, parsed.bucket, joined_key)

    def resolve_sibling_ref(self, *, storage_ref: str, sibling_name: str) -> str:
        parsed = self._parse_storage_ref(storage_ref)
        parent_key = PurePosixPath(parsed.key).parent.as_posix()
        sibling_key = self._join_key(parent_key, sibling_name)
        return self._build_storage_ref(parsed.scheme, parsed.bucket, sibling_key)

    def _load_s3_options(self) -> dict[str, str | bool | None]:
        raw_endpoint = os.getenv("KNOWLEDGE_S3_ENDPOINT", "").strip()
        if not raw_endpoint:
            raise RuntimeError("KNOWLEDGE_S3_ENDPOINT is required when KNOWLEDGE_OBJECT_STORE=minio.")
        parsed_endpoint = urlparse(raw_endpoint if "://" in raw_endpoint else f"http://{raw_endpoint}")
        endpoint = parsed_endpoint.netloc or parsed_endpoint.path
        secure = parsed_endpoint.scheme == "https"
        secure_override = os.getenv("KNOWLEDGE_S3_SECURE", "").strip().lower()
        if secure_override in {"1", "true", "yes", "on"}:
            secure = True
        elif secure_override in {"0", "false", "no", "off"}:
            secure = False

        access_key = os.getenv("KNOWLEDGE_S3_ACCESS_KEY", "").strip()
        secret_key = os.getenv("KNOWLEDGE_S3_SECRET_KEY", "").strip()
        bucket = os.getenv("KNOWLEDGE_S3_BUCKET", "").strip()
        if not access_key or not secret_key or not bucket:
            raise RuntimeError(
                "KNOWLEDGE_S3_ACCESS_KEY, KNOWLEDGE_S3_SECRET_KEY, and KNOWLEDGE_S3_BUCKET are required when KNOWLEDGE_OBJECT_STORE=minio."
            )
        return {
            "endpoint": endpoint,
            "secure": secure,
            "access_key": access_key,
            "secret_key": secret_key,
            "region": os.getenv("KNOWLEDGE_S3_REGION", "").strip() or None,
            "bucket": bucket,
        }

    def _client_instance(self):
        if self._client is not None:
            return self._client
        try:
            from minio import Minio
        except ImportError as exc:  # pragma: no cover - only exercised when object storage is enabled without the dependency installed.
            raise RuntimeError(
                "KNOWLEDGE_OBJECT_STORE is enabled, but the 'minio' Python package is not installed."
            ) from exc
        assert self._s3_options is not None
        self._client = Minio(
            str(self._s3_options["endpoint"]),
            access_key=str(self._s3_options["access_key"]),
            secret_key=str(self._s3_options["secret_key"]),
            secure=bool(self._s3_options["secure"]),
            region=self._s3_options["region"],
        )
        return self._client

    def _ensure_bucket(self) -> None:
        if self._backend != "s3" or self._bucket_checked:
            return
        client = self._client_instance()
        assert self._bucket is not None
        if not client.bucket_exists(self._bucket):
            client.make_bucket(self._bucket)
        self._bucket_checked = True

    def _parse_storage_ref(self, storage_ref: str) -> _ParsedStorageRef:
        ref = str(storage_ref or "").strip()
        if not ref:
            raise ValueError("Knowledge storage ref is required.")
        if ref.startswith("s3://"):
            parsed = urlparse(ref)
            bucket = parsed.netloc.strip()
            key = self._clean_relative_key(parsed.path.lstrip("/"))
            if not bucket or not key:
                raise ValueError(f"Invalid S3 knowledge storage ref: {storage_ref!r}")
            return _ParsedStorageRef(scheme="s3", bucket=bucket, key=key)

        path = Path(ref)
        if path.is_absolute():
            return _ParsedStorageRef(scheme="filesystem", bucket=None, key=str(path))
        return _ParsedStorageRef(
            scheme="filesystem",
            bucket=None,
            key=self._clean_relative_key(ref),
        )

    def _filesystem_path(self, key: str) -> Path:
        candidate = Path(key)
        if candidate.is_absolute():
            return candidate.resolve()
        return (self._paths.base_dir / key).resolve()

    def _cache_path(self, parsed: _ParsedStorageRef) -> Path:
        assert parsed.bucket is not None
        return (self._cache_dir / parsed.bucket / Path(parsed.key)).resolve()

    def _build_storage_ref(self, scheme: str, bucket: str | None, key: str) -> str:
        normalized_key = self._clean_relative_key(key)
        if scheme == "s3":
            if not bucket:
                raise ValueError("S3 storage refs require a bucket.")
            return f"s3://{bucket}/{normalized_key}"
        return normalized_key

    def _clean_relative_key(self, value: str) -> str:
        normalized = PurePosixPath(str(value).replace("\\", "/")).as_posix().lstrip("/")
        if normalized in {"", "."}:
            raise ValueError("Knowledge storage ref must not be empty.")
        if normalized == ".." or normalized.startswith("../"):
            raise ValueError("Knowledge storage ref must stay within the knowledge asset root.")
        return normalized

    def _join_key(self, base_key: str, relative_key: str) -> str:
        if base_key in {"", "."}:
            return self._clean_relative_key(relative_key)
        return self._clean_relative_key(f"{base_key.rstrip('/')}/{relative_key.lstrip('/')}")

    def _normalize_object_key(self, value: str) -> str:
        normalized = self._clean_relative_key(value)
        if not normalized.startswith("knowledge/"):
            return normalized
        trimmed = self._clean_relative_key(normalized.removeprefix("knowledge/"))
        return trimmed or normalized

    def _guess_content_type(self, file_name: str) -> str | None:
        normalized = file_name
        if normalized.startswith("s3://"):
            parsed = urlparse(normalized)
            normalized = Path(parsed.path).name
        content_type, _ = mimetypes.guess_type(normalized)
        return content_type or None


def get_knowledge_asset_store(paths: Paths | None = None) -> KnowledgeAssetStore:
    return KnowledgeAssetStore(paths=paths)


def reset_knowledge_asset_store() -> None:
    return None
