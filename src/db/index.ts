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

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

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
      `);
    })().catch((err) => {
      globalForDb.__revengeSchemaReady = undefined;
      throw err;
    });
  }
  return globalForDb.__revengeSchemaReady;
}
