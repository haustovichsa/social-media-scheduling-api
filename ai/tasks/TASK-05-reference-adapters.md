# TASK-05 — Reference adapter(s) with normalization

**Depends on:** TASK-04 · **Difficulty:** Medium · **Order:** 5
**Requirements:** FR-3, AC-3

## Prompt
Implement concrete adapters per `execution-plan.md` §3.5 (threading resolution).

Do:
- `MockAdapter`: deterministic, in-memory, for tests/local demo. Supports paginated
  comments incl. nested replies and reply creation.
- `FacebookAdapter` (partial/realistic sketch): map Graph API comment objects + cursors
  ⇄ canonical model; handle nested replies and threading depth.
- Normalization mappers translating platform payloads to canonical `Comment`/`Reply`,
  and opaque `PageCursor` round-tripping.

## Definition of Done
- `MockAdapter` passes the adapter contract (see TASK-12).
- Normalization covers nested replies and cursor round-trip; no platform types escape the adapter.

**Role focus:** Domain Researcher — elevated (external API correctness).
