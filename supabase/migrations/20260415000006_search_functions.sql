CREATE OR REPLACE FUNCTION search_user_memories(
  p_user_id   uuid,
  p_embedding vector(1536),
  p_top_k     integer DEFAULT 5
)
RETURNS TABLE (
  id                 uuid,
  content            text,
  fact_type          text,
  confidence         float,
  last_reinforced_at timestamptz,
  similarity         float
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Transaction-scoped HNSW parameters (SET LOCAL prevents parameter leakage
  -- across connection pool reuse — never use bare SET here)
  SET LOCAL hnsw.ef_search = 40;
  SET LOCAL hnsw.iterative_scan = 'relaxed_order';

  RETURN QUERY
    SELECT
      me.id,
      me.content,
      me.fact_type::text,
      me.confidence,
      me.last_reinforced_at,
      1 - (me.embedding <=> p_embedding) AS similarity
    FROM memory_entries me
    WHERE
      me.user_id = p_user_id
      AND me.is_active = true
    ORDER BY me.embedding <=> p_embedding
    LIMIT p_top_k;
END;
$$;
