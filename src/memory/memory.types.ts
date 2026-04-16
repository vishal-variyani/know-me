export type FactType = 'fact' | 'preference' | 'relationship' | 'emotion';

export interface MemorySearchResult {
  id: string;
  content: string;
  fact_type: string;
  confidence: number;
  last_reinforced_at: Date;
  similarity: number; // 1 - cosine_distance; range [-1, 1]; threshold check: similarity >= 0.90
}

export interface PersonRow {
  id: string;
  user_id: string;
  name: string;
  aliases: string[] | null;
  facts: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

export interface MessageEmbeddingHit {
  id: string;
  user_id: string;
  message_id: string | null;
  content: string;
  source: 'message' | 'document' | 'memory';
  metadata: Record<string, unknown>;
  created_at: Date;
  similarity: number;
}
