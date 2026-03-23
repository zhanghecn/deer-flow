from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import time

import requests

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
DEFAULT_MODEL = "doubao-seedance-1-5-pro-251215"
DEFAULT_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = 3
NETWORK_RETRY_ATTEMPTS = 3
NETWORK_RETRY_DELAY_SECONDS = 2
TERMINAL_STATUSES = {"succeeded", "failed", "cancelled", "expired"}


def load_prompt_text(prompt_file: str) -> str:
    prompt_text = Path(prompt_file).read_text(encoding="utf-8").strip()
    if not prompt_text:
        raise ValueError("Prompt file is empty")
    return prompt_text


def build_task_payload(
    prompt_text: str,
    reference_images: list[str],
    aspect_ratio: str,
    model: str = DEFAULT_MODEL,
) -> dict[str, object]:
    content: list[dict[str, object]] = [{"type": "text", "text": prompt_text}]
    content.extend(build_image_contents(reference_images))
    return {
        "model": model,
        "content": content,
        "ratio": aspect_ratio,
        "watermark": False,
    }


def build_image_contents(reference_images: list[str]) -> list[dict[str, object]]:
    if not reference_images:
        return []
    if len(reference_images) == 1:
        return [build_image_content(reference_images[0], "reference_image")]
    if len(reference_images) == 2:
        return [
            build_image_content(reference_images[0], "first_frame"),
            build_image_content(reference_images[1], "last_frame"),
        ]
    return [build_image_content(image_path, "reference_image") for image_path in reference_images]


def build_image_content(image_path: str, role: str) -> dict[str, object]:
    return {
        "type": "image_url",
        "image_url": {"url": encode_image_as_data_url(image_path)},
        "role": role,
    }


def encode_image_as_data_url(image_path: str) -> str:
    mime_type, _ = mimetypes.guess_type(image_path)
    if not mime_type or not mime_type.startswith("image/"):
        raise ValueError(f"Unsupported reference image type: {image_path}")
    image_bytes = Path(image_path).read_bytes()
    encoded_bytes = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded_bytes}"


def build_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def require_api_key() -> str:
    api_key = os.getenv("ARK_API_KEY")
    if not api_key:
        raise ValueError("ARK_API_KEY is not set")
    return api_key


def ensure_success(response: requests.Response, action: str) -> None:
    if response.ok:
        return
    message = extract_response_error_message(response)
    raise RuntimeError(
        f"{action} failed with status {response.status_code}: {message}"
    )


def extract_response_error_message(response: requests.Response) -> str:
    try:
        response_data = response.json()
    except ValueError:
        return response.text.strip() or "unknown error"
    if isinstance(response_data, dict):
        error = response_data.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message:
                return message
        message = response_data.get("message")
        if isinstance(message, str) and message:
            return message
    return json.dumps(response_data, ensure_ascii=False)


def get_with_network_retries(url: str, headers: dict[str, str] | None, action: str) -> requests.Response:
    last_error: requests.RequestException | None = None
    for attempt in range(1, NETWORK_RETRY_ATTEMPTS + 1):
        try:
            response = requests.get(
                url,
                headers=headers,
                timeout=DEFAULT_TIMEOUT_SECONDS,
            )
            ensure_success(response, action)
            return response
        except requests.RequestException as exc:
            last_error = exc
            if attempt == NETWORK_RETRY_ATTEMPTS:
                break
            time.sleep(NETWORK_RETRY_DELAY_SECONDS)
    raise RuntimeError(
        f"{action} failed after {NETWORK_RETRY_ATTEMPTS} network attempts: {last_error}"
    ) from last_error


def create_generation_task(payload: dict[str, object], api_key: str) -> str:
    response = requests.post(
        f"{ARK_BASE_URL}/contents/generations/tasks",
        headers=build_headers(api_key),
        json=payload,
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    ensure_success(response, "Task creation")
    response_data = response.json()
    task_id = response_data.get("id")
    if not task_id:
        raise RuntimeError(f"Ark response did not include a task id: {json.dumps(response_data, ensure_ascii=False)}")
    return str(task_id)


def get_generation_task(task_id: str, api_key: str) -> dict[str, object]:
    response = get_with_network_retries(
        f"{ARK_BASE_URL}/contents/generations/tasks/{task_id}",
        headers=build_headers(api_key),
        action="Task polling",
    )
    response_data = response.json()
    if not isinstance(response_data, dict):
        raise RuntimeError(f"Unexpected Ark task response: {response_data!r}")
    return response_data


def wait_for_task_completion(task_id: str, api_key: str) -> dict[str, object]:
    while True:
        task_data = get_generation_task(task_id, api_key)
        status = str(task_data.get("status") or "").lower()
        if status in TERMINAL_STATUSES:
            return task_data
        if not status:
            raise RuntimeError(f"Ark task response is missing status: {json.dumps(task_data, ensure_ascii=False)}")
        time.sleep(POLL_INTERVAL_SECONDS)


def extract_error_message(task_data: dict[str, object]) -> str:
    error = task_data.get("error")
    if error is None:
        return "unknown error"
    if isinstance(error, str):
        return error
    return json.dumps(error, ensure_ascii=False)


def extract_video_url(task_data: dict[str, object]) -> str:
    content = task_data.get("content")
    if not isinstance(content, dict):
        raise RuntimeError(f"Ark task response is missing content: {json.dumps(task_data, ensure_ascii=False)}")
    video_url = content.get("video_url")
    if not isinstance(video_url, str) or not video_url:
        raise RuntimeError(f"Ark task response is missing content.video_url: {json.dumps(task_data, ensure_ascii=False)}")
    return video_url


def download_video(video_url: str, output_file: str) -> None:
    response = get_with_network_retries(video_url, headers=None, action="Video download")
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(response.content)


def generate_video(
    prompt_file: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str = "16:9",
    model: str = DEFAULT_MODEL,
) -> str:
    prompt_text = load_prompt_text(prompt_file)
    payload = build_task_payload(prompt_text, reference_images, aspect_ratio, model=model)
    api_key = require_api_key()
    task_id = create_generation_task(payload, api_key)
    task_data = wait_for_task_completion(task_id, api_key)
    status = str(task_data.get("status") or "").lower()
    if status != "succeeded":
        error_message = extract_error_message(task_data)
        raise RuntimeError(f"Video generation failed with status '{status}': {error_message}")
    download_video(extract_video_url(task_data), output_file)
    return f"The video has been generated successfully to {output_file}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate videos using Volcengine Ark")
    parser.add_argument(
        "--prompt-file",
        required=True,
        help="Absolute path to the JSON prompt file",
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
        help="Output path for the generated video",
    )
    parser.add_argument(
        "--aspect-ratio",
        default="16:9",
        help="Aspect ratio of the generated video",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Ark content generation model ID",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        print(
            generate_video(
                args.prompt_file,
                args.reference_images,
                args.output_file,
                args.aspect_ratio,
                model=args.model,
            )
        )
    except Exception as exc:
        print(f"Error while generating video: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
