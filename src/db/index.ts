import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __revengeSchemaReady?: Promise<void>;
};

/**
 * Supabase's pooler is "session mode" (port 5432) and caps the whole project
 * at a small number of clients. On Vercel each warm Lambda gets its own module
 * instance, so an unbounded pg Pool multiplies fast and the project starts
 * rejecting connections with EMAXCONNSESSION.
 *
 * Keep each instance to a small pool, recycle idle clients quickly, and fail
 * fast instead of queueing forever. Anything bigger belongs in transaction
 * mode (port 6543) — see DEPLOYMENT.md.
 */
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX ?? 4),
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    keepAlive: true,
  });

pool.on("error", (err) => {
  // An idle client dropped by the pooler must not crash the Lambda.
  console.error("[db] idle client error:", err.message);
});

// Always reuse the pool across HMR reloads and repeated invocations.
globalForDb.__arenaNextJsPostgresqlPool = pool;

export const db = drizzle(pool, { schema });

export async function ensureDbSchema(): Promise<void> {
  if (!globalForDb.__revengeSchemaReady) {
    globalForDb.__revengeSchemaReady = (async () => {
      await pool.query(`
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";

        CREATE TABLE IF NOT EXISTS "conversations" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "title" text NOT NULL DEFAULT 'New Revenge Session',
          "modelId" text NOT NULL DEFAULT 'revenge-omega-x',
          "personaId" text NOT NULL DEFAULT 'unchained',
          "pinned" boolean NOT NULL DEFAULT false,
          "folder" text NOT NULL DEFAULT 'General',
          "systemPrompt" text,
          "createdAt" timestamp NOT NULL DEFAULT now(),
          "updatedAt" timestamp NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "messages" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "conversationId" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
          "role" text NOT NULL,
          "content" text NOT NULL,
          "reasoning" text,
          "reasoningMs" integer,
          "modelId" text,
          "providerUsed" text,
          "latencyMs" integer,
          "tokensPerSec" integer,
          "webSources" jsonb,
          "attachments" jsonb,
          "imageUrl" text,
          "videoUrl" text,
          "bookmarked" boolean NOT NULL DEFAULT false,
          "createdAt" timestamp NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "agent_sessions" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "conversationId" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
          "title" text NOT NULL DEFAULT 'Agent task',
          "modelId" text NOT NULL DEFAULT 'revenge-omega-x',
          "mode" text NOT NULL DEFAULT 'auto',
          "status" text NOT NULL DEFAULT 'running',
          "sandboxId" text,
          "ownerToken" text NOT NULL,
          "summary" text,
          "toolCallCount" integer NOT NULL DEFAULT 0,
          "createdAt" timestamp NOT NULL DEFAULT now(),
          "updatedAt" timestamp NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "agent_executions" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "sessionId" uuid NOT NULL REFERENCES "agent_sessions"("id") ON DELETE CASCADE,
          "seq" integer NOT NULL DEFAULT 0,
          "toolName" text NOT NULL,
          "command" text,
          "args" jsonb,
          "stdout" text NOT NULL DEFAULT '',
          "stderr" text NOT NULL DEFAULT '',
          "exitCode" integer NOT NULL DEFAULT 0,
          "durationMs" integer NOT NULL DEFAULT 0,
          "status" text NOT NULL DEFAULT 'success',
          "startedAt" timestamp NOT NULL DEFAULT now(),
          "completedAt" timestamp NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS "agent_executions_session_idx" ON "agent_executions" ("sessionId");

        CREATE TABLE IF NOT EXISTS "provider_keys" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "providerId" text NOT NULL UNIQUE,
          "apiKey" text NOT NULL,
          "baseUrl" text,
          "customModelId" text,
          "enabled" boolean NOT NULL DEFAULT true,
          "lastVerifiedAt" timestamp,
          "updatedAt" timestamp NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "memories" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "content" text NOT NULL,
          "category" text NOT NULL DEFAULT 'preference',
          "enabled" boolean NOT NULL DEFAULT true,
          "createdAt" timestamp NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS "app_settings" (
          "id" text PRIMARY KEY DEFAULT 'default',
          "defaultModelId" text NOT NULL DEFAULT 'revenge-omega-x',
          "defaultPersonaId" text NOT NULL DEFAULT 'unchained',
          "customSystemPrompt" text NOT NULL DEFAULT '',
          "temperature" real NOT NULL DEFAULT 0.7,
          "maxTokens" integer NOT NULL DEFAULT 8192,
          "reasoningEffort" text NOT NULL DEFAULT 'high',
          "webSearchDefault" boolean NOT NULL DEFAULT false,
          "autoFailover" boolean NOT NULL DEFAULT true,
          "streamResponses" boolean NOT NULL DEFAULT true,
          "updatedAt" timestamp NOT NULL DEFAULT now()
        );

        ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "videoUrl" text;
        ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "shareToken" text;
        ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "featureFlags" jsonb NOT NULL DEFAULT '{}'::jsonb;

        -- Multi-user ownership (added in the auth upgrade).
        -- ownerKey is user:<uuid>, guest:<token> or legacy:public.
        -- Existing rows are preserved and tagged as legacy public data.
        ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "ownerKey" text NOT NULL DEFAULT 'legacy:public';
        ALTER TABLE "memories"      ADD COLUMN IF NOT EXISTS "ownerKey" text NOT NULL DEFAULT 'legacy:public';
        ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "ownerKey" text NOT NULL DEFAULT 'legacy:public';
        ALTER TABLE "app_settings"   ADD COLUMN IF NOT EXISTS "ownerKey" text NOT NULL DEFAULT 'legacy:public';
        ALTER TABLE "messages"       ADD COLUMN IF NOT EXISTS "ownerKey" text NOT NULL DEFAULT 'legacy:public';
        ALTER TABLE "provider_keys"  ADD COLUMN IF NOT EXISTS "ownerKey" text NOT NULL DEFAULT 'legacy:public';
        ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "ownerKey" text NOT NULL DEFAULT 'legacy:public';

        -- Per-user personalisation columns
        ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "theme" text NOT NULL DEFAULT 'dark';
        ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "personalInstructions" text NOT NULL DEFAULT '';
        ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "memoryEnabled" boolean NOT NULL DEFAULT true;

        -- Messages inherit ownership from their conversation
        UPDATE "messages" m
           SET "ownerKey" = c."ownerKey"
          FROM "conversations" c
         WHERE m."conversationId" = c."id"
           AND m."ownerKey" = 'legacy:public'
           AND c."ownerKey" <> 'legacy:public';

        CREATE INDEX IF NOT EXISTS "conversations_owner_idx" ON "conversations" ("ownerKey", "updatedAt" DESC);
        CREATE INDEX IF NOT EXISTS "messages_conv_idx" ON "messages" ("conversationId", "createdAt");
        CREATE INDEX IF NOT EXISTS "messages_owner_idx" ON "messages" ("ownerKey");
        CREATE INDEX IF NOT EXISTS "memories_owner_idx" ON "memories" ("ownerKey");
        CREATE INDEX IF NOT EXISTS "provider_keys_owner_idx" ON "provider_keys" ("ownerKey");

        -- API keys are per account. The old global UNIQUE("providerId") let the
        -- first account to add Gemini/OpenAI lock out every other account.
        ALTER TABLE "provider_keys" DROP CONSTRAINT IF EXISTS "provider_keys_providerId_key";
        CREATE UNIQUE INDEX IF NOT EXISTS "provider_keys_owner_provider_uidx"
          ON "provider_keys" ("ownerKey", "providerId");

        -- Guest→account merge bookkeeping (idempotent, safe to re-run)
        CREATE TABLE IF NOT EXISTS "guest_merges" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "userId" uuid NOT NULL,
          "guestToken" text NOT NULL,
          "conversationsMoved" integer NOT NULL DEFAULT 0,
          "memoriesMoved" integer NOT NULL DEFAULT 0,
          "createdAt" timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS "guest_merges_user_idx" ON "guest_merges" ("userId");

        -- Agent conversation turns (so Agent Mode behaves like a real chat)
        CREATE TABLE IF NOT EXISTS "agent_messages" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "ownerKey" text NOT NULL DEFAULT 'legacy:public',
          "sessionId" uuid NOT NULL REFERENCES "agent_sessions" ("id") ON DELETE CASCADE,
          "role" text NOT NULL,
          "content" text NOT NULL DEFAULT '',
          "createdAt" timestamp NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS "agent_messages_session_idx" ON "agent_messages" ("sessionId", "createdAt");
      `);
    })().catch((err) => {
      globalForDb.__revengeSchemaReady = undefined;
      throw err;
    });
  }
  return globalForDb.__revengeSchemaReady;
}
