/**
 * Agent sandbox manager.
 *
 * Despite the historical filename (kept so no agent code had to change), this
 * now dispatches to whichever sandbox backend is available:
 *
 *   1. Vercel Sandbox  — automatic on Vercel via OIDC, no key required, bills
 *                        only active CPU.
 *   2. E2B             — used only when E2B_API_KEY is explicitly configured.
 *
 * Both are presented through one E2B-shaped interface, so agent-tools.ts,
 * agent-loop.ts and the /api/agent routes work unchanged.
 */
import type { AgentSandboxHandle } from "./sandbox-provider";
import {
  AGENT_WORKSPACE,
  activeDriver,
  connectVercelSandbox,
  createVercelSandbox,
  isE2BConfigured,
  isSandboxConfigured,
  isVercelSandboxAvailable,
} from "./sandbox-provider";

export type AgentSandbox = AgentSandboxHandle;

export { AGENT_WORKSPACE };
export { isE2BConfigured, isSandboxConfigured, isVercelSandboxAvailable };

export const SANDBOX_TTL_MS = 30 * 60 * 1000;
export const MAX_OUTPUT_CHARS = 15_000;

/** True when Agent Mode can actually execute commands right now. */
export function isSandboxReady(): boolean {
  return isSandboxConfigured();
}

function requireBackend() {
  const driver = activeDriver();
  if (!driver) {
    throw new Error(
      "Agent execution is unavailable: no sandbox backend is configured. " +
        "On Vercel this is automatic; elsewhere set E2B_API_KEY."
    );
  }
  return driver;
}

/** Create a fresh isolated sandbox for one agent session. */
export async function createAgentSandbox(opts?: {
  timeoutMs?: number;
  metadata?: Record<string, string>;
}): Promise<AgentSandbox> {
  const driver = requireBackend();
  if (driver === "vercel") {
    return await createVercelSandbox({ timeoutMs: opts?.timeoutMs ?? SANDBOX_TTL_MS });
  }
  return await createE2BSandbox(opts);
}

/** Reconnect to a still-valid sandbox by id. */
export async function connectSandbox(sandboxId: string): Promise<AgentSandbox> {
  const driver = requireBackend();
  if (driver === "vercel") return await connectVercelSandbox(sandboxId);
  const { Sandbox } = await import("e2b");
  const sandbox = await Sandbox.connect(sandboxId);
  return wrapE2B(sandbox, sandboxId);
}

export async function killSandbox(sandbox: AgentSandbox): Promise<void> {
  try {
    await sandbox.kill();
  } catch {
    /* already dead or expired */
  }
}

/* ------------------------------------------------------------------ */
/* E2B fallback (only when a key is configured)                        */
/* ------------------------------------------------------------------ */

type E2BSandbox = Awaited<ReturnType<typeof import("e2b").Sandbox.connect>>;

function wrapE2B(sandbox: E2BSandbox, id: string): AgentSandbox {
  return {
    sandboxId: id,
    driver: "e2b",
    files: {
      async read(path) {
        const raw = (await sandbox.files.read(path)) as unknown;
        if (typeof raw === "string") return raw;
        if (raw instanceof Uint8Array) return Buffer.from(raw).toString("utf-8");
        return String(raw ?? "");
      },
      async write(path, content) {
        await sandbox.files.write(path, content);
      },
      async list(path) {
        const entries = await sandbox.files.list(path);
        return entries.map((e) => ({
          name: e.name,
          path: `${path.replace(/\/$/, "")}/${e.name}`,
          type: (e.type === "dir" ? "dir" : "file") as "file" | "dir",
        }));
      },
      async makeDir(path) {
        await sandbox.files.makeDir(path);
      },
      async remove(path) {
        await sandbox.files.remove(path);
      },
      async rename(from, to) {
        await sandbox.files.rename(from, to);
      },
    },
    commands: {
      async run(command, o) {
        const r = await sandbox.commands.run(command, {
          ...(o?.cwd ? { cwd: o.cwd } : {}),
          ...(o?.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
          ...(o?.background ? { background: o.background } : {}),
          ...(o?.onStdout ? { onStdout: o.onStdout } : {}),
          ...(o?.onStderr ? { onStderr: o.onStderr } : {}),
        });
        return {
          stdout: (r as { stdout?: string }).stdout ?? "",
          stderr: (r as { stderr?: string }).stderr ?? "",
          exitCode: (r as { exitCode?: number }).exitCode ?? 0,
        };
      },
      async list() {
        const procs = await sandbox.commands.list();
        return procs.map((p) => ({ pid: p.pid }));
      },
    },
    async kill() {
      try {
        await sandbox.kill();
      } catch {
        /* already dead */
      }
    },
  };
}

async function createE2BSandbox(opts?: {
  timeoutMs?: number;
  metadata?: Record<string, string>;
}): Promise<AgentSandbox> {
  const { Sandbox } = await import("e2b");
  const sandbox = await Sandbox.create({
    timeoutMs: opts?.timeoutMs ?? SANDBOX_TTL_MS,
    metadata: { app: "revenge-gpt-agent", ...(opts?.metadata ?? {}) },
  });
  const handle = wrapE2B(sandbox, sandbox.sandboxId);
  await handle.files.makeDir(AGENT_WORKSPACE).catch(() => {});
  return handle;
}

/** Normalize a user-supplied path and confine it to the agent workspace. */
export function resolveWorkspacePath(input: string): string {
  const raw = (input || "").trim();
  if (!raw) throw new Error("A file path is required.");
  const parts = raw.split("/").filter((p) => p.length > 0 && p !== ".");
  const clean: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (clean.length === 0) throw new Error(`Path escapes the workspace: ${input}`);
      clean.pop();
    } else if (/^~/.test(part)) {
      throw new Error(`Path escapes the workspace: ${input}`);
    } else {
      clean.push(part);
    }
  }
  const resolved = `${AGENT_WORKSPACE}/${clean.join("/")}`;
  if (!resolved.startsWith(AGENT_WORKSPACE + "/") && resolved !== AGENT_WORKSPACE) {
    throw new Error(`Path escapes the workspace: ${input}`);
  }
  return resolved;
}

export function truncateOutput(text: string, limit = MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: text.slice(0, limit) + `\n… [output truncated at ${limit} chars]`,
    truncated: true,
  };
}

/** Commands that are never allowed, even inside the disposable sandbox. */
const FORBIDDEN_COMMAND_PATTERNS: RegExp[] = [
  // rm -rf / , rm -rf /* , rm -rf ~ , rm -rf .. , or any absolute path that is
  // not inside the agent workspace.
  /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:\/|\/\*|~|\$HOME|\.\.)(?:\s|$)/,
  // fork bomb
  /:\(\)\s*\{\s*:\|:\s*&\s*\}/,
  // disk / block-device destruction
  /\bmkfs(?:\.|\s)/,
  /\bdd\s+if=/,
  /\b(?:shutdown|reboot|halt|poweroff)\b/,
  /\bchmod\s+-R\s+777\s+\//,
];

export function assertCommandAllowed(command: string): void {
  for (const re of FORBIDDEN_COMMAND_PATTERNS) {
    if (re.test(command)) {
      throw new Error("Blocked: destructive command outside the agent workspace is not allowed.");
    }
  }
}

/** Rewrite `rm -rf <workspace-relative>` into an absolute workspace path. */
export function safeRmRf(command: string): string {
  return command.replace(/rm\s+-rf?\s+([^\s;&|]+)/g, (_m, target: string) => {
    const resolved = resolveWorkspacePath(target);
    return `rm -rf ${JSON.stringify(resolved)}`;
  });
}
