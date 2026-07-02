import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { configureApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Global validation + typed-error filter, shared with the e2e tests.
  configureApp(app);

  // OpenAPI (FR-6): served at /docs, with the JSON at /docs-json.
  const openApi = new DocumentBuilder()
    .setTitle('Multi-platform comment API')
    .setDescription(
      'Read comments on a published post and reply to a comment, in one ' +
        'canonical shape across every social platform.',
    )
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApi));

  // PORT is defaulted and coerced by the validated env schema, so read it
  // straight from there — no duplicate fallback.
  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('PORT'));
}

void bootstrap();
