"""Tests for upload-event filtering in the memory pipeline.

Covers _strip_upload_mentions_from_memory (updater) which prevents ephemeral
file-upload context from persisting in long-term memory.

Note: _filter_messages_for_memory was previously in memory_middleware but is
now handled by deepagents MemoryMiddleware internally.
"""

from src.agents.memory.updater import _strip_upload_mentions_from_memory


# ===========================================================================
# _strip_upload_mentions_from_memory
# ===========================================================================


class TestStripUploadMentionsFromMemory:
    def _make_memory(self, summary: str, facts: list[dict] | None = None) -> dict:
        return {
            "user": {"topOfMind": {"summary": summary}},
            "history": {"recentMonths": {"summary": ""}},
            "facts": facts or [],
        }

    # --- summaries ---

    def test_upload_event_sentence_removed_from_summary(self):
        mem = self._make_memory(
            "User is interested in AI. "
            "User uploaded a test file for verification purposes. "
            "User prefers concise answers."
        )
        result = _strip_upload_mentions_from_memory(mem)
        summary = result["user"]["topOfMind"]["summary"]
        assert "uploaded a test file" not in summary
        assert "User is interested in AI" in summary
        assert "User prefers concise answers" in summary

    def test_upload_path_sentence_removed_from_summary(self):
        mem = self._make_memory(
            "User uses Python. "
            "User uploaded file to /mnt/user-data/uploads/tid/data.csv. "
            "User likes clean code."
        )
        result = _strip_upload_mentions_from_memory(mem)
        summary = result["user"]["topOfMind"]["summary"]
        assert "/mnt/user-data/uploads/" not in summary
        assert "User uses Python" in summary

    def test_legitimate_csv_mention_is_preserved(self):
        """'User works with CSV files' must NOT be deleted — it's not an upload event."""
        mem = self._make_memory("User regularly works with CSV files for data analysis.")
        result = _strip_upload_mentions_from_memory(mem)
        assert "CSV files" in result["user"]["topOfMind"]["summary"]

    def test_pdf_export_preference_preserved(self):
        """'Prefers PDF export' is a legitimate preference, not an upload event."""
        mem = self._make_memory("User prefers PDF export for reports.")
        result = _strip_upload_mentions_from_memory(mem)
        assert "PDF export" in result["user"]["topOfMind"]["summary"]

    def test_uploading_a_test_file_removed(self):
        """'uploading a test file' (with intervening words) must be caught."""
        mem = self._make_memory(
            "User conducted a hands-on test by uploading a test file titled "
            "'test_openagents_memory_bug.txt'. User is also learning Python."
        )
        result = _strip_upload_mentions_from_memory(mem)
        summary = result["user"]["topOfMind"]["summary"]
        assert "test_openagents_memory_bug.txt" not in summary
        assert "uploading a test file" not in summary

    # --- facts ---

    def test_upload_fact_removed_from_facts(self):
        facts = [
            {"content": "User uploaded a file titled secret.txt", "category": "behavior"},
            {"content": "User prefers dark mode", "category": "preference"},
            {"content": "User is uploading document attachments regularly", "category": "behavior"},
        ]
        mem = self._make_memory("summary", facts=facts)
        result = _strip_upload_mentions_from_memory(mem)
        remaining = [f["content"] for f in result["facts"]]
        assert "User prefers dark mode" in remaining
        assert not any("uploaded a file" in c for c in remaining)
        assert not any("uploading document" in c for c in remaining)

    def test_non_upload_facts_preserved(self):
        facts = [
            {"content": "User graduated from Peking University", "category": "context"},
            {"content": "User prefers Python over JavaScript", "category": "preference"},
        ]
        mem = self._make_memory("", facts=facts)
        result = _strip_upload_mentions_from_memory(mem)
        assert len(result["facts"]) == 2

    def test_empty_memory_handled_gracefully(self):
        mem = {"user": {}, "history": {}, "facts": []}
        result = _strip_upload_mentions_from_memory(mem)
        assert result == {"user": {}, "history": {}, "facts": []}
