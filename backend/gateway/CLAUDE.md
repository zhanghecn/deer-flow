# CLAUDE.md

Shared Go Gateway development context lives in `./AGENTS.md`.

Read first:

- `./AGENTS.md`

Claude-specific notes:

- Treat `AGENTS.md` as the canonical guide for this subtree.
- Upload handlers in this subtree are responsible for Markdown companion generation/deletion semantics for thread uploads; keep that behavior aligned with the Python runtime's `/mnt/user-data/uploads` contract.
