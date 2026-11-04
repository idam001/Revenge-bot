import { NextResponse } from "next/server";
import JSZip from "jszip";
import { db, ensureDbSchema } from "@/db";
import { agentSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AGENT_WORKSPACE, connectSandbox } from "@/lib/e2b-manager";
import type { AgentSandbox } from "@/lib/e2b-manager";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", ".next", "dist"]);
const MAX_FILES = 500;
const MAX_BYTES = 25 * 1024 * 1024;

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return Buffer.from(content).toString("utf-8");
  return String(content ?? "");
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string; token?: string };
    if (!body.sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, body.sessionId));
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (!body.token || session.ownerToken !== body.token) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!session.sandboxId) {
      return NextResponse.json({ error: "Sandbox is gone (expired or killed)." }, { status: 410 });
    }

    let sandbox: AgentSandbox;
    try {
      sandbox = await connectSandbox(session.sandboxId);
    } catch {
      return NextResponse.json({ error: "Sandbox expired or unreachable." }, { status: 410 });
    }

    const zip = new JSZip();
    let fileCount = 0;
    let byteCount = 0;

    const walk = async (dir: string, prefix: string): Promise<void> => {
      if (fileCount >= MAX_FILES || byteCount >= MAX_BYTES) return;
      let entries;
      try {
        entries = await sandbox.files.list(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (fileCount >= MAX_FILES || byteCount >= MAX_BYTES) break;
        const name = entry.name;
        if (!name || name === "." || name === "..") continue;
        const fullPath = `${dir}/${name}`;
        const zipPath = prefix ? `${prefix}/${name}` : name;
        const isDir = String(entry.type ?? "") === "dir";
        if (isDir) {
          if (SKIP_DIRS.has(name)) continue;
          zip.folder(zipPath);
          await walk(fullPath, zipPath);
        } else {
          try {
            const text = toText((await sandbox.files.read(fullPath)) as unknown);
            if (text.length > 2_000_000) continue;
            zip.file(zipPath, text);
            fileCount += 1;
            byteCount += text.length;
          } catch {
            // Unreadable (binary/locked) — skip rather than fail the whole export.
          }
        }
      }
    };

    await walk(AGENT_WORKSPACE, "");
    if (fileCount === 0) {
      return NextResponse.json({ error: "Workspace is empty — nothing to export." }, { status: 400 });
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const safeTitle = (session.title || "revenge-agent-project").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeTitle}.zip"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ZIP export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
