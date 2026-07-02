import { Module, Type } from '@nestjs/common';

import { CredentialsModule } from '../credentials';
import { AdapterRegistry } from './adapter-registry';
import { MockAdapter } from './adapters/mock/mock.adapter';
import {
  PLATFORM_ADAPTERS,
  PlatformAdapter,
} from './platform-adapter.interface';

/**
 * The one place a platform plugs in. To add a platform: implement
 * {@link PlatformAdapter} in a new `@Injectable()` class and add it to the
 * `adapters` array below. That is the entire wiring change — the factory collects
 * it into {@link PLATFORM_ADAPTERS}, {@link AdapterRegistry} indexes it by
 * `platform`, and every service resolves it through the registry, no upstream edit.
 */
const adapters: Type<PlatformAdapter>[] = [MockAdapter];

@Module({
  // CredentialsModule supplies the TOKEN_PROVIDER adapters resolve tokens
  // through. No database dependency, so platform wiring stays unit-testable
  // without a Mongo connection.
  imports: [CredentialsModule],
  providers: [
    ...adapters,
    {
      // Collect every registered adapter instance into the array token the
      // registry consumes. `inject` mirrors `adapters`, so registering a
      // platform is the single edit above — nothing here changes.
      //
      // Per-platform rate limiting and retry/backoff are a designed-not-built
      // seam here: a decorator wrapping each adapter at this point would add them
      // without touching the registry or any caller (see DESIGN.md).
      provide: PLATFORM_ADAPTERS,
      useFactory: (...instances: PlatformAdapter[]) => instances,
      inject: adapters,
    },
    AdapterRegistry,
  ],
  exports: [AdapterRegistry],
})
export class PlatformsModule {}
