/**
 * The platform extension point (§3.2) — the maintainability keystone. Import the
 * adapter contract, the shared adapter-facing types, the registry, and the typed
 * error taxonomy from here. Concrete adapters (TASK-05) implement
 * {@link PlatformAdapter}; services depend only on {@link AdapterRegistry} and
 * these types, never on a specific platform.
 */
export { AdapterRegistry } from './adapter-registry';
export { PlatformsModule } from './platforms.module';
export { MockAdapter } from './adapters/mock/mock.adapter';
export { decodeCursor, encodeCursor } from './cursor';
export { enforceThreadDepth } from './thread-depth';
export { withPlatformToken } from './with-platform-token';
// The resilience layer (rate limiter, retry, ResilientAdapter) is an
// implementation detail below the adapter boundary — wired once by
// PlatformsModule and invisible to callers — so it is deliberately not
// re-exported here.
export {
  AdapterContext,
  PLATFORM_ADAPTERS,
  PlatformAdapter,
  PlatformCapabilities,
} from './platform-adapter.interface';
export {
  FetchedAuthor,
  FetchedComment,
  FetchedReply,
  ReplyInput,
} from './platform-comment';
export {
  AdapterNotFoundError,
  PlatformError,
  PlatformErrorCode,
  PlatformUnavailableError,
  RateLimitError,
  ResourceNotFoundError,
  TokenExpiredError,
  UnknownPlatformError,
} from './platform-errors';
