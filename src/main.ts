import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module.js';

const REQUIRED_ENV_VARS = [
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL',
  'OPENAI_EXTRACTION_MODEL',
  'OPENAI_EMBEDDING_MODEL',
  'EMBEDDING_DIMS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'REDIS_HOST',
  'REDIS_PORT',
] as const;

export function validateEnv(): void {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      throw new Error(
        `[Bootstrap] Missing required environment variable: ${key}`,
      );
    }
  }
}

async function bootstrap() {
  validateEnv(); // throws before NestFactory.create if any var missing

  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
// Guard: skip bootstrap when imported by Vitest (process.env.VITEST is set by the test runner)
if (!process.env['VITEST']) {
  bootstrap();
}
