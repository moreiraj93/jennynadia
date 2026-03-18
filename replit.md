# Jenny x Nadia — Dual-Persona AI Social Universe

## Overview

A full-stack AI social companion app featuring two distinct AI personas: **Jenny** (warm, emotional, music-focused) and **Nadia** (bold, confident, dark feminine twin). Users can browse social profiles, like and comment on posts, and DM each persona powered by GPT-5.2.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/nadia)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **AI**: OpenAI GPT-5.2 via Replit AI Integrations (no key needed)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── nadia/              # React + Vite frontend (Jenny x Nadia app)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── integrations-openai-ai-server/  # OpenAI server-side client
│   └── integrations-openai-ai-react/   # OpenAI React hooks
├── scripts/
│   └── src/seed-posts.ts   # Seeding script for Jenny/Nadia posts
```

## App Features

### Pages
- `/` — Landing page: choose Jenny or Nadia
- `/profile/:persona` — Social profile page (posts, likes, comments, DM button)
- `/dm/:persona` — Private DM chat with AI persona (streaming SSE)

### API Endpoints
- `GET /api/social/profiles/:persona` — Persona profile data
- `GET /api/social/posts?persona=X` — Social posts feed
- `POST /api/social/posts/:id/like` — Toggle like (session-based)
- `GET /api/social/posts/:id/comments` — Get comments
- `POST /api/social/posts/:id/comments` — Add comment (triggers AI auto-reply after 3-8s)
- `GET /api/openai/conversations` — List DM conversations
- `POST /api/openai/conversations` — Create conversation `{ title, persona }`
- `GET /api/openai/conversations/:id` — Get conversation + messages
- `DELETE /api/openai/conversations/:id` — Delete conversation
- `POST /api/openai/conversations/:id/messages` — Send message (SSE stream)

### AI Personas
- **Nadia**: GPT-5.2 with bold, confident, teasing personality. Never short answers. Always teases back.
- **Jenny**: GPT-5.2 with warm, emotional, music-focused personality. Deep and genuine.
- Posts automatically get AI-generated persona replies when fans comment (3-8s delay)

### Database Tables
- `conversations` — DM conversations with persona column
- `messages` — Chat messages
- `posts` — Social posts with likes/comments counts
- `post_likes` — Like records (session-based deduplication)
- `post_comments` — Comments with optional persona auto-reply flag

## Development

```bash
# Run frontend
pnpm --filter @workspace/nadia run dev

# Run API server
pnpm --filter @workspace/api-server run dev

# Seed posts
pnpm --filter @workspace/scripts run seed-posts

# Push DB schema
pnpm --filter @workspace/db run push

# Run codegen
pnpm --filter @workspace/api-spec run codegen
```
