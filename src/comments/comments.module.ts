import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence/persistence.module';
import { PlatformsModule } from '../platforms';
import { CommentRepository } from './comment.repository';
import { CommentService } from './comment.service';

/**
 * The comment feature (FR-1/FR-2). Wires the read/reply services to their two
 * dependencies via DI: {@link PersistenceModule} for the local store and
 * {@link PlatformsModule} for the {@link AdapterRegistry} (the only way in to a
 * concrete platform). The REST controllers (TASK-09) land here and consume the
 * exported {@link CommentService}.
 */
@Module({
  imports: [PersistenceModule, PlatformsModule],
  providers: [CommentService, CommentRepository],
  exports: [CommentService],
})
export class CommentsModule {}
