import { INestApplication, ValidationPipe } from '@nestjs/common';

import { DomainExceptionFilter } from './common/http';

/**
 * Global request wiring: input validation and the typed-error filter. Kept as
 * one function so `main.ts` and the e2e tests share the same edge behaviour and
 * can't drift apart. OpenAPI setup stays in `main.ts` as a boot concern.
 */
export function configureApp(app: INestApplication): void {
  // Reject unknown properties and coerce primitives into their DTO types.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Single place that turns typed errors into HTTP responses; no controller
  // catches or shapes errors itself.
  app.useGlobalFilters(new DomainExceptionFilter());
}
