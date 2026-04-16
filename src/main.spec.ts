import { validateEnv } from './main.js';

describe('validateEnv', () => {
  const REQUIRED_VARS = [
    'OPENAI_API_KEY',
    'OPENAI_CHAT_MODEL',
    'OPENAI_FALLBACK_API_KEY',
    'OPENAI_FALLBACK_CHAT_MODEL',
    'OPENAI_EXTRACTION_MODEL',
    'OPENAI_EMBEDDING_MODEL',
    'EMBEDDING_DIMS',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
  ] as const;

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const key of REQUIRED_VARS) {
      process.env[key] = 'test-value';
    }
  });

  afterEach(() => {
    for (const key of REQUIRED_VARS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('does not throw when all required vars are present', () => {
    expect(() => validateEnv()).not.toThrow();
  });

  it.each(REQUIRED_VARS)(
    'throws with the missing var name when %s is absent',
    (missingVar) => {
      delete process.env[missingVar];
      expect(() => validateEnv()).toThrow(
        `[Bootstrap] Missing required environment variable: ${missingVar}`,
      );
    },
  );
});
