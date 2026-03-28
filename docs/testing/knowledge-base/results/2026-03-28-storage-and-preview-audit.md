# 2026-03-28 Knowledge Storage And Preview Audit

## Environment

- Date: `2026-03-28 12:54:55 CST`
- User-facing app: `http://localhost:3000`
- Admin / audit UI: `http://localhost:5173`
- Gateway/API listener observed locally: `http://localhost:8001`
- Account used for browser probe: `admin / admin123`
- Browser mode: headed Chromium via `xvfb-run` + `@playwright/test`
- Stack classification:
  - `3000` listener: `node` PID `21504`
  - `5173` listener: `node` PID `21404`
  - `8001` listener: `__debug_b` PID `20884`
  - This means the browser probe was executed against a long-running local stack, not a freshly restarted current-code sidecar.
  - Do not treat the browser probe below as proof that the new Go/Python storage-path code is already serving live traffic.

## Scope Of This Audit

- MinIO / S3 knowledge asset path normalization
- Legacy `s3://.../knowledge/users/...` compatibility
- Markdown citation repeated-jump behavior

## Architecture Conclusion

- Current intended architecture is **single-path**, not dual primary storage:
  - `PostgreSQL` stores metadata plus hot JSON / JSONB knowledge index payloads
  - `Knowledge Asset Store` stores binary and preview assets
  - Current environment is configured to use `MinIO`
- New object-storage writes should use:
  - bucket: `knowledge`
  - key: `users/{user_id}/bases/{base_id}/documents/{document_id}/...`
- Legacy refs of the form:
  - `s3://knowledge/knowledge/users/...`
  remain readable and cleanup-compatible during transition

## Code-Level Verification

### Python

- Command:
  - `uv run python -m pytest tests/test_knowledge_asset_store.py -q`
- Result:
  - `3 passed`

- Command:
  - `uv run python -m pytest tests/test_knowledge_runtime.py tests/test_knowledge_service.py tests/test_knowledge_repository_preview.py -q`
- Result:
  - `34 passed`

### Go

- Command:
  - `go test ./internal/knowledgeasset -run 'TestRefForRelativePathUsesS3SchemeWhenObjectStoreEnabled|TestResolvePackageRelativeRefSupportsS3StorageRefs|TestNormalizeObjectKeyStripsLegacyKnowledgePrefix|TestStoragePrefixesForCleanupIncludesLegacyAndNormalizedPrefixes'`
- Result:
  - `ok`

- Command:
  - `go test ./internal/handler -run 'TestDebugCanonicalStorageRef|TestResolveKnowledgeAssetRef|TestCopyMarkdownReferencedAssets|TestFilterKnowledgeBasesForReadyDocuments'`
- Result:
  - `ok`

### Frontend

- Command:
  - `pnpm --dir frontend/app exec vitest run src/components/workspace/artifacts/artifact-file-detail.test.tsx src/components/workspace/artifacts/context.test.tsx src/components/workspace/chats/layout-state.test.ts`
- Result:
  - `3 files passed`
  - `11 tests passed`

Verified frontend behavior in unit tests:

- PDF repeated citation reveals still update page number
- Markdown heading reveal still works
- Duplicate heading slugs now fall back to line-based reveal instead of always jumping to the first repeated heading

## Headed Browser Probe

- Login form was reachable on `http://localhost:3000/login`
- Navigating to `http://localhost:3000/workspace/knowledge` after login probe showed the real workspace shell and knowledge-management content
- Visible real-user entry text was present:
  - `Knowledge`
  - `Shared Knowledge Library`
  - `Upload knowledge`
- Admin audit UI probe result:
  - `http://localhost:5173` redirected to `/login`
  - login screen was reachable and rendered:
    - `Admin Console`
    - `Sign in with your admin credentials`
    - `Account`
    - `Password`

## What Was Not Verified In Browser Yet

- Current-code Go/Python backend serving the new MinIO key normalization
- End-to-end upload on a freshly restarted current-code stack
- 5173 trace audit for the repeated-citation fix after logging into the current-code stack
- Real browser confirmation that the duplicate-heading fallback fix is present in the live stack

## Known Follow-Up

- Restart or sidecar-run the current Go/Python stack, then verify a fresh upload writes MinIO keys under `users/...`
- Re-run headed browser preview-jump verification on the current-code stack
- Re-run `http://localhost:5173` internal audit after a real citation-click scenario on the current-code stack
