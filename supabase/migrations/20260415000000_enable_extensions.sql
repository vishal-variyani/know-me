-- Enable required PostgreSQL extensions
-- Must be the first migration — vector type is referenced in migrations 3 and 5
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
