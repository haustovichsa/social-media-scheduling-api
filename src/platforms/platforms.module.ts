import { Module, Provider, Type } from '@nestjs/common';

import { CredentialsModule } from '../credentials';
import { AdapterRegistry } from './adapter-registry';
import { FacebookAdapter } from './adapters/facebook/facebook.adapter';
import {
  FACEBOOK_GRAPH_CLIENT,
  HttpFacebookGraphClient,
} from './adapters/facebook/facebook-graph.client';
import { MockAdapter } from './adapters/mock/mock.adapter';
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
 * single edit upstream (AC-3).
 */
const adapters: Type<PlatformAdapter>[] = [MockAdapter, FacebookAdapter];

/**
 * Support providers an adapter needs (transport, config). These are wiring for a
 * specific adapter, not adapters themselves, so they stay out of `adapters`.
 */
const supportProviders: Provider[] = [
  { provide: FACEBOOK_GRAPH_CLIENT, useClass: HttpFacebookGraphClient },
];

@Module({
  // CredentialsModule supplies the TOKEN_PROVIDER adapters resolve tokens
  // through. It has no database dependency, so the platform wiring stays
  // unit-testable without a Mongo connection.
  imports: [CredentialsModule],
  providers: [
    ...adapters,
    ...supportProviders,
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
