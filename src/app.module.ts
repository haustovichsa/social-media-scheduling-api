import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { CommentsModule } from './comments/comments.module';
import { NodeEnv, validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PersistenceModule } from './persistence/persistence.module';

/** Root module. Feature modules are registered here and Nest's DI wires them. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        // Build indexes on connect outside production. In production, apply
        // them deliberately via migration/ops, not on every boot.
        autoIndex:
          config.getOrThrow<NodeEnv>('NODE_ENV') !== NodeEnv.Production,
      }),
    }),
    HealthModule,
    PersistenceModule,
    CommentsModule,
  ],
})
export class AppModule {}
