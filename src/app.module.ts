import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { NodeEnv, validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PersistenceModule } from './persistence/persistence.module';

/**
 * Root module and DI composition root. Feature modules are registered here;
 * there is no hand-wired container — Nest's DI graph wires everything.
 */
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
        // Let Mongoose build the declared indexes on connect outside of
        // production; in production indexes should be applied deliberately
        // (migration/ops) rather than on every boot against a live dataset.
        autoIndex:
          config.getOrThrow<NodeEnv>('NODE_ENV') !== NodeEnv.Production,
      }),
    }),
    HealthModule,
    PersistenceModule,
  ],
})
export class AppModule {}
