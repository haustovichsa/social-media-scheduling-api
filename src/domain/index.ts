/**
 * The canonical, platform-free domain model — the shared vocabulary the whole
 * service speaks (NFR-1). Nothing platform-specific crosses this boundary:
 * adapters map platform payloads down to these types, and the API layer maps
 * these types up to wire DTOs. Import domain types from here.
 */
export { Author } from './author';
export { Comment } from './comment';
export { Reply } from './reply';
export { Page, PageCursor } from './page';
