# Platforms — the extension point

Everything platform-specific lives behind one interface. Services (read/reply)
depend only on `AdapterRegistry` and the shared types in this folder — never on a
concrete platform — so **adding a platform touches only this folder** (NFR-1, AC-3).

## The pieces

| File | Role |
|---|---|
| `platform-adapter.interface.ts` | `PlatformAdapter` — the contract every platform implements (`getComments`, `replyToComment`, `capabilities`). |
| `platform-comment.ts` | `FetchedComment` / `FetchedReply` / `FetchedAuthor` / `ReplyInput` — the external-id-keyed shapes an adapter exchanges with the core. |
| `platform-errors.ts` | The typed error taxonomy adapters must throw (`RateLimitError`, `TokenExpiredError`, `ResourceNotFoundError`, `PlatformUnavailableError`, `UnknownPlatformError`) plus the registry-level `AdapterNotFoundError`. |
| `adapter-registry.ts` | Resolves an adapter by `Platform`; unknown platform → `AdapterNotFoundError`. |
| `platforms.module.ts` | Nest DI wiring: collects adapters into `PLATFORM_ADAPTERS` and provides the registry. |

## How to add a new platform

1. **Extend the enum.** Add a value to `Platform` in
   `src/common/enums/platform.enum.ts`.
2. **Write the adapter.** Create an `@Injectable()` class implementing
   `PlatformAdapter`. Set `platform` to your new enum value, declare
   `capabilities` (e.g. `maxThreadDepth`), and map the platform's payloads to
   `FetchedComment` / `FetchedReply`. For credentials, inject the `TokenProvider`
   (`TOKEN_PROVIDER`, from `CredentialsModule`) and wrap each platform call in the
   shared `withPlatformToken(tokens, platform, ctx, call)` helper — it resolves
   the account's token, refreshes-and-retries once on expiry, and normalises a
   `MissingCredentialError` to a `TokenExpiredError` for you. Never read a token
   directly, and pass the `AccessToken` on rather than a bare string so it can't
   leak (RK-6). **Throw only `PlatformError` subclasses** — a raw vendor error
   escaping the adapter is a bug.
3. **Register it (one line).** Add the class to the `adapters` array in
   `platforms.module.ts`. The factory collects it into `PLATFORM_ADAPTERS` and
   the registry indexes it.

That's the whole change. **No service or controller is edited** — that is the
guarantee this layer exists to provide, and the shared adapter contract test
(TASK-12) enforces it for every platform.

## Contract rules

- **Opaque cursors.** `nextCursor` is a black box the caller round-trips
  verbatim; `null` means end of list (an empty page can still have a next
  cursor). Back it with whatever the platform uses.
- **Typed failures only.** Map every platform failure to a `PlatformError`
  subclass so it becomes a documented API error (AC-5), never a raw response
  or a 500.
- **Enforce nesting depth.** Flatten replies deeper than `capabilities.maxThreadDepth`
  onto the deepest allowed ancestor on ingest (A-5).
