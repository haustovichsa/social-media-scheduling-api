import { Module, Type } from '@nestjs/common';

import { AdapterRegistry } from './adapter-registry';
import {
  PLATFORM_ADAPTERS,
  PlatformAdapter,
} from './platform-adapter.interface';

/**
 * The one place a platform plugs in. To add a platform: implement
 * {@link PlatformAdapter} in a new `@Injectable()` class and add that class to
 * the `adapters` array below. That is the entire wiring change — the factory
 * collects it into {@link PLATFORM_ADAPTERS}, the {@link AdapterRegistry} indexes
 * it by `platform`, and every service resolves it through the registry without a
 * single edit upstream (AC-3). Concrete adapters land in TASK-05.
 */
const adapters: Type<PlatformAdapter>[] = [
  // e.g. MockAdapter, FacebookAdapter — added in TASK-05.
];

@Module({
  providers: [
    ...adapters,
    {
      // Collect every registered adapter instance into the array token the
      // registry consumes. `inject` mirrors `adapters`, so registering a
      // platform is the single edit above — nothing here changes.
      provide: PLATFORM_ADAPTERS,
      useFactory: (...instances: PlatformAdapter[]) => instances,
      inject: adapters,
    },
    AdapterRegistry,
  ],
  exports: [AdapterRegistry],
})
export class PlatformsModule {}
