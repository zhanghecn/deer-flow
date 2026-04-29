"""Helpers for preparing local image bytes for multimodal model input."""

from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

try:
    from PIL import Image, UnidentifiedImageError
except ImportError:  # pragma: no cover - optional dependency fallback
    Image = None
    UnidentifiedImageError = OSError

if TYPE_CHECKING:
    from PIL.Image import Image as PILImage
else:
    PILImage = object

logger = logging.getLogger(__name__)

MODEL_IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024
MODEL_IMAGE_TARGET_RAW_BYTES = (MODEL_IMAGE_MAX_BASE64_BYTES * 3) // 4
MODEL_IMAGE_MAX_DIMENSION = 2000
MODEL_IMAGE_JPEG_QUALITIES = (82, 68, 52, 36, 24)


@dataclass(frozen=True)
class PreparedModelImage:
    """Model-ready image bytes plus safe metadata for traces and prompts."""

    data: bytes
    mime_type: str
    original_bytes: int
    prepared_bytes: int
    original_width: int | None = None
    original_height: int | None = None
    display_width: int | None = None
    display_height: int | None = None
    resized: bool = False
    jpeg_quality: int | None = None


def base64_size(data: bytes) -> int:
    """Return the encoded size that model APIs enforce for image blocks."""
    return len(base64.b64encode(data))


def normalize_image_mime_type(
    format_name: str | None,
    fallback: str | None = None,
) -> str:
    """Normalize image formats to MIME strings accepted by model adapters."""
    if format_name:
        normalized = format_name.lower()
        if normalized == "jpg":
            normalized = "jpeg"
        return f"image/{normalized}"
    if fallback and fallback.startswith("image/"):
        return "image/jpeg" if fallback == "image/jpg" else fallback
    return "image/png"


def _image_has_alpha(image: PILImage) -> bool:
    return image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info)


def _image_resampling_filter() -> int | None:
    if Image is None:
        return None
    resampling = getattr(Image, "Resampling", None)
    if resampling is not None:
        return int(resampling.LANCZOS)
    return int(Image.LANCZOS)


def _encode_png(image: PILImage) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True, compress_level=9)
    return buffer.getvalue()


def _encode_jpeg(image: PILImage, *, quality: int) -> bytes:
    if _image_has_alpha(image):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        image = background
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", optimize=True, quality=quality)
    return buffer.getvalue()


def _prepared(
    *,
    data: bytes,
    mime_type: str,
    original_bytes: int,
    original_size: tuple[int, int] | None = None,
    prepared_size: tuple[int, int] | None = None,
    resized: bool = False,
    quality: int | None = None,
) -> PreparedModelImage:
    original_width = original_height = None
    display_width = display_height = None
    if original_size is not None:
        original_width, original_height = original_size
    if prepared_size is not None:
        display_width, display_height = prepared_size
    return PreparedModelImage(
        data=data,
        mime_type=mime_type,
        original_bytes=original_bytes,
        prepared_bytes=len(data),
        original_width=original_width,
        original_height=original_height,
        display_width=display_width,
        display_height=display_height,
        resized=resized,
        jpeg_quality=quality,
    )


def _opaque_image_if_small(data: bytes, mime_type: str) -> PreparedModelImage | None:
    """Return undecoded bytes only when they are already safe for model input."""
    if base64_size(data) > MODEL_IMAGE_MAX_BASE64_BYTES:
        return None
    return _prepared(
        data=data,
        mime_type=normalize_image_mime_type(None, mime_type),
        original_bytes=len(data),
    )


def _fits_without_reencoding(data: bytes, image: PILImage) -> bool:
    """Check the fast path before spending CPU on resize/compression."""
    return (
        base64_size(data) <= MODEL_IMAGE_MAX_BASE64_BYTES
        and len(data) <= MODEL_IMAGE_TARGET_RAW_BYTES
        and image.width <= MODEL_IMAGE_MAX_DIMENSION
        and image.height <= MODEL_IMAGE_MAX_DIMENSION
    )


def prepare_image_bytes_for_model(  # noqa: C901, PLR0911 - early returns encode safety decisions.
    data: bytes,
    mime_type: str,
    *,
    source_name: str = "image",
) -> PreparedModelImage | None:
    """Downsample image bytes before they are sent as model content.

    The limits mirror the public Claude Code client-side policy: keep base64
    below the hard request limit, target roughly 3.75 MB raw bytes, and avoid
    dimensions above 2000 px. Invalid-but-small bytes are passed through so
    filesystem tests and unusual image encoders do not fail unnecessarily.
    """
    if Image is None:
        passthrough = _opaque_image_if_small(data, mime_type)
        if passthrough is not None:
            return passthrough
        logger.warning("Skipping %s: Pillow is unavailable for compression", source_name)
        return None

    try:
        opened_context = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError):
        passthrough = _opaque_image_if_small(data, mime_type)
        if passthrough is not None:
            return passthrough
        logger.warning("Skipping %s: image could not be decoded for compression", source_name)
        return None

    with opened_context as opened:
        normalized_mime = normalize_image_mime_type(opened.format, mime_type)
        original_size = opened.size
        if _fits_without_reencoding(data, opened):
            return _prepared(
                data=data,
                mime_type=normalized_mime,
                original_bytes=len(data),
                original_size=original_size,
                prepared_size=original_size,
            )

        resized = opened.copy()
        resized.thumbnail(
            (MODEL_IMAGE_MAX_DIMENSION, MODEL_IMAGE_MAX_DIMENSION),
            _image_resampling_filter(),
        )

        candidates: list[tuple[bytes, str, int | None]] = []
        if normalized_mime == "image/png" or _image_has_alpha(resized):
            candidates.append((_encode_png(resized), "image/png", None))
        candidates.extend((_encode_jpeg(resized, quality=quality), "image/jpeg", quality) for quality in MODEL_IMAGE_JPEG_QUALITIES)

        smallest: tuple[bytes, str, int | None] | None = None
        for candidate in candidates:
            if smallest is None or len(candidate[0]) < len(smallest[0]):
                smallest = candidate
            if base64_size(candidate[0]) <= MODEL_IMAGE_MAX_BASE64_BYTES:
                return _prepared(
                    data=candidate[0],
                    mime_type=candidate[1],
                    original_bytes=len(data),
                    original_size=original_size,
                    prepared_size=resized.size,
                    resized=resized.size != original_size or len(candidate[0]) != len(data),
                    quality=candidate[2],
                )

        smaller = resized.copy()
        smaller.thumbnail((1000, 1000), _image_resampling_filter())
        compressed = _encode_jpeg(smaller, quality=MODEL_IMAGE_JPEG_QUALITIES[-1])
        if base64_size(compressed) > MODEL_IMAGE_MAX_BASE64_BYTES:
            logger.warning("Skipping %s: compressed image still exceeds model limit", source_name)
            return None
        return _prepared(
            data=compressed,
            mime_type="image/jpeg",
            original_bytes=len(data),
            original_size=original_size,
            prepared_size=smaller.size,
            resized=True,
            quality=MODEL_IMAGE_JPEG_QUALITIES[-1],
        )
