# TASK-06 — Credential / token provider

**Depends on:** TASK-04 · **Difficulty:** Medium · **Order:** 6
**Requirements:** NFR-4, RK-6

## Prompt
Add secure per-account credential handling per `execution-plan.md` §3.1.

Do:
- `TokenProvider` as an injectable Nest provider (interface + DI token): `getToken(platformAccountId)`, `refreshToken(...)`.
- Stub implementation backed by a pluggable secret store (env/secret-manager seam).
- Redaction utility so tokens never appear in logs or serialized responses.
- Wire adapters (TASK-05) to obtain tokens only via the provider.

## Definition of Done
- Tokens fetched exclusively through the provider.
- No token appears in logs/DTOs (verify by grep/test); refresh hook exercised by a test.

**Role focus:** Security — elevated.
