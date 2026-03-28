"""Middleware for injecting image details into conversation before LLM call."""

import json
import logging

from typing import Annotated, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.runtime import Runtime

from src.agents.thread_state import ViewedImageData, merge_viewed_images

logger = logging.getLogger(__name__)
_KNOWLEDGE_IMAGE_PREFIX = "/mnt/user-data/outputs/.knowledge/"
_MAX_EVIDENCE_CITATIONS = 6
_MAX_EVIDENCE_IMAGES = 4


class ViewImageMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]


class ViewImageMiddleware(AgentMiddleware[ViewImageMiddlewareState]):
    """Injects image details as a human message before LLM calls when view_image tools have completed.

    This middleware:
    1. Runs before each LLM call
    2. Checks if the last assistant message contains view_image tool calls
    3. Verifies all tool calls in that message have been completed (have corresponding ToolMessages)
    4. If conditions are met, creates a human message with all viewed image details (including base64 data)
    5. Adds the message to state so the LLM can see and analyze the images

    This enables the LLM to automatically receive and analyze images that were loaded via view_image tool,
    without requiring explicit user prompts to describe the images.
    """

    state_schema = ViewImageMiddlewareState

    def _get_last_assistant_message(self, messages: list) -> AIMessage | None:
        """Get the last assistant message from the message list.

        Args:
            messages: List of messages

        Returns:
            Last AIMessage or None if not found
        """
        for msg in reversed(messages):
            if isinstance(msg, AIMessage):
                return msg
        return None

    def _has_view_image_tool(self, message: AIMessage) -> bool:
        """Check if the assistant message contains view_image tool calls.

        Args:
            message: Assistant message to check

        Returns:
            True if message contains view_image tool calls
        """
        if not hasattr(message, "tool_calls") or not message.tool_calls:
            return False

        return any(tool_call.get("name") == "view_image" for tool_call in message.tool_calls)

    def _all_tools_completed(self, messages: list, assistant_msg: AIMessage) -> bool:
        """Check if all tool calls in the assistant message have been completed.

        Args:
            messages: List of all messages
            assistant_msg: The assistant message containing tool calls

        Returns:
            True if all tool calls have corresponding ToolMessages
        """
        if not hasattr(assistant_msg, "tool_calls") or not assistant_msg.tool_calls:
            return False

        # Get all tool call IDs from the assistant message
        tool_call_ids = {tool_call.get("id") for tool_call in assistant_msg.tool_calls if tool_call.get("id")}

        # Find the index of the assistant message
        try:
            assistant_idx = messages.index(assistant_msg)
        except ValueError:
            return False

        # Get all ToolMessages after the assistant message
        completed_tool_ids = set()
        for msg in messages[assistant_idx + 1 :]:
            if isinstance(msg, ToolMessage) and msg.tool_call_id:
                completed_tool_ids.add(msg.tool_call_id)

        # Check if all tool calls have been completed
        return tool_call_ids.issubset(completed_tool_ids)

    def _create_image_details_message(self, state: ViewImageMiddlewareState) -> list[str | dict]:
        """Create a formatted message with all viewed image details.

        Args:
            state: Current state containing viewed_images

        Returns:
            List of content blocks (text and images) for the HumanMessage
        """
        viewed_images = state.get("viewed_images", {})
        if not viewed_images:
            return ["No images have been viewed."]

        # Build the message with image information
        content_blocks: list[str | dict] = [{"type": "text", "text": "Here are the images you've viewed:"}]
        if any(str(image_path).startswith(_KNOWLEDGE_IMAGE_PREFIX) for image_path in viewed_images):
            content_blocks.append(
                {
                    "type": "text",
                    "text": (
                        "These images came from the knowledge-base retrieval flow. "
                        "Use the matching current-turn knowledge evidence as the source of truth, "
                        "copy its exact citation_markdown, include image_markdown in the final answer when the image materially helps, "
                        "and do not expose raw /mnt/user-data image paths in the visible answer."
                    ),
                }
            )
            evidence_reminder = self._knowledge_evidence_reminder_text(state.get("messages", []))
            if evidence_reminder:
                content_blocks.append({"type": "text", "text": evidence_reminder})

        knowledge_image_index = 0
        for image_path, image_data in viewed_images.items():
            mime_type = image_data.get("mime_type", "unknown")
            base64_data = image_data.get("base64", "")
            is_knowledge_image = str(image_path).startswith(_KNOWLEDGE_IMAGE_PREFIX)

            # Add text description
            if is_knowledge_image:
                knowledge_image_index += 1
                label = f"Knowledge image {knowledge_image_index}"
            else:
                label = str(image_path)
            content_blocks.append({"type": "text", "text": f"\n- **{label}** ({mime_type})"})

            # Add the actual image data so LLM can "see" it
            if base64_data:
                content_blocks.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{base64_data}"},
                    }
                )

        return content_blocks

    def _knowledge_evidence_reminder_text(self, messages: list) -> str | None:
        payload = self._latest_knowledge_evidence_payload(messages)
        if payload is None:
            return None

        citations: list[str] = []
        images: list[str] = []
        seen_citations: set[str] = set()
        seen_images: set[str] = set()

        for item in payload.get("items", []):
            if not isinstance(item, dict):
                continue
            citation = str(item.get("citation_markdown") or "").strip()
            if citation and citation not in seen_citations and len(citations) < _MAX_EVIDENCE_CITATIONS:
                seen_citations.add(citation)
                citations.append(citation)

            for block in item.get("evidence_blocks", []):
                if not isinstance(block, dict):
                    continue
                citation = str(block.get("citation_markdown") or "").strip()
                if citation and citation not in seen_citations and len(citations) < _MAX_EVIDENCE_CITATIONS:
                    seen_citations.add(citation)
                    citations.append(citation)
                image_markdown = str(block.get("image_markdown") or "").strip()
                if image_markdown and image_markdown not in seen_images and len(images) < _MAX_EVIDENCE_IMAGES:
                    seen_images.add(image_markdown)
                    images.append(image_markdown)

        if not citations and not images:
            return None

        lines = ["Current-turn knowledge evidence to reuse exactly:"]
        lines.append("Your next visible answer must include at least one exact citation_markdown from this list.")
        if citations:
            lines.append("Citations:")
            lines.extend(f"- {citation}" for citation in citations)
        if images:
            lines.append("Inline images:")
            lines.extend(f"- {image_markdown}" for image_markdown in images)
        lines.append("Do not emit raw /mnt/user-data image paths. Reuse exact image_markdown when the image is relevant.")
        return "\n".join(lines)

    def _latest_knowledge_evidence_payload(self, messages: list) -> dict | None:
        for message in reversed(messages):
            if not isinstance(message, ToolMessage) or message.name != "get_document_evidence":
                continue
            content = message.content
            if not isinstance(content, str):
                continue
            text = content.strip()
            if not text or text.startswith("Error:"):
                continue
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict) and isinstance(payload.get("items"), list):
                return payload
        return None

    def _should_inject_image_message(self, state: ViewImageMiddlewareState) -> bool:
        """Determine if we should inject an image details message.

        Args:
            state: Current state

        Returns:
            True if we should inject the message
        """
        messages = state.get("messages", [])
        if not messages:
            return False

        # Get the last assistant message
        last_assistant_msg = self._get_last_assistant_message(messages)
        if not last_assistant_msg:
            return False

        # Check if it has view_image tool calls
        if not self._has_view_image_tool(last_assistant_msg):
            return False

        # Check if all tools have been completed
        if not self._all_tools_completed(messages, last_assistant_msg):
            return False

        # Check if we've already added an image details message
        # Look for a human message after the last assistant message that contains image details
        assistant_idx = messages.index(last_assistant_msg)
        for msg in messages[assistant_idx + 1 :]:
            if isinstance(msg, HumanMessage):
                content_str = str(msg.content)
                if "Here are the images you've viewed" in content_str or "Here are the details of the images you've viewed" in content_str:
                    # Already added, don't add again
                    return False

        return True

    def _inject_image_message(self, state: ViewImageMiddlewareState) -> dict | None:
        """Internal helper to inject image details message.

        Args:
            state: Current state

        Returns:
            State update with additional human message, or None if no update needed
        """
        if not self._should_inject_image_message(state):
            return None

        # Create the image details message with text and image content
        image_content = self._create_image_details_message(state)

        # Create a new human message with mixed content (text + images)
        human_msg = HumanMessage(content=image_content)

        logger.debug("Injecting viewed image content before model call")

        # Return state update with the new message
        return {"messages": [human_msg]}

    @override
    def before_model(self, state: ViewImageMiddlewareState, runtime: Runtime) -> dict | None:
        """Inject image details message before LLM call if view_image tools have completed (sync version).

        This runs before each LLM call, checking if the previous turn included view_image
        tool calls that have all completed. If so, it injects a human message with the image
        details so the LLM can see and analyze the images.

        Args:
            state: Current state
            runtime: Runtime context (unused but required by interface)

        Returns:
            State update with additional human message, or None if no update needed
        """
        return self._inject_image_message(state)

    @override
    async def abefore_model(self, state: ViewImageMiddlewareState, runtime: Runtime) -> dict | None:
        """Inject image details message before LLM call if view_image tools have completed (async version).

        This runs before each LLM call, checking if the previous turn included view_image
        tool calls that have all completed. If so, it injects a human message with the image
        details so the LLM can see and analyze the images.

        Args:
            state: Current state
            runtime: Runtime context (unused but required by interface)

        Returns:
            State update with additional human message, or None if no update needed
        """
        return self._inject_image_message(state)
