import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db, ensureDbSchema } from "@/db";
import { getOwner, requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/api-response";
import { agentExecutions, agentMessages, agentSessions, memories, providerKeys } from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import {
  connectSandbox,
  createAgentSandbox,
  isSandboxConfigured,
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

async function loadSession(sessionId: string, token?: string, req?: Request) {
  const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId));
  if (!session) return null;
  // Session capability token must match, AND the request must come from the
  // same owner (account or guest) that created the session.
  const owner = await getOwner({ request: req });
  if (!owner) return "forbidden" as const;
  if (session.ownerKey !== owner.key) return "forbidden" as const;
  if (token && session.ownerToken !== token) return "forbidden" as const;
  return session;
}

export async function GET(req: Request) {
  try {
    await ensureDbSchema();
    const url = new URL(req.url);
    const list = url.searchParams.get("list");
    if (list) {
      // SECURITY: this used to return every session from every account. The
      // list is now scoped to the signed-in owner, and anonymous callers get
      // nothing back at all.
      const gate = await requireUser(req);
      if (gate.response) return gate.response;
      const listOwner = await getOwner({ create: false, request: req });
      if (!listOwner) return NextResponse.json({ sessions: [], sandboxConfigured: isSandboxConfigured() });
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
        .where(eq(agentSessions.ownerKey, listOwner.key))
        .orderBy(desc(agentSessions.updatedAt))
        .limit(30);
      return NextResponse.json({ sessions: rows, sandboxConfigured: isSandboxConfigured() });
    }

    const sessionId = url.searchParams.get("sessionId") || "";
    const token = url.searchParams.get("token") || "";
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    const session = await loadSession(sessionId, token || undefined, req);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (session === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const executions = await db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.sessionId, sessionId))
      .orderBy(asc(agentExecutions.seq));
    let messages: Array<{ id: string; role: string; content: string; createdAt: string }> = [];
    try {
      const rows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.sessionId, sessionId))
        .orderBy(asc(agentMessages.createdAt));
      messages = rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt:
          r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ""),
      }));
    } catch {
      // Pre-migration sessions simply have no message history yet.
    }
    const { ownerToken: _o, sandboxId: _s, ...publicSession } = session;
    return NextResponse.json({ session: publicSession, executions, messages });
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
      const session = await loadSession(body.sessionId, body.token, req);
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
                if (sandbox.commands.connect) {
                  const handle = await sandbox.commands.connect(p.pid);
                  await handle.kill();
                } else {
                  await sandbox.commands.run(`kill -9 ${p.pid} 2>/dev/null || true`);
                }
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
      const session = await loadSession(body.sessionId, body.token, req);
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

    // CONTINUE AN EXISTING SESSION
    // A follow-up message in the same agent chat reuses the session, its sandbox
    // and its conversation history, so Agent Mode behaves like a normal chat.
    const continueId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (continueId && isUuid(continueId)) {
      const existing = await loadSession(continueId, body.token || undefined, req);
      if (!existing || existing === "forbidden") {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const priorRows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.sessionId, continueId))
        .orderBy(asc(agentMessages.createdAt));
      const priorHistory = priorRows.map((r) => ({
        role: r.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: r.content,
      }));

      await db.insert(agentMessages).values({
        ownerKey: existing.ownerKey,
        sessionId: continueId,
        role: "user",
        content: task,
      });
      await db
        .update(agentSessions)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(agentSessions.id, continueId));

      const [keyRows2] = await Promise.all([
        db.select().from(providerKeys).where(eq(providerKeys.ownerKey, existing.ownerKey)),
      ]);
      const savedKeysMap2: Record<string, SavedProviderConfig> = {};
      for (const row of keyRows2) {
        savedKeysMap2[row.providerId] = {
          providerId: row.providerId,
          apiKey: row.apiKey,
          baseUrl: row.baseUrl,
          customModelId: row.customModelId,
          enabled: row.enabled,
        };
      }

      const stream2 = new ReadableStream({
        async start(controller) {
          const send2 = (payload: AgentEvent) => {
            try {
              controller.enqueue(sseEncode(payload));
            } catch {
              /* client gone */
            }
          };
          const flag2: CancelState = { cancelled: false };
          cancelFlags.set(continueId, flag2);
          send2({
            type: "agent.started",
            sessionId: continueId,
            timestamp: new Date().toISOString(),
            token: existing.ownerToken,
            continued: true,
          });

          try {
            let sb;
            try {
              sb = existing.sandboxId
                ? await connectSandbox(existing.sandboxId)
                : await createAgentSandbox({ metadata: { session: continueId } });
            } catch {
              sb = await createAgentSandbox({ metadata: { session: continueId } });
            }
            await db
              .update(agentSessions)
              .set({ sandboxId: sb.sandboxId, updatedAt: new Date() })
              .where(eq(agentSessions.id, continueId));

            let seq2 = 0;
            const outcome2 = await runAgentLoop(sb, {
              sessionId: continueId,
              task,
              history: priorHistory,
              modelId: existing.modelId,
              mode: existing.mode === "plan" ? "plan" : "auto",
              temperature: typeof body.temperature === "number" ? body.temperature : 0.4,
              savedKeysMap: savedKeysMap2,
              shouldCancel: () => flag2.cancelled,
              emit: (e) => send2(e),
              onToolRecord: async (record) => {
                await db.insert(agentExecutions).values({
                  ownerKey: existing.ownerKey,
                  sessionId: continueId,
                  seq: seq2++,
                  ...record,
                });
              },
            });

            await db.insert(agentMessages).values({
              ownerKey: existing.ownerKey,
              sessionId: continueId,
              role: "assistant",
              content: outcome2.summary ?? "",
            });
            await db
              .update(agentSessions)
              .set({
                status: outcome2.status,
                summary: outcome2.summary,
                toolCallCount: existing.toolCallCount + outcome2.toolCallCount,
                updatedAt: new Date(),
              })
              .where(eq(agentSessions.id, continueId));
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Agent run failed";
            send2({ type: "agent.failed", sessionId: continueId, timestamp: new Date().toISOString(), error: msg });
          } finally {
            cancelFlags.delete(continueId);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        },
      });

      return new Response(stream2, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (!isSandboxConfigured()) {
      return NextResponse.json(
        {
          error:
            "Agent execution is not available: no sandbox backend is configured. On Vercel this is automatic; elsewhere set E2B_API_KEY.",
        },
        { status: 503 }
      );
    }

    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return Response.json({ error: "Session unavailable", code: "NO_SESSION" }, { status: 401 });
    }
    const modelId = body.modelId || "revenge-omega-x";
    const mode = body.mode === "plan" ? "plan" : "auto";
    const ownerToken = crypto.randomUUID();
    const title = (body.title?.trim() || task).slice(0, 80);

    const [session] = await db
      .insert(agentSessions)
      .values({
        ownerKey: owner.key,
        conversationId: body.conversationId || null,
        title,
        modelId,
        mode,
        status: "running",
        ownerToken,
      })
      .returning();

    const [keyRows, memoryRows] = await Promise.all([
      db.select().from(providerKeys).where(eq(providerKeys.ownerKey, owner.key)),
      db.select().from(memories).where(eq(memories.ownerKey, owner.key)),
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

    // Record the opening prompt so a reload replays the same conversation.
    try {
      await db.insert(agentMessages).values({
        ownerKey: owner.key,
        sessionId: session.id,
        role: "user",
        content: task,
      });
    } catch {
      // History is a nicety; never block the run on it.
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
          if (outcome.summary) {
            try {
              await db.insert(agentMessages).values({
                ownerKey: owner.key,
                sessionId: session.id,
                role: "assistant",
                content: outcome.summary.slice(0, 12000),
              });
            } catch {
              // Ignore history write failures.
            }
          }
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
