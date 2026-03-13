#!/usr/bin/env python3

import argparse
import base64
import io
import json
import mimetypes
import os
from pathlib import Path

import requests
from PIL import Image

DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODEL = "doubao-seedream-5.0-lite"
API_KEY_ENV_NAMES = ("ARK_API_KEY", "VOLCENGINE_API_KEY")
BASE_URL_ENV_NAMES = ("ARK_API_BASE_URL", "VOLCENGINE_API_BASE_URL")
MODEL_ENV_NAMES = ("VOLCENGINE_IMAGE_MODEL", "ARK_IMAGE_MODEL")
MODEL_PREFIX_ALIASES = {
    "doubao-seedream-5.0-lite": "doubao-seedream-5-0",
    "doubao-seedream-5.0": "doubao-seedream-5-0",
    "doubao-seedream-4.5": "doubao-seedream-4-5",
    "doubao-seedream-4.0": "doubao-seedream-4-0",
}


class ArkAPIError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code


def load_env_file() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        load_dotenv = None

    seen: set[Path] = set()
    start_points = [Path.cwd(), Path(__file__).resolve().parent]

    for start in start_points:
        parents = [start, *start.parents]
        for parent in parents:
            env_path = parent / ".env"
            if env_path in seen or not env_path.is_file():
                continue
            seen.add(env_path)
            if load_dotenv is not None:
                load_dotenv(env_path, override=False)
                continue
            load_env_file_fallback(env_path)


def load_env_file_fallback(env_path: Path) -> None:
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def get_env_value(names: tuple[str, ...], default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


def should_use_system_proxy() -> bool:
    return os.getenv("ARK_USE_SYSTEM_PROXY", "").strip().lower() in {"1", "true", "yes", "on"}


def create_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = should_use_system_proxy()
    return session


def normalize_model_name(value: str) -> str:
    return "".join(char for char in value.lower() if char.isalnum())


def validate_image(image_path: str) -> bool:
    try:
        with Image.open(image_path) as img:
            img.verify()
        with Image.open(image_path) as img:
            img.load()
        return True
    except Exception as exc:
        print(f"Warning: Image '{image_path}' is invalid or corrupted: {exc}")
        return False


def load_prompt_text(prompt_file: str, aspect_ratio: str) -> str:
    raw_prompt = Path(prompt_file).read_text(encoding="utf-8").strip()
    if not raw_prompt:
        raise ValueError("Prompt file is empty")

    try:
        prompt_payload = json.loads(raw_prompt)
    except json.JSONDecodeError:
        prompt_text = raw_prompt
    else:
        prompt_text = render_prompt_payload(prompt_payload)

    if aspect_ratio:
        prompt_text = f"{prompt_text}\nTarget aspect ratio: {aspect_ratio}."
    return prompt_text


def render_prompt_payload(prompt_payload: object) -> str:
    if not isinstance(prompt_payload, dict):
        return json.dumps(prompt_payload, ensure_ascii=False)

    lines: list[str] = []
    used_keys: set[str] = set()

    prompt = stringify_value(prompt_payload.get("prompt"))
    if prompt:
        lines.append(prompt)
        used_keys.add("prompt")

    ordered_keys = [
        "characters",
        "character",
        "subject",
        "scene",
        "style",
        "composition",
        "lighting",
        "color_palette",
        "camera",
        "background",
        "technical",
    ]
    for key in ordered_keys:
        value = stringify_value(prompt_payload.get(key))
        if not value:
            continue
        used_keys.add(key)
        label = key.replace("_", " ").title()
        lines.append(f"{label}: {value}")

    negative_prompt = stringify_value(prompt_payload.get("negative_prompt"))
    if negative_prompt:
        lines.append(f"Avoid: {negative_prompt}")
        used_keys.add("negative_prompt")

    for key, value in prompt_payload.items():
        if key in used_keys:
            continue
        rendered = stringify_value(value)
        if rendered:
            label = key.replace("_", " ").title()
            lines.append(f"{label}: {rendered}")

    return "\n".join(lines) if lines else json.dumps(prompt_payload, ensure_ascii=False)


def stringify_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def select_reference_image(reference_images: list[str]) -> str | None:
    valid_images = [image for image in reference_images if validate_image(image)]
    if not valid_images:
        return None
    if len(valid_images) < len(reference_images):
        skipped = len(reference_images) - len(valid_images)
        print(f"Note: skipped {skipped} invalid reference image(s).")
    if len(valid_images) > 1:
        print(
            "Note: doubao-seedream-5.0-lite image editing accepts a single input image; "
            "using the first valid reference image."
        )
    return valid_images[0]


def encode_image(image_path: str, *, as_data_url: bool) -> str:
    image_bytes = Path(image_path).read_bytes()
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    if not as_data_url:
        return encoded

    mime_type, _ = mimetypes.guess_type(image_path)
    if not mime_type:
        mime_type = "image/png"
    return f"data:{mime_type};base64,{encoded}"


def build_payload(
    prompt_text: str,
    model: str,
    encoded_image: str | None = None,
) -> dict[str, str]:
    payload = {
        "model": model,
        "prompt": prompt_text,
        "response_format": "b64_json",
    }
    if encoded_image:
        payload["image"] = encoded_image
    return payload


def call_ark_api(
    payload: dict[str, str],
    *,
    api_key: str,
    base_url: str,
) -> dict:
    endpoint = f"{base_url.rstrip('/')}/images/generations"
    with create_session() as session:
        response = session.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=180,
        )

    if response.ok:
        return response.json()

    try:
        error_payload = response.json()
    except ValueError:
        error_payload = response.text

    error_code, error_message = extract_error_details(error_payload)
    raise ArkAPIError(
        f"Ark API request failed with status {response.status_code}: {error_message}",
        status_code=response.status_code,
        error_code=error_code,
    )


