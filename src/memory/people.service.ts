import { Inject, Injectable, Logger } from '@nestjs/common';
import nlp from 'compromise';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants.js';
import { PersonRow } from './memory.types.js';

@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  detectNames(text: string): string[] {
    // compromise POS tagger returns deduplicated person name strings
    return (nlp(text).people().out('array') as string[]);
  }

  async lookupByNames(names: string[], userId: string): Promise<PersonRow[]> {
    // Guard: empty array would produce a vacuous ANY($2) and waste a round-trip
    if (names.length === 0) return [];

    const result = await this.pool.query<PersonRow>(
      `SELECT id, user_id, name, aliases, facts, created_at, updated_at
       FROM people
       WHERE user_id = $1
         AND (name = ANY($2::text[]) OR aliases && $2::text[])`,
      [userId, names],
    );
    return result.rows;
  }

  async upsertPerson(
    name: string,
    userId: string,
    facts: Record<string, unknown> = {},
  ): Promise<PersonRow> {
    const result = await this.pool.query<PersonRow>(
      `INSERT INTO people (user_id, name, facts)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name)
       DO UPDATE SET
         facts = people.facts || EXCLUDED.facts,
         updated_at = NOW()
       RETURNING id, user_id, name, aliases, facts, created_at, updated_at`,
      [userId, name, JSON.stringify(facts)],
    );
    return result.rows[0];
  }
}
