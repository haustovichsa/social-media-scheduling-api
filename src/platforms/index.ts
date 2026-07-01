/**
 * The platform extension point (§3.2) — the maintainability keystone. Import the
 * adapter contract, the shared adapter-facing types, the registry, and the typed
 * error taxonomy from here. Concrete adapters (TASK-05) implement
 * {@link PlatformAdapter}; services depend only on {@link AdapterRegistry} and
 * these types, never on a specific platform.
 */
export { AdapterRegistry } from './adapter-registry';
export { PlatformsModule } from './platforms.module';
export {
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
