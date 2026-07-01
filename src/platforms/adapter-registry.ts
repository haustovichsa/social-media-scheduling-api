import { Inject, Injectable } from '@nestjs/common';

import { Platform } from '../common/enums/platform.enum';
import { AdapterNotFoundError } from './platform-errors';
import {
  PLATFORM_ADAPTERS,
  PlatformAdapter,
} from './platform-adapter.interface';

/**
 * The single lookup services use to reach the right {@link PlatformAdapter}
 * (§3.2). Everything upstream — the read and reply services — depends only on
 * this registry and the shared interface, never on a concrete adapter, so
 * adding a platform changes nothing here or above it (AC-3).
 *
 * The registry is populated by DI: it injects every adapter bound to
 * {@link PLATFORM_ADAPTERS} and indexes them by their own `platform`. Indexing
 * happens once at construction, so a misconfiguration (two adapters claiming the
 * same platform) fails fast at startup rather than silently shadowing one.
 */
@Injectable()
export class AdapterRegistry {
  private readonly byPlatform: ReadonlyMap<Platform, PlatformAdapter>;

  constructor(@Inject(PLATFORM_ADAPTERS) adapters: readonly PlatformAdapter[]) {
    const index = new Map<Platform, PlatformAdapter>();
    for (const adapter of adapters) {
      if (index.has(adapter.platform)) {
        throw new Error(
          `Duplicate platform adapter registered for "${adapter.platform}"`,
        );
      }
      index.set(adapter.platform, adapter);
    }
    this.byPlatform = index;
  }

  /**
   * Resolve the adapter for a platform, or throw {@link AdapterNotFoundError}
   * if none is registered — an unknown platform is a typed, loud failure, never
   * a silent `undefined`.
   */
  get(platform: Platform): PlatformAdapter {
    const adapter = this.byPlatform.get(platform);
    if (!adapter) {
      throw new AdapterNotFoundError(platform);
    }
    return adapter;
  }

  /** The platforms currently served, for diagnostics and health checks. */
  supportedPlatforms(): Platform[] {
    return [...this.byPlatform.keys()];
  }
}
