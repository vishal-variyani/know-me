-- Phase 4: Update memory_entries.fact_type CHECK constraint.
-- Old values: preference | relationship | event | belief | goal | habit
-- New values: fact | preference | relationship | emotion
--
-- Step 1: Back-fill existing rows with old fact_type values to nearest new value.
-- This prevents the new CHECK constraint from rejecting existing data.
UPDATE memory_entries
SET fact_type = 'fact'
WHERE fact_type IN ('event', 'belief', 'goal', 'habit');

UPDATE memory_entries
SET fact_type = 'emotion'
WHERE fact_type = 'emotion';  -- already valid (no-op, included for completeness)

-- Step 2: Drop old constraint and add new one.
ALTER TABLE memory_entries
  DROP CONSTRAINT IF EXISTS memory_entries_fact_type_check;

ALTER TABLE memory_entries
  ADD CONSTRAINT memory_entries_fact_type_check
    CHECK (fact_type IN ('fact', 'preference', 'relationship', 'emotion'));
