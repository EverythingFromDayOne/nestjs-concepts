import { plainToInstance } from 'class-transformer';
import {
  IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, Min, validateSync,
} from 'class-validator';

enum NotifyMode {
  Console = 'console',
  Buffer = 'buffer',
}

class EnvironmentVariables {
  @IsEnum(NotifyMode)
  NOTIFY_MODE!: NotifyMode;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  DATABASE_PASSWORD!: string;

  // optional on purpose: article 05's factory falls back to a static table
  // when this is absent, so the app is not required to have it
  @IsOptional()
  @IsUrl({ require_tld: false })
  RATES_URL?: string;

  @IsString()
  API_KEY!: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true, // "3000" → 3000
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.toString()).join('\n'));
  }
  return validated;
}
