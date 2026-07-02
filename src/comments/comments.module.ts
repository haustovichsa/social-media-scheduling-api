import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { PersistenceModule } from '../persistence/persistence.module';
import { PlatformsModule } from '../platforms';
import { CommentController } from './comment.controller';
import { CommentRepository } from './comment.repository';
import { CommentService } from './comment.service';

/**
 * The comment feature. Wires the read/reply services to their two dependencies:
 * {@link PersistenceModule} for the local store and {@link PlatformsModule} for
 * the {@link AdapterRegistry} (the only way in to a concrete platform). The REST
 * edge ({@link CommentController}) uses {@link CommentService}; typed errors are
 * mapped by the global {@link DomainExceptionFilter} wired in `main.ts`.
 */
@Module({
  imports: [PersistenceModule, PlatformsModule, AuthModule],
  controllers: [CommentController],
  providers: [CommentService, CommentRepository],
  exports: [CommentService],
})
export class CommentsModule {}
