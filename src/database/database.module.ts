import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';
import { PG_POOL } from './database.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });
        pool.on('connect', (client) => {
          pgvector.registerTypes(client);
        });
        // Required: prevents idle-client errors from crashing the process.
        pool.on('error', (err) => {
          console.error('[DatabaseModule] Idle pg client error', err);
        });
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