def fetch_models_catalog(api_key: str, base_url: str) -> list[dict]:
    endpoint = f"{base_url.rstrip('/')}/models"
    with create_session() as session:
        response = session.get(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=60,
        )

    if not response.ok:
        return []

    payload = response.json()
    data = payload.get("data")
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def resolve_model_identifier(requested_model: str, api_key: str, base_url: str) -> str:
    if requested_model.startswith("ep-"):
        return requested_model

    catalog = fetch_models_catalog(api_key, base_url)
    if not catalog:
        return requested_model

    image_models = [model for model in catalog if is_image_generation_model(model)]
    if not image_models:
        return requested_model

    exact_match = find_model_match(image_models, requested_model)
    if exact_match:
        return exact_match

    alias_prefix = MODEL_PREFIX_ALIASES.get(requested_model.lower())
    if alias_prefix:
        aliased_model = find_latest_model_with_prefix(image_models, alias_prefix)
        if aliased_model:
            print(
                f"Note: resolved model alias '{requested_model}' to catalog model "
                f"'{aliased_model}'."
            )
            return aliased_model

    if requested_model == DEFAULT_MODEL:
        latest_seedream = find_latest_model_with_prefix(image_models, "doubao-seedream")
        if latest_seedream:
            print(
                f"Note: model '{requested_model}' is not present in the current catalog; "
                f"falling back to '{latest_seedream}'."
            )
            return latest_seedream

    return requested_model


def is_image_generation_model(model: dict) -> bool:
    domain = str(model.get("domain", ""))
    task_types = model.get("task_type", [])
    if domain == "ImageGeneration":
        return True
    if isinstance(task_types, list):
        return "TextToImage" in task_types or "ImageToImage" in task_types
    return False


def find_model_match(models: list[dict], requested_model: str) -> str | None:
    normalized_requested = normalize_model_name(requested_model)
    for model in models:
        model_id = str(model.get("id", "")).strip()
        model_name = str(model.get("name", "")).strip()
        if requested_model in {model_id, model_name}:
            return model_id
        if normalized_requested and (
            normalized_requested == normalize_model_name(model_id)
            or normalized_requested == normalize_model_name(model_name)
        ):
            return model_id
    return None


def find_latest_model_with_prefix(models: list[dict], prefix: str) -> str | None:
    prefix = prefix.lower()
    candidates = []
    for model in models:
        model_id = str(model.get("id", "")).strip()
        model_name = str(model.get("name", "")).strip()
        if model_id.lower().startswith(prefix) or model_name.lower().startswith(prefix):
            candidates.append(model)

    if not candidates:
        return None

    latest = max(
        candidates,
        key=lambda item: (int(item.get("created", 0) or 0), str(item.get("id", ""))),
    )
    return str(latest.get("id", "")).strip() or None


def extract_error_details(error_payload: object) -> tuple[str | None, str]:
    if isinstance(error_payload, dict):
        error = error_payload.get("error")
        if isinstance(error, dict):
            error_code = error.get("code")
            message = error.get("message") or error.get("type")
            if message:
                return str(error_code) if error_code else None, str(message)
        message = error_payload.get("message")
        if message:
            return None, str(message)
        return None, json.dumps(error_payload, ensure_ascii=False)
    return None, str(error_payload)


def should_retry_with_data_url(error: ArkAPIError) -> bool:
    if error.status_code != 400:
        return False

    text = str(error).lower()
    if "image" not in text:
        return False
    return "base64" in text or "format" in text or "data url" in text or "mime" in text


