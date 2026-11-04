import { Sandbox } from "e2b";

export type AgentSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

/** All agent file operations are confined to this directory inside the sandbox. */
export const AGENT_WORKSPACE = "/home/user/workspace";

export const SANDBOX_TTL_MS = 30 * 60 * 1000;
export const MAX_OUTPUT_CHARS = 15_000;

export function isE2BConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY?.trim());
}

function requireKey(): string {
  const key = process.env.E2B_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "E2B_API_KEY is not configured. Add it as a server-side environment variable " +
        "(Render → your service → Environment → E2B_API_KEY), then restart. " +
        "Code execution is unavailable until then."
    );
  }
  return key;
}

/** Create a fresh isolated sandbox for one agent session. Key never leaves the server. */
export async function createAgentSandbox(opts?: {
  timeoutMs?: number;
  metadata?: Record<string, string>;
}): Promise<AgentSandbox> {
  requireKey();
  const sandbox = await Sandbox.create({
    timeoutMs: opts?.timeoutMs ?? SANDBOX_TTL_MS,
    metadata: { app: "revenge-gpt-agent", ...(opts?.metadata ?? {}) },
  });
  try {
    await sandbox.files.makeDir(AGENT_WORKSPACE);
  } catch {
    // Directory may already exist — safe to ignore.
  }
  return sandbox;
}

/** Reconnect to a still-valid sandbox (running or paused with auto-resume). */
export async function connectSandbox(sandboxId: string): Promise<AgentSandbox> {
  requireKey();
  return await Sandbox.connect(sandboxId);
}

export async function killSandbox(sandbox: AgentSandbox): Promise<void> {
  try {
    await sandbox.kill();
  } catch {
    // Already dead or expired — nothing to do.
  }
}

/** Normalize a user-supplied path and confine it to the agent workspace. */
export function resolveWorkspacePath(input: string): string {
  const raw = (input || "").trim();
  if (!raw) throw new Error("A file path is required.");
  // Reject absolute escapes and parent traversal before normalization.
  const parts = raw.split("/").filter((p) => p.length > 0 && p !== ".");
  const clean: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (clean.length === 0) {
        throw new Error(`Path escapes the workspace: ${input}`);
      }
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
  /\brm\s+-rf\s+\/(?!\s*$)/, // rm -rf / or /anything (workspace-scoped rm -rf is rewritten below)
  /:\(\)\s*\{\s*:\|:\s*&\s*\}/, // fork bomb
  /\bmkfs\b/,
  /\bdd\s+if=/,
];

export function assertCommandAllowed(command: string): void {
  for (const re of FORBIDDEN_COMMAND_PATTERNS) {
    if (re.test(command)) {
      throw new Error("Blocked: destructive command outside the agent workspace is not allowed.");
    }
  }
}

/**
 * Rewrite `rm -rf <workspace-relative>` into an absolute workspace path so a
 * bare relative delete can never escape. Throws for anything outside workspace.
 */
export function safeRmRf(command: string): string {
  return command.replace(/rm\s+-rf?\s+([^\s;&|]+)/g, (_m, target: string) => {
    const resolved = resolveWorkspacePath(target);
    return `rm -rf ${JSON.stringify(resolved)}`;
  });
}
