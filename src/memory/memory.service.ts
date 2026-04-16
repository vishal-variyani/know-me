import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';
import { PG_POOL } from '../database/database.constants.js';
import {
  ConversationMessageRow,
  ConversationRow,
  FactType,
  MemorySearchResult,
} from './memory.types.js';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async createConversation(
    userId: string,
    title?: string,
  ): Promise<ConversationRow> {
    const result = await this.pool.query<ConversationRow>(
      `INSERT INTO conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, user_id, title, created_at, updated_at`,
      [userId, title ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`[MemoryService] createConversation returned no row for userId=${userId}`);
    return row;
  }

  async addMessage(
    conversationId: string,
    userId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<ConversationMessageRow> {
    const result = await this.pool.query<ConversationMessageRow>(
      `INSERT INTO conversation_messages (conversation_id, user_id, role, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, user_id, role, content, created_at`,
      [conversationId, userId, role, content],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`[MemoryService] addMessage returned no row for conversationId=${conversationId}`);
    return row;
  }

  async saveMessageEmbedding(
    messageId: string,
    userId: string,
    vector: number[],
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO message_embeddings (message_id, user_id, embedding)
       VALUES ($1, $2, $3)`,
      [messageId, userId, pgvector.toSql(vector)],
    );
  }

  async searchSimilar(
    userId: string,
    vector: number[],
    topK: number,
  ): Promise<MemorySearchResult[]> {
    const result = await this.pool.query<MemorySearchResult>(
      `SELECT id, content, fact_type, confidence, last_reinforced_at, similarity
       FROM search_user_memories($1, $2, $3)`,
      [userId, pgvector.toSql(vector), topK],
    );
    return result.rows;
  }

  async upsertMemoryEntry(
    content: string,
    vector: number[],
    userId: string,
    factType: FactType,
    sourceType: 'conversation' | 'document',
  ): Promise<void> {
    const similar = await this.searchSimilar(userId, vector, 1);

    if (similar.length > 0 && similar[0].similarity >= 0.9) {
      // Reinforce existing entry — similarity is already 1 - cosine_distance (from search_user_memories)
      await this.pool.query(
        `UPDATE memory_entries
         SET last_reinforced_at = NOW(),
             confidence = LEAST(confidence + 0.05, 1.0),
             updated_at = NOW()
         WHERE id = $1`,
        [similar[0].id],
      );
      this.logger.debug(
        `Reinforced memory entry ${similar[0].id} (similarity=${similar[0].similarity})`,
      );
    } else {
      // Insert new entry
      await this.pool.query(
        `INSERT INTO memory_entries
           (user_id, content, embedding, fact_type, source_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, content, pgvector.toSql(vector), factType, sourceType],
      );
      this.logger.debug(
        `Inserted new memory entry for user=${userId} factType=${factType}`,
      );
    }
  }

  async getRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessageRow[]> {
    const result = await this.pool.query<ConversationMessageRow>(
      `SELECT id, conversation_id, user_id, role, content, created_at
       FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit],
    );
    // Reverse to chronological order — DB returns newest-first for efficiency with LIMIT
    return result.rows.reverse();
  }
}
