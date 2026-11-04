import crypto from "node:crypto";
import { db, ensureDbSchema } from "@/db";
import { agentExecutions, agentSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  connectSandbox,
  createAgentSandbox,
  isE2BConfigured,
  type AgentSandbox,
} from "./e2b-manager";
import { executeAgentTool, type ToolStreamHandler } from "./agent-tools";

export interface ChatToolCall {
  tool: string;
  args: Record<string, unknown>;
}

const sandboxCache = new Map<string, { sandbox: AgentSandbox; expires: number }>();

/** Parse ```action {"tool": ..., "args": {...}}``` blocks from model output. */
export function parseChatActionBlocks(text: string): ChatToolCall[] {
  const out: ChatToolCall[] = [];
  const re = /```action\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1]) as { tool?: unknown; args?: unknown };
      if (typeof obj.tool === "string" && ["execute_command", "run_python", "run_javascript", "read_file", "write_file", "edit_file", "list_files", "create_directory", "delete_file", "run_tests", "inspect_project", "install_package", "get_process_status", "stop_process"].includes(obj.tool)) {
        out.push({
          tool: obj.tool,
          args: obj.args && typeof obj.args === "object" ? (obj.args as Record<string, unknown>) : {},
        });
      }
    } catch {
      // Malformed block — skip so one bad block can't break the loop.
    }
  }
  return out;
}

/** Does the user want code executed (not just written)? */
export function detectRunIntent(text: string): boolean {
  return /\b(run|execute|exec|test it|run it|show.*output|what.*output|debug|fix.*error|rerun|try it)\b/i.test(text);
}

/** Extract fenced python blocks from markdown. */
export function extractPythonBlocks(markdown: string): string[] {
  const out: string[] = [];
  const re = /```(?:python|py)\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const code = (m[1] || "").trim();
    if (code.length > 0) out.push(code);
  }
  return out;
}

/**
 * Get (or create) the E2B sandbox for a normal chat conversation so the model
 * can run code across turns. Ephemeral chats get a throwaway sandbox.
 */
export async function getChatSandbox(
  conversationId: string | null,
  modelId: string
): Promise<{ sandbox: AgentSandbox; sessionId: string | null }> {
  if (!isE2BConfigured()) {
    throw new Error("Code execution is not configured on the server (E2B_API_KEY missing).");
  }
  await ensureDbSchema();

  if (!conversationId) {
    const sandbox = await createAgentSandbox({ metadata: { scope: "chat-ephemeral" } });
    return { sandbox, sessionId: null };
  }

  const cached = sandboxCache.get(conversationId);
  if (cached && cached.expires > Date.now()) {
    try {
      if (await cached.sandbox.isRunning()) return { sandbox: cached.sandbox, sessionId: null };
    } catch {
      sandboxCache.delete(conversationId);
    }
  }

  // Reuse the conversation's existing agent session sandbox if still alive.
  try {
    const [existing] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.conversationId, conversationId));
    if (existing?.sandboxId) {
      try {
        const sandbox = await connectSandbox(existing.sandboxId);
        sandboxCache.set(conversationId, { sandbox, expires: Date.now() + 25 * 60 * 1000 });
        return { sandbox, sessionId: existing.id };
      } catch {
        // Expired — fall through to fresh creation.
      }
    }
  } catch {
    // DB lookup is best-effort; still create a sandbox.
  }

  const sandbox = await createAgentSandbox({
    metadata: { scope: "chat", conversation: conversationId.slice(0, 32) },
  });
  let sessionId: string | null = null;
  try {
    const [row] = await db
      .insert(agentSessions)
      .values({
        conversationId,
        title: "Chat code execution",
        modelId,
        mode: "chat",
        status: "running",
        sandboxId: sandbox.sandboxId,
        ownerToken: crypto.randomUUID(),
      })
      .returning();
    sessionId = row.id;
  } catch {
    // Persistence is best-effort; execution still works.
  }
  sandboxCache.set(conversationId, { sandbox, expires: Date.now() + 25 * 60 * 1000 });
  return { sandbox, sessionId };
}

let chatExecSeq = 0;

/** Execute one tool inside the chat sandbox and persist the record. */
export async function runChatTool(
  sandbox: AgentSandbox,
  sessionId: string | null,
  toolName: string,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
) {
  const result = await executeAgentTool(sandbox, toolName, args, stream);
  if (sessionId) {
    try {
      chatExecSeq += 1;
      await db.insert(agentExecutions).values({
        sessionId,
        seq: chatExecSeq,
        toolName,
        command:
          typeof args.command === "string"
            ? args.command.slice(0, 2000)
            : typeof args.code === "string"
              ? `${toolName} (${args.code.length} chars)`
              : typeof args.path === "string"
                ? args.path.slice(0, 500)
                : toolName,
        args,
        stdout: result.stdout.slice(0, 15000),
        stderr: result.stderr.slice(0, 15000),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        status: result.ok ? "success" : "failed",
      });
    } catch {
      // Audit persistence is best-effort.
    }
  }
  return result;
}

export function formatToolResultForModel(
  tool: string,
  result: { ok: boolean; stdout: string; stderr: string; exitCode: number; durationMs: number }
): string {
  const parts = [`exit=${result.exitCode} (${result.durationMs}ms)`];
  if (result.stdout) parts.push(`STDOUT:\n${result.stdout.slice(0, 4000)}`);
  if (result.stderr) parts.push(`STDERR:\n${result.stderr.slice(0, 4000)}`);
  if (!result.stdout && !result.stderr) parts.push("(no output)");
  return `Tool ${tool} result:\n${parts.join("\n")}`;
}
