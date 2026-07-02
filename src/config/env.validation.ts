import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Typed, validated view of the environment. `ConfigModule` runs
 * {@link validateEnv} at boot, so a missing or bad variable fails fast with a
 * clear message instead of surfacing later at runtime.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV = NodeEnv.Development;

  // Env values arrive as strings; @Type coerces PORT to a number first.
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
  // conversion option is needed.
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
