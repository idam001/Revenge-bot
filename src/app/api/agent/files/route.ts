import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db, ensureDbSchema } from "@/db";
import { agentSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  AGENT_WORKSPACE,
  connectSandbox,
  resolveWorkspacePath,
} from "@/lib/e2b-manager";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function authorized(sessionId: string, token: string) {
  const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId));
  if (!session) return { error: "Session not found", status: 404 } as const;
  if (!token || session.ownerToken !== token) return { error: "Forbidden", status: 403 } as const;
  if (!session.sandboxId) return { error: "Sandbox is gone (expired or killed).", status: 410 } as const;
  try {
    const sandbox = await connectSandbox(session.sandboxId);
    return { session, sandbox };
  } catch {
    return { error: "Sandbox expired or unreachable. Start a new task.", status: 410 } as const;
  }
}

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return Buffer.from(content).toString("utf-8");
  return String(content ?? "");
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string;
      token?: string;
      op?: string;
      path?: string;
      content?: string;
      newPath?: string;
      recursive?: boolean;
      checkpointId?: string;
      label?: string;
    };

    if (!body.sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    const auth = await authorized(body.sessionId, body.token || "");
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { sandbox } = auth;

    const op = body.op || "list";
    const rel = (body.path || "").trim() || ".";

    // Session-local snapshots live outside the project tree, so they never end
    // up in the user's ZIP. Secrets and large build/dependency directories are
    // intentionally excluded from snapshots.
    const checkpointRoot = "/tmp/revenge-checkpoints";
    const checkpointId = body.checkpointId || "";
    const validCheckpointId = (id: string) => /^cp_[a-z0-9_]{8,64}$/.test(id);
    const ignoredCheckpointPaths =
      "--exclude=node_modules --exclude=.git --exclude=.next --exclude=dist --exclude=build --exclude=target --exclude=.env --exclude=.env.*";

    if (op === "checkpoint") {
      const id = `cp_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
      const archive = `${checkpointRoot}/${id}.tar.gz`;
      const command = `mkdir -p ${checkpointRoot} && tar -czf ${archive} ${ignoredCheckpointPaths} -C ${AGENT_WORKSPACE} .`;
      const result = await sandbox.commands.run(command, { timeoutMs: 90_000 });
      if (result.exitCode !== 0) {
        return NextResponse.json({ error: result.stderr || "Could not create checkpoint." }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        checkpoint: { id, label: (body.label || "Workspace checkpoint").slice(0, 100), createdAt: new Date().toISOString() },
      });
    }

    if (op === "checkpoints") {
      const result = await sandbox.commands.run(
        `mkdir -p ${checkpointRoot}; find ${checkpointRoot} -maxdepth 1 -type f -name 'cp_*.tar.gz' -printf '%f\n' | sort -r`,
        { timeoutMs: 15_000 }
      );
      const checkpoints = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((name) => ({ id: name.replace(/\.tar\.gz$/, ""), label: "Workspace checkpoint" }));
      return NextResponse.json({ checkpoints });
    }

    if (op === "diff") {
      if (!validCheckpointId(checkpointId)) {
        return NextResponse.json({ error: "Invalid checkpoint." }, { status: 400 });
      }
      const archive = `${checkpointRoot}/${checkpointId}.tar.gz`;
      const diffDir = `${checkpointRoot}/diff_${checkpointId}`;
      const command = `test -f ${archive} && mkdir -p ${diffDir} && tar -xzf ${archive} -C ${diffDir} && diff -ruN --exclude=node_modules --exclude=.git --exclude=.next --exclude=.env --exclude='.env.*' ${diffDir} ${AGENT_WORKSPACE} || test $? -eq 1`;
      const result = await sandbox.commands.run(command, { timeoutMs: 45_000 });
      if (result.exitCode > 1) {
        return NextResponse.json({ error: result.stderr || "Could not compare checkpoint." }, { status: 500 });
      }
      return NextResponse.json({ checkpointId, diff: result.stdout.slice(0, 120_000), truncated: result.stdout.length > 120_000 });
    }

    if (op === "restore") {
      if (!validCheckpointId(checkpointId)) {
        return NextResponse.json({ error: "Invalid checkpoint." }, { status: 400 });
      }
      const archive = `${checkpointRoot}/${checkpointId}.tar.gz`;
      const command = `test -f ${archive} && find ${AGENT_WORKSPACE} -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .git ! -name .next ! -name dist ! -name build ! -name target ! -name '.env*' -exec rm -rf -- {} + && tar -xzf ${archive} -C ${AGENT_WORKSPACE}`;
      const result = await sandbox.commands.run(command, { timeoutMs: 90_000 });
      if (result.exitCode !== 0) {
        return NextResponse.json({ error: result.stderr || "Could not restore checkpoint." }, { status: 500 });
      }
      return NextResponse.json({ ok: true, restoredCheckpointId: checkpointId });
    }

    if (op === "list") {
      const abs = rel === "." ? AGENT_WORKSPACE : resolveWorkspacePath(rel);
      const entries = await sandbox.files.list(abs);
      return NextResponse.json({
        path: rel,
        entries: entries.map((e) => ({
          name: e.name,
          type: String(e.type ?? ""),
          path: e.path,
          size: e.size ?? 0,
        })),
      });
    }

    if (op === "read") {
      const abs = resolveWorkspacePath(rel);
      const text = toText((await sandbox.files.read(abs)) as unknown);
      if (text.length > 300_000) {
        return NextResponse.json({ path: rel, content: text.slice(0, 300_000), truncated: true });
      }
      return NextResponse.json({ path: rel, content: text, truncated: false });
    }

    if (op === "write") {
      const abs = resolveWorkspacePath(rel);
      const content = String(body.content ?? "");
      if (content.length > 500_000) {
        return NextResponse.json({ error: "File too large (max 500k chars)." }, { status: 413 });
      }
      await sandbox.files.write(abs, content);
      return NextResponse.json({ ok: true, path: rel, size: content.length });
    }

    if (op === "mkdir") {
      const abs = resolveWorkspacePath(rel);
      await sandbox.files.makeDir(abs);
      return NextResponse.json({ ok: true, path: rel });
    }

    if (op === "delete") {
      const abs = resolveWorkspacePath(rel);
      try {
        await sandbox.files.remove(abs);
      } catch {
        if (body.recursive === true) {
          await sandbox.commands.run(`rm -rf ${JSON.stringify(abs)}`, { timeoutMs: 30_000 });
        } else {
          return NextResponse.json(
            { error: "Cannot delete (may be a directory — retry with recursive:true)." },
            { status: 400 }
          );
        }
      }
      return NextResponse.json({ ok: true, path: rel });
    }

    if (op === "rename") {
      if (!body.newPath) return NextResponse.json({ error: "newPath required" }, { status: 400 });
      const abs = resolveWorkspacePath(rel);
      const dest = resolveWorkspacePath(body.newPath);
      await sandbox.files.rename(abs, dest);
      return NextResponse.json({ ok: true, path: body.newPath });
    }

    if (op === "download") {
      const abs = resolveWorkspacePath(rel);
      const text = toText((await sandbox.files.read(abs)) as unknown);
      return NextResponse.json({ path: rel, content: text });
    }

    return NextResponse.json({ error: `Unknown op: ${op}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "File operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
