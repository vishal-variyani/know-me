# Know Me

Backend for a conversational memory agent built with NestJS, Socket.IO, LangChain, LangGraph, PostgreSQL (pgvector), and Redis/BullMQ.

## What it does

- Streams chat responses over WebSocket (`chat:chunk` / `chat:complete`)
- Stores conversations and memory entities
- Processes uploaded `.txt` / `.md` documents
- Runs extraction in background jobs
- Retrieves relevant context using vector similarity before each response
- Exposes paginated conversation history API for chat UI scroll-up loading

## Prerequisites

- Node.js 22+
- pnpm
- Supabase CLI (for local DB workflow)

## Setup

```bash
pnpm install
cp .env.example .env
```

## Local database (recommended workflow)

Use Supabase local as the single source of truth for schema + data:

```bash
pnpm run supabase:start
pnpm run db:push:local
pnpm run db:status:local
```

`DATABASE_URL` in `.env` should point to local Supabase Postgres (`localhost:54322`).

## Run

```bash
pnpm run start:dev
```

App starts on `http://localhost:3000` by default.

## Environment variables

See `.env.example` for all values. Required at bootstrap:

- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`
- `OPENAI_FALLBACK_API_KEY`
- `OPENAI_FALLBACK_CHAT_MODEL`
- `OPENAI_EXTRACTION_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `EMBEDDING_DIMS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`

Common optional:

- `PORT` (default `3000`)
- EASC tuning vars (`EASC_SIMILARITY_THRESHOLD`, `EASC_MIN_CHUNK_TOKENS`, `EASC_MAX_CHUNK_TOKENS`, `EASC_HARD_CEILING_TOKENS`).

## API / Socket surface

### WebSocket

- Connect with `handshake.auth.userId` (UUID required)
- Send: `chat:send` with `{ message }`
- Receive:
  - `chat:chunk` with `{ token }`
  - `chat:complete` with `{ conversationId }`
  - `chat:error` with `{ message }`

### HTTP

- `POST /api/conversations/:conversationId/upload`
  - multipart file (`file`), supports `.txt` and `.md`
  - body includes `userId` (UUID)
- `GET /conversations/:conversationId/messages`
  - query: `userId`, optional `limit`, `beforeCreatedAt`, `beforeId`
  - returns paginated history for infinite scroll

## Testing

```bash
pnpm run test
pnpm run test:cov
```

## Build

```bash
pnpm run build
pnpm run start:prod
```
