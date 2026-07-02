/**
 * The platform extension point. Import the adapter contract, the shared
 * adapter-facing types, the registry, and the error types from here. Concrete
 * adapters implement {@link PlatformAdapter}; services depend only on
 * {@link AdapterRegistry} and these types, never on a specific platform.
 */
export { AdapterRegistry } from './adapter-registry';
export { PlatformsModule } from './platforms.module';
export { MockAdapter } from './adapters/mock/mock.adapter';
export { decodeCursor, encodeCursor } from './cursor';
export { enforceThreadDepth } from './thread-depth';
export { withPlatformToken } from './with-platform-token';
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
