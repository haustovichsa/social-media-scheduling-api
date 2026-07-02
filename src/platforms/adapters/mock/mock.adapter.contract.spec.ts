import { runAdapterContractTests } from '../../adapter-contract.shared-spec';
import { MockAdapter } from './mock.adapter';

/**
 * Runs the reusable {@link runAdapterContractTests adapter contract} against
 * MockAdapter. The mock's own `mock.adapter.spec.ts` covers its specifics (seed
 * data, flattening at the cap); this file asserts it honors the shared contract
 * every platform must — the guarantee that makes "add a platform = write an
 * adapter" safe.
 */
runAdapterContractTests({
  description: 'MockAdapter',
  createAdapter: () => new MockAdapter(),
  ctx: { platformAccountId: 'acc-1' },
  postId: 'post-1',
  replyToCommentId: 'm-c2',
  missingCommentId: 'no-such-comment',
});
