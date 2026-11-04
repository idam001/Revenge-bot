import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db, ensureDbSchema } from "@/db";
import { agentExecutions, agentSessions, memories, providerKeys } from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import {
  connectSandbox,
  createAgentSandbox,
  isE2BConfigured,
  killSandbox,
} from "@/lib/e2b-manager";
import { runAgentLoop, type AgentEvent, type SavedProviderConfig } from "@/lib/agent-loop";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Hobby caps serverless functions at 300s

interface CancelState {
  cancelled: boolean;
}

const cancelFlags = new Map<string, CancelState>();

function sseEncode(payload: AgentEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function loadSession(sessionId: string, token?: string) {
  const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId));
  if (!session) return null;
  if (token && session.ownerToken !== token) return "forbidden" as const;
  return session;
}

export async function GET(req: Request) {
  try {
    await ensureDbSchema();
    const url = new URL(req.url);
    const list = url.searchParams.get("list");
    if (list) {
      const rows = await db
        .select({
          id: agentSessions.id,
          title: agentSessions.title,
          modelId: agentSessions.modelId,
          mode: agentSessions.mode,
          status: agentSessions.status,
          toolCallCount: agentSessions.toolCallCount,
          createdAt: agentSessions.createdAt,
          updatedAt: agentSessions.updatedAt,
        })
        .from(agentSessions)
        .orderBy(desc(agentSessions.updatedAt))
        .limit(30);
      return NextResponse.json({ sessions: rows, e2bConfigured: isE2BConfigured() });
    }

    const sessionId = url.searchParams.get("sessionId") || "";
    const token = url.searchParams.get("token") || "";
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    const session = await loadSession(sessionId, token || undefined);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (session === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const executions = await db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.sessionId, sessionId))
      .orderBy(asc(agentExecutions.seq));
    const { ownerToken: _o, sandboxId: _s, ...publicSession } = session;
    return NextResponse.json({ session: publicSession, executions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent status failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      sessionId?: string;
      token?: string;
      task?: string;
      title?: string;
      modelId?: string;
      mode?: "auto" | "plan";
      conversationId?: string | null;
      temperature?: number;
      customSystemPrompt?: string;
    };
    const action = body.action || "start";

    if (action === "cancel") {
      if (!body.sessionId || !body.token) {
        return NextResponse.json({ error: "sessionId and token required" }, { status: 400 });
      }
      const session = await loadSession(body.sessionId, body.token);
      if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      if (session === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      cancelFlags.set(body.sessionId, { cancelled: true });

      // Terminate running processes inside the sandbox, keep files for review.
      if (session.sandboxId) {
        try {
          const sandbox = await connectSandbox(session.sandboxId);
          const procs = await sandbox.commands.list();
          await Promise.all(
            procs.map(async (p) => {
              try {
                const handle = await sandbox.commands.connect(p.pid);
                await handle.kill();
              } catch {
                // Process already gone.
              }
            })
          );
        } catch {
          // Sandbox expired — nothing to kill.
        }
      }
      await db
        .update(agentSessions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(agentSessions.id, body.sessionId));
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    if (action === "kill-sandbox") {
      if (!body.sessionId || !body.token) {
        return NextResponse.json({ error: "sessionId and token required" }, { status: 400 });
      }
      const session = await loadSession(body.sessionId, body.token);
      if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      if (session === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (session.sandboxId) {
        try {
          const sandbox = await connectSandbox(session.sandboxId);
          await killSandbox(sandbox);
        } catch {
          // Already gone.
        }
        await db
          .update(agentSessions)
          .set({ sandboxId: null, updatedAt: new Date() })
          .where(eq(agentSessions.id, body.sessionId));
      }
      return NextResponse.json({ ok: true });
    }

    if (action !== "start") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const task = (body.task ?? "").trim();
    if (!task) return NextResponse.json({ error: "Task is required" }, { status: 400 });
    if (!isE2BConfigured()) {
      return NextResponse.json(
        {
          error:
            "E2B_API_KEY is not configured on the server. Add it in your deployment environment (Render → service → Environment → E2B_API_KEY), restart, and try again.",
        },
        { status: 503 }
      );
    }

    const modelId = body.modelId || "revenge-omega-x";
    const mode = body.mode === "plan" ? "plan" : "auto";
    const ownerToken = crypto.randomUUID();
    const title = (body.title?.trim() || task).slice(0, 80);

    const [session] = await db
      .insert(agentSessions)
      .values({
        conversationId: body.conversationId || null,
        title,
        modelId,
        mode,
        status: "running",
        ownerToken,
      })
      .returning();

    const [keyRows, memoryRows] = await Promise.all([
      db.select().from(providerKeys),
      db.select().from(memories),
    ]);
    void memoryRows;
    const savedKeysMap: Record<string, SavedProviderConfig> = {};
    for (const row of keyRows) {
      savedKeysMap[row.providerId] = {
        providerId: row.providerId,
        apiKey: row.apiKey,
        baseUrl: row.baseUrl,
        customModelId: row.customModelId,
        enabled: row.enabled,
      };
    }

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: AgentEvent) => {
          try {
            controller.enqueue(sseEncode(payload));
          } catch {
            // Client disconnected.
          }
        };
        const flag: CancelState = { cancelled: false };
        cancelFlags.set(session.id, flag);

        send({
          type: "agent.started",
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          token: ownerToken,
        });

        try {
          let sandbox;
          try {
            sandbox = await createAgentSandbox({
              metadata: { session: session.id, model: modelId },
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Sandbox creation failed";
            send({ type: "agent.failed", sessionId: session.id, timestamp: new Date().toISOString(), error: msg });
            await db
              .update(agentSessions)
              .set({ status: "failed", summary: msg, updatedAt: new Date() })
              .where(eq(agentSessions.id, session.id));
            controller.close();
            return;
          }

          await db
            .update(agentSessions)
            .set({ sandboxId: sandbox.sandboxId, updatedAt: new Date() })
            .where(eq(agentSessions.id, session.id));

          let seq = 0;
          const outcome = await runAgentLoop(sandbox, {
            sessionId: session.id,
            task,
            modelId,
            mode,
            temperature: typeof body.temperature === "number" ? body.temperature : 0.4,
            customSystemPrompt: body.customSystemPrompt,
            savedKeysMap,
            shouldCancel: () => flag.cancelled,
            emit: (e) => send(e),
            onToolRecord: async (rec) => {
              seq += 1;
              await db.insert(agentExecutions).values({
                sessionId: session.id,
                seq,
                toolName: rec.toolName,
                command: rec.command,
                args: rec.args,
                stdout: rec.stdout.slice(0, 15000),
                stderr: rec.stderr.slice(0, 15000),
                exitCode: rec.exitCode,
                durationMs: rec.durationMs,
                status: rec.status,
              });
              await db
                .update(agentSessions)
                .set({ toolCallCount: seq, updatedAt: new Date() })
                .where(eq(agentSessions.id, session.id));
            },
          });

          await db
            .update(agentSessions)
            .set({ status: outcome.status, summary: outcome.summary.slice(0, 8000), updatedAt: new Date() })
            .where(eq(agentSessions.id, session.id));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Agent run failed";
          send({ type: "agent.failed", sessionId: session.id, timestamp: new Date().toISOString(), error: msg });
          await db
            .update(agentSessions)
            .set({ status: "failed", summary: msg.slice(0, 8000), updatedAt: new Date() })
            .where(eq(agentSessions.id, session.id));
        } finally {
          cancelFlags.delete(session.id);
          controller.close();
        }
      },
      cancel() {
        cancelFlags.set(session.id, { cancelled: true });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
