from src.knowledge.service import _parse_node_ids


def test_parse_node_ids_supports_multilingual_separators_and_dedupes():
    assert _parse_node_ids("0001, 0002\n0002，0003、0004") == [
        "0001",
        "0002",
        "0003",
        "0004",
    ]
