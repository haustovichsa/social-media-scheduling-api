import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';

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
      }),
    }),
    HealthModule,
  ],
})
export class AppModule {}
