/**
 * Canonical, platform-free view of a comment's author.
 *
 * A snapshot of what the platform reported at ingest, reduced to the few fields
 * every platform can supply. It carries no platform-native shape (no raw `from`,
 * `user`, `actor` objects) — adapters map each platform's author payload down to
 * exactly this. Maps to and from the persistence counterpart `CommentAuthor`.
 */
export interface Author {
  /** The author's id on the platform (stable per platform, not global). */
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
}
