import { Test } from '@nestjs/testing';

import { Platform } from '../common/enums/platform.enum';
import { Page } from '../domain';
import { AdapterRegistry } from './adapter-registry';
import {
  AdapterContext,
  PLATFORM_ADAPTERS,
  PlatformAdapter,
} from './platform-adapter.interface';
import { FetchedComment, FetchedReply, ReplyInput } from './platform-comment';
import { AdapterNotFoundError } from './platform-errors';
import { PlatformsModule } from './platforms.module';

/**
 * A minimal stand-in adapter. The tests exercise the registry with fakes rather
 * than any real platform, proving the contract holds for any implementation.
 */
function fakeAdapter(platform: Platform): PlatformAdapter {
  return {
    platform,
    capabilities: { maxThreadDepth: 1, supportsWebhooks: false },
    getComments(): Promise<Page<FetchedComment>> {
      return Promise.resolve({ items: [], nextCursor: null });
    },
    replyToComment(
      _ctx: AdapterContext,
      externalCommentId: string,
      body: ReplyInput,
    ): Promise<FetchedReply> {
      return Promise.resolve({
        externalCommentId: 'r1',
        externalParentCommentId: externalCommentId,
        author: { externalAuthorId: 'me', displayName: 'Me' },
        text: body.text,
        platformCreatedAt: new Date(),
      });
    },
  };
}

describe('AdapterRegistry', () => {
  it('resolves a registered adapter by platform', () => {
    const ig = fakeAdapter(Platform.Instagram);
    const registry = new AdapterRegistry([ig, fakeAdapter(Platform.Mock)]);

    expect(registry.get(Platform.Instagram)).toBe(ig);
    expect(registry.get(Platform.Mock).platform).toBe(Platform.Mock);
    expect(registry.supportedPlatforms()).toEqual(
      expect.arrayContaining([Platform.Instagram, Platform.Mock]),
    );
  });

  it('throws a typed AdapterNotFoundError for an unregistered platform', () => {
    const registry = new AdapterRegistry([fakeAdapter(Platform.Mock)]);

    expect(() => registry.get(Platform.LinkedIn)).toThrow(AdapterNotFoundError);
    expect(() => registry.get(Platform.LinkedIn)).toThrow(/linkedin/);
  });

  it('fails fast when two adapters claim the same platform', () => {
    expect(
      () =>
        new AdapterRegistry([
          fakeAdapter(Platform.Instagram),
          fakeAdapter(Platform.Instagram),
        ]),
    ).toThrow(/Duplicate platform adapter/);
  });

  it('is empty (but constructible) with no adapters registered', () => {
    const registry = new AdapterRegistry([]);
    expect(registry.supportedPlatforms()).toEqual([]);
    expect(() => registry.get(Platform.Mock)).toThrow(AdapterNotFoundError);
  });
});

describe('PlatformsModule (DI wiring)', () => {
  it('provides an AdapterRegistry built from PLATFORM_ADAPTERS', async () => {
    const ig = fakeAdapter(Platform.Instagram);

    // Override the adapter token with a fake to prove the real module's wiring:
    // adapters bound to PLATFORM_ADAPTERS flow into the registry.
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformsModule],
    })
      .overrideProvider(PLATFORM_ADAPTERS)
      .useValue([ig])
      .compile();

    const registry = moduleRef.get(AdapterRegistry);
    expect(registry.get(Platform.Instagram)).toBe(ig);

    await moduleRef.close();
  });

  it('resolves the adapters registered by the shipped module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformsModule],
    }).compile();

    const registry = moduleRef.get(AdapterRegistry);
    expect(registry.supportedPlatforms()).toEqual([Platform.Mock]);
    expect(registry.get(Platform.Mock).platform).toBe(Platform.Mock);

    await moduleRef.close();
  });
});
