import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence/persistence.module';
import { PlatformsModule } from '../platforms';
import { CommentController } from './comment.controller';
import { CommentRepository } from './comment.repository';
import { CommentService } from './comment.service';

/**
 * The comment feature (FR-1/FR-2). Wires the read/reply services to their two
 * dependencies via DI: {@link PersistenceModule} for the local store and
 * {@link PlatformsModule} for the {@link AdapterRegistry} (the only way in to a
 * concrete platform). The REST edge ({@link CommentController}) consumes the
 * {@link CommentService}; typed errors are mapped centrally by the global
 * {@link DomainExceptionFilter} wired in `main.ts`.
 */
@Module({
  imports: [PersistenceModule, PlatformsModule],
  controllers: [CommentController],
  providers: [CommentService, CommentRepository],
  exports: [CommentService],
})
export class CommentsModule {}
