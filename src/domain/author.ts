/**
 * Canonical, platform-free view of a comment's author.
 *
 * This is a snapshot of whatever the platform reported at ingest time, reduced
 * to the few fields every platform can supply. It deliberately carries no
 * platform-native shape (no raw `from`, `user`, `actor`, … objects) — adapters
 * map each platform's author payload down to exactly this. See the persistence
 * counterpart `CommentAuthor`, which this maps to and from at the repo boundary.
 */
export interface Author {
  /** The author's id on the platform (stable per platform, not global). */
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
}