def request_generation(
    *,
    prompt_text: str,
    model: str,
    api_key: str,
    base_url: str,
    reference_image: str | None,
) -> dict:
    if not reference_image:
        return call_ark_api(
            build_payload(prompt_text, model),
            api_key=api_key,
            base_url=base_url,
        )

    attempts = [
        encode_image(reference_image, as_data_url=False),
        encode_image(reference_image, as_data_url=True),
    ]
    last_error: ArkAPIError | None = None

    for index, encoded_image in enumerate(attempts, start=1):
        try:
            return call_ark_api(
                build_payload(prompt_text, model, encoded_image),
                api_key=api_key,
                base_url=base_url,
            )
        except ArkAPIError as exc:
            last_error = exc
            if index < len(attempts) and should_retry_with_data_url(exc):
                print(
                    "Note: raw Base64 image payload was rejected by Ark API; "
                    "retrying with a data URL payload."
                )
                continue
            break

    if last_error is None:
        raise ArkAPIError("Ark API request failed before an error could be captured")
    raise last_error


def decode_response_image(response_payload: dict) -> bytes:
    data = response_payload.get("data")
    if not isinstance(data, list) or not data:
        raise ArkAPIError("Ark API response did not contain image data")

    image_item = data[0]
    if not isinstance(image_item, dict):
        raise ArkAPIError("Ark API response image payload is malformed")

    base64_image = image_item.get("b64_json")
    if isinstance(base64_image, str) and base64_image:
        return base64.b64decode(base64_image)

    image_url = image_item.get("url")
    if isinstance(image_url, str) and image_url:
        with create_session() as session:
            response = session.get(image_url, timeout=180)
            response.raise_for_status()
            return response.content

    raise ArkAPIError("Ark API response did not include b64_json or url")


def save_image(image_bytes: bytes, output_file: str) -> None:
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    output_format = infer_output_format(output_path.suffix)
    if not output_format:
        output_path.write_bytes(image_bytes)
    else:
        with Image.open(io.BytesIO(image_bytes)) as image:
            save_image_with_format(image, output_path, output_format)

    if not validate_image(str(output_path)):
        raise ArkAPIError(f"Generated file is not a valid image: {output_path}")


def infer_output_format(suffix: str) -> str | None:
    normalized = suffix.lower()
    if normalized in {".jpg", ".jpeg"}:
        return "JPEG"
    if normalized == ".png":
        return "PNG"
    if normalized == ".webp":
        return "WEBP"
    return None


def save_image_with_format(image: Image.Image, output_path: Path, output_format: str) -> None:
    image_to_save = image
    if output_format == "JPEG" and image.mode not in {"RGB", "L"}:
        image_to_save = image.convert("RGB")
    image_to_save.save(output_path, format=output_format)


def generate_image(
    prompt_file: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str = "16:9",
    model: str | None = None,
) -> str:
    load_env_file()

    api_key = get_env_value(API_KEY_ENV_NAMES)
    if not api_key:
        expected = " or ".join(API_KEY_ENV_NAMES)
        raise ArkAPIError(f"{expected} is not set")

    base_url = get_env_value(BASE_URL_ENV_NAMES, DEFAULT_BASE_URL)
    requested_model = model or get_env_value(MODEL_ENV_NAMES, DEFAULT_MODEL)
    resolved_model = resolve_model_identifier(requested_model, api_key, base_url)
    prompt_text = load_prompt_text(prompt_file, aspect_ratio)
    reference_image = select_reference_image(reference_images)

    response_payload = request_generation(
        prompt_text=prompt_text,
        model=resolved_model,
        api_key=api_key,
        base_url=base_url,
        reference_image=reference_image,
    )
    image_bytes = decode_response_image(response_payload)
    save_image(image_bytes, output_file)

    mode = "image-to-image" if reference_image else "text-to-image"
    return f"Successfully generated {mode} output to {output_file}"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate images using Volcengine Ark")
    parser.add_argument(
        "--prompt-file",
        required=True,
        help="Absolute path to a JSON or text prompt file",
    )
    parser.add_argument(
        "--reference-images",
        nargs="*",
        default=[],
        help="Absolute paths to reference images (space-separated)",
    )
    parser.add_argument(
        "--output-file",
        required=True,
        help="Output path for the generated image",
    )
    parser.add_argument(
        "--aspect-ratio",
        default="16:9",
        help="Desired aspect ratio, appended to the prompt for compatibility",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"Ark image model name (default: {DEFAULT_MODEL})",
    )

    args = parser.parse_args()

    try:
        print(
            generate_image(
                args.prompt_file,
                args.reference_images,
                args.output_file,
                args.aspect_ratio,
                args.model,
            )
        )
    except Exception as exc:
        print(f"Error while generating image: {exc}")
