import { INestApplication, ValidationPipe } from '@nestjs/common';

import { DomainExceptionFilter } from './common/http';

/**
 * The global request-handling wiring — input validation and the typed-error
 * exception filter. Kept as one function so `main.ts` and the e2e tests apply
 * the *same* edge behaviour; a test can't drift from production wiring here.
 * OpenAPI setup stays in `main.ts` (it's a boot concern, not request handling).
 */
export function configureApp(app: INestApplication): void {
  // Strip unknown properties and reject them, and coerce primitives from the
  // transport layer into their DTO types.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Single edge for turning the typed error taxonomy into documented HTTP
  // responses (AC-5) — no controller catches or shapes errors itself.
  app.useGlobalFilters(new DomainExceptionFilter());
}
