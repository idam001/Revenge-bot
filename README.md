<div align="center">

# REVENGE GPT

**An advanced multi-provider AI aggregator workspace — built by Idam Emmanuel**

Next.js 16 · React 19 · Drizzle ORM · PostgreSQL (Supabase) · Tailwind CSS 4

</div>

---

## What is this?

REVENGE GPT is a self-hostable, Claude-style AI workspace that aggregates many model
providers behind one interface. It ships with:

- **Unified chat studio** — streaming responses, personas, folders, pinned sessions, search, bookmarks and shareable public chat links.
- **Multi-provider engine** — keyless free-tier routing + automatic failover across providers, with live latency / tokens-per-second telemetry.
- **Extended thinking** — reasoning traces with timing.
- **Web grounding** — live web search with cited sources attached to answers.
- **Artifacts** — rendered code/preview canvas plus a "Revenge Studio" feature lab.
- **Agent workspace** — sandboxed tool loop (E2B) that can run commands, read/write files and export the result as a ZIP.
- **Universal API Key Vault** — add your own provider keys at runtime; they're stored server-side in Postgres (`provider_keys`).
- **Media generation** — image/video jobs with a local media store.
- **PWA-ready** — installable manifest, dark theme, mobile-friendly.

## Stack

| Layer | Tech |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4, lucide-react |
| Data | PostgreSQL via Drizzle ORM (`node-postgres` pool) |
| Hosting | Vercel |
| Database | Supabase (Postgres 17 + Supavisor pooler) |

## Getting started

```bash
git clone <this-repo>
cd <this-repo>
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
```

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string. Use the Supabase **Supavisor session pooler** (`aws-1-<region>.pooler.supabase.com:5432`) — it is IPv4-friendly and works from serverless. |
| `NEXT_PUBLIC_SUPABASE_URL` | ➖ | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ➖ | Supabase anon (publishable) key. |
| `E2B_API_KEY` | ➖ | Enables the sandboxed agent workspace. |
| `HF_TOKEN` | ➖ | Enables Hugging Face media models. |
| `AIHORDE_API_KEY` | ➖ | Enables the AI Horde fallback. |

Provider keys can also be added at runtime from the in-app **Universal API Key Vault**.

## Database

The schema is created **automatically on first request** (`ensureDbSchema()` in
`src/db/index.ts`) — no migration step is required for a fresh database. It creates:

`conversations`, `messages`, `provider_keys`, `memories`, `app_settings`,
`agent_sessions`, `agent_executions`.

To use Drizzle migrations instead, point `drizzle.config.json` at your database and
run `npx drizzle-kit push`.

## Deploy

1. Push this repo to GitHub.
2. Import it in Vercel, set `DATABASE_URL` (and any optional keys) in Project → Settings → Environment Variables.
3. Deploy. `/api/health` returns `{ "ok": true }` when the database is reachable and the schema is in place.

## API surface

| Route | Purpose |
| --- | --- |
| `GET /api/health` | DB + schema health check |
| `POST /api/chat` | Streaming chat completion with failover |
| `/api/conversations`, `/api/conversations/[id]` | Conversation CRUD |
| `/api/messages` (via `[id]`), `/api/search-messages` | Message search |
| `/api/providers` | Provider registry / key vault |
| `/api/settings` | App settings |
| `/api/websearch` | Web grounding |
| `/api/agent`, `/api/agent/files`, `/api/agent/zip` | Sandboxed agent loop |
| `/api/share`, `/share/[token]` | Public share links |
| `/api/stats` | Usage stats |
| `/api/media/[file]` | Media store |

## REVENGE Tools registry

The 194-entry curated catalog remains the compatible live registry. The catalog API now supports ranked query/category/tag/auth/method filtering, endpoint detail responses, additive provider/provenance/auth/example metadata, ETags, and per-invocation rate-limit headers. Existing examples are explicitly marked unverified until a real successful provider response has been observed; no upstream service or license is represented as verified just because it appears in a directory.

The Public APIs README discovery parser is a metadata-only seed. To preview its current rows without publishing them:

```bash
npm run ingest -- --source=all --dry-run
```

Raw source responses are cached under `.cache/ingest/` (gitignored). External directory rows are deliberately not exposed as executable tools until a provider contract, licensing/terms, safe request mapping, and working example have all been checked. `config/sources.json` records the planned inputs and their current publication policies. The ingest run does not implement the apis.guru or Hugging Face parsers yet.

## Movie Box

Movie Box searches Internet Archive feature-film metadata and only enables playback/download links when the source reports a supported public-domain or Creative Commons license. It keeps watchlist and resume progress in browser-local storage. The Archive item and license pages are the source of truth; users should review them before reuse. It is not a catalog for commercial new releases and does not bypass DRM, paywalls, or access controls.

## Verification commands

```bash
npm run typecheck
npm run test
npm run ingest -- --source=all --dry-run
npm run build
```

---

Built by **Idam Emmanuel**.
