/**
 * The social platforms the comment system can talk to. Every platform-scoped
 * document (accounts, posts, comments) is tagged with one of these values so a
 * single collection can hold records from many platforms and so the adapter
 * registry (TASK-04) can resolve the right adapter by platform.
 *
 * Adding a platform starts here: extend this enum, then register an adapter.
 */
export enum Platform {
  Facebook = 'facebook',
  Instagram = 'instagram',
  LinkedIn = 'linkedin',
  X = 'x',
  /** Deterministic in-memory platform used by tests and local demos. */
  Mock = 'mock',
}
