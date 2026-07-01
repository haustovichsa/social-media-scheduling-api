import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsString, Max, Min, validateSync } from 'class-validator';

/**
 * Typed, validated view of the process environment. `ConfigModule` runs
 * {@link validateEnv} at boot, so a missing or malformed variable fails fast
 * with a clear message instead of surfacing later as a runtime error.
 */
export class EnvironmentVariables {
  // Env values arrive as strings; @Type coerces PORT to a number before validation.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT = 3000;

  @IsString()
  MONGODB_URI!: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // Coercion is declared per-field with @Type (see PORT), so no implicit
  // conversion option is needed here.
  const validated = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(validated);

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((error) => Object.values(error.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validated;
}
