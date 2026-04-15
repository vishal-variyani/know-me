-- Add unique constraint on (user_id, name) to support ON CONFLICT upsert in PeopleService.upsertPerson.
-- Phase 1 created a B-tree index on user_id only; this constraint is the missing prerequisite.
ALTER TABLE people ADD CONSTRAINT people_user_id_name_unique UNIQUE (user_id, name);
