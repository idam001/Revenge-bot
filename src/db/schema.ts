import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  real,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export interface WebSourceItem {
  title: string;
  url: string;
  snippet: string;
}

export interface AttachmentItem {
  name: string;
  type: string;
  size?: number;
  content: string;
}

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull().default("New Revenge Session"),
  modelId: text("modelId").notNull().default("revenge-omega-x"),
  personaId: text("personaId").notNull().default("unchained"),
  pinned: boolean("pinned").notNull().default(false),
  folder: text("folder").notNull().default("General"),
  systemPrompt: text("systemPrompt"),
  shareToken: text("shareToken"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversationId")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  reasoning: text("reasoning"),
  reasoningMs: integer("reasoningMs"),
  modelId: text("modelId"),
  providerUsed: text("providerUsed"),
  latencyMs: integer("latencyMs"),
  tokensPerSec: integer("tokensPerSec"),
  webSources: jsonb("webSources").$type<WebSourceItem[]>(),
  attachments: jsonb("attachments").$type<AttachmentItem[]>(),
  imageUrl: text("imageUrl"),
  videoUrl: text("videoUrl"),
  bookmarked: boolean("bookmarked").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const providerKeys = pgTable("provider_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: text("providerId").notNull().unique(),
  apiKey: text("apiKey").notNull(),
  baseUrl: text("baseUrl"),
  customModelId: text("customModelId"),
  enabled: boolean("enabled").notNull().default(true),
  lastVerifiedAt: timestamp("lastVerifiedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const memories = pgTable("memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  content: text("content").notNull(),
  category: text("category").notNull().default("preference"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("default"),
  defaultModelId: text("defaultModelId").notNull().default("revenge-omega-x"),
  defaultPersonaId: text("defaultPersonaId").notNull().default("unchained"),
  customSystemPrompt: text("customSystemPrompt").notNull().default(""),
  temperature: real("temperature").notNull().default(0.7),
  maxTokens: integer("maxTokens").notNull().default(8192),
  reasoningEffort: text("reasoningEffort").notNull().default("high"),
  webSearchDefault: boolean("webSearchDefault").notNull().default(false),
  autoFailover: boolean("autoFailover").notNull().default(true),
  streamResponses: boolean("streamResponses").notNull().default(true),
  featureFlags: jsonb("featureFlags")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversationId").references(() => conversations.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull().default("Agent task"),
  modelId: text("modelId").notNull().default("revenge-omega-x"),
  mode: text("mode").notNull().default("auto"),
  status: text("status").notNull().default("running"),
  sandboxId: text("sandboxId"),
  ownerToken: text("ownerToken").notNull(),
  summary: text("summary"),
  toolCallCount: integer("toolCallCount").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const agentExecutions = pgTable("agent_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("sessionId")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull().default(0),
  toolName: text("toolName").notNull(),
  command: text("command"),
  args: jsonb("args").$type<Record<string, unknown>>(),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  exitCode: integer("exitCode").notNull().default(0),
  durationMs: integer("durationMs").notNull().default(0),
  status: text("status").notNull().default("success"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
});

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ProviderKeyRow = typeof providerKeys.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
export type AgentExecutionRow = typeof agentExecutions.$inferSelect;
