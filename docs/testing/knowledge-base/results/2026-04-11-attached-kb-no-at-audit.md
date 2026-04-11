# 2026-04-11 Attached-KB No-@ Audit

## Environment

- Date: `2026-04-11`
- Stack: current-code `docker/docker-compose-prod.yaml`
- User-facing app: `http://127.0.0.1:8083`
- Admin / internal audit: `http://127.0.0.1:8081`
- Account: `admin`

## Scope

Validate the updated knowledge-base contract after removing the attached-document
listing tool from the default runtime flow:

- thread attachment is the precise KB scope
- KB retrieval must not require explicit `@document` syntax
- a non-KB turn on the same KB-attached thread must still use normal tools

## KB-Attached Thread Used

- Thread id: `48cd4816-61b1-40d1-a36e-47676c1090af`
- Attached base count in UI: `1`
- Attached document: `段建业2012年10月1太原盲派命理A班综合班培训资料.pdf`

## 8083 User Flow

### A. KB question without `@`

- Prompt:
  - `请只根据当前已挂载的知识库，用两句话概括文中如何区分牢狱之灾和伤灾残疾，并在每句话后带引用。不要要求我输入 @ 或文档全名。`
- Result:
  - passed
  - answer completed normally
  - answer included grounded KB citations
  - no user-side requirement to type `@` or the full document name

### B. Non-KB question on the same attached thread

- Prompt:
  - `现在不要查询知识库，也不要引用知识库。运行 pwd，并列出根目录 / 下前 3 个条目。最后一句只说明你实际调用了哪些工具。`
- Result:
  - passed
  - answer completed normally
  - final answer reported `pwd` result, top 3 root entries, and the actual tools used

## 8081 Internal Audit

### Trace list

From `GET /api/admin/traces?thread_id=48cd4816-61b1-40d1-a36e-47676c1090af&limit=3`:

- KB no-`@` trace id: `a3396a4a-07b5-49a0-9259-9c1df954d352`
- Non-KB trace id: `ce7941c5-6455-4ede-b1bc-09fcb46d42e6`

### Tool-path audit

From `GET /api/admin/traces/:trace_id/events` plus thread state inspection:

- KB no-`@` trace:
  - current-turn tool path was KB-only
  - observed `get_document_evidence`
  - no `execute`
  - no `ls`
  - no KB listing tool
- Non-KB trace:
  - observed `execute`
  - observed `ls`
  - no `get_document_tree`
  - no `get_document_evidence`

### Final-answer audit

- KB no-`@` turn final answer cited:
  - `...pdf p.146`
  - `...pdf p.165`
- Non-KB turn final answer reported:
  - working directory `/mnt/user-data/workspace`
  - root entries `/conversation_history/`, `/large_tool_results/`, `/mnt/skills/`

## Additional Finding

New-chat KB attachment before the first submitted message is still unreliable in
the current UI flow.

- Repro thread id: `2a462eab-9aee-4d6b-82fc-a83ccef632b5`
- The modal visually showed the KB option as selected, but after submit:
  - `GET /api/threads/2a462eab-9aee-4d6b-82fc-a83ccef632b5/knowledge/bases`
    returned an empty attachment list
  - the run did not have attached KB context and drifted into a bad path
- This is a pre-existing UI binding issue, not a regression caused by the
  no-`@` prompt change.

## Conclusion

- The runtime now supports the intended contract: attached KB scope is usable
  without explicit `@document` syntax.
- The same attached thread still handles non-KB turns correctly with generic
  tools.
- The remaining user-facing risk is the new-chat attachment persistence gap
  before the first message creates the thread.
