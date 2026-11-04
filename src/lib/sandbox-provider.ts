/**
 * Sandbox provider for Agent Mode.
 *
 * Agent Mode used to require an E2B API key, which this deployment never had —
 * so every tool call failed with "E2B_API_KEY is not configured" and the agent
 * could not do anything at all.
 *
 * This module keeps the E2B-style surface the agent code already uses
 * (`sandbox.files.*`, `sandbox.commands.*`, `sandbox.sandboxId`) but backs it
 * with **Vercel Sandbox** (Firecracker microVMs), which authenticates through
 * OIDC automatically on Vercel — no extra key to configure. If an E2B key is
 * explicitly set, E2B is still used.
 */
import { Sandbox } from "@vercel/sandbox";

export type SandboxDriver = "vercel" | "e2b";

export interface CommandRunOptions {
  cwd?: string;
  timeoutMs?: number;
  background?: boolean;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Present only for background runs. */
  pid?: number;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface AgentSandboxHandle {
  sandboxId: string;
  driver: SandboxDriver;
  files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    list(path: string): Promise<FileEntry[]>;
    makeDir(path: string): Promise<void>;
    remove(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
  };
  commands: {
    run(command: string, opts?: CommandRunOptions): Promise<CommandResult>;
    list(): Promise<{ pid: number; cmd?: string }[]>;
    connect?(pid: number): Promise<{ kill(): Promise<void> }>;
  };
  kill(): Promise<void>;
}

export const AGENT_WORKSPACE = "/home/user/workspace";

/** True when Vercel Sandbox can authenticate (automatic on a Vercel deployment). */
export function isVercelSandboxAvailable(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.VERCEL_OIDC_TOKEN ||
      (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID)
  );
}

export function isE2BConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY?.trim());
}

/** Agent Mode is usable when either backend is available. */
export function isSandboxConfigured(): boolean {
  return isVercelSandboxAvailable() || isE2BConfigured();
}

export function activeDriver(): SandboxDriver | null {
  if (isVercelSandboxAvailable()) return "vercel";
  if (isE2BConfigured()) return "e2b";
  return null;
}

/* ------------------------------------------------------------------ */
/* Vercel Sandbox adapter                                              */
/* ------------------------------------------------------------------ */

function wrapVercel(sandbox: Sandbox): AgentSandboxHandle {
  const id = sandbox.name ?? "";

  return {
    sandboxId: id,
    driver: "vercel",
    files: {
      async read(path) {
        return sandbox.fs.readFile(path, "utf8");
      },
      async write(path, content) {
        await sandbox.fs.writeFile(path, content, "utf8");
      },
      async list(path) {
        const names = await sandbox.fs.readdir(path);
        return names.map((name) => ({
          name,
          path: `${path.replace(/\/$/, "")}/${name}`,
          type: "file" as const,
        }));
      },
      async makeDir(path) {
        // Vercel's mkDir is non-recursive for nested paths in some images, so
        // fall back to a shell mkdir -p which is always recursive.
        try {
          await sandbox.mkDir(path);
        } catch {
          await sandbox.runCommand("mkdir", ["-p", path]);
        }
      },
      async remove(path) {
        await sandbox.runCommand("rm", ["-rf", path]);
      },
      async rename(from, to) {
        await sandbox.runCommand("mv", [from, to]);
      },
    },
    commands: {
      async run(command, o) {
        // Background job: detach it and surface the shell pid so the agent can
        // query or stop it later. Vercel exposes no process table, so the pid
        // is read straight back out of the shell.
        if (o?.background) {
          const launcher = `( ${command} ) >/tmp/.agentjob.log 2>&1 & echo $!`;
          const pidOut = await sandbox.runCommand("bash", ["-lc", launcher]);
          const pid = Number((await pidOut.stdout()).trim()) || 0;
          if (pid) o?.onStdout?.(`Background process started (pid ${pid}).`);
          return { stdout: "", stderr: "", exitCode: 0, pid };
        }
        // The agent issues shell strings; route them through bash so quoting,
        // pipes and redirects keep working exactly as before.
        // runCommand has no cwd option, so cd explicitly inside the shell.
        const script = o?.cwd ? `cd ${JSON.stringify(o.cwd)} && ${command}` : command;
        const result = await sandbox.runCommand("bash", ["-lc", script], {
          ...(o?.timeoutMs && o.timeoutMs > 0 ? { timeoutMs: o.timeoutMs } : {}),
        });
        const stdout = await result.stdout();
        const stderr = await result.stderr();
        if (stdout) o?.onStdout?.(stdout);
        if (stderr) o?.onStderr?.(stderr);
        return { stdout, stderr, exitCode: result.exitCode ?? 0 };
      },
      async list() {
        // Vercel Sandbox does not expose a process table; background jobs are
        // tracked by pid in the agent's own bookkeeping instead.
        return [];
      },
    },
    async kill() {
      try {
        await sandbox.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

export async function createVercelSandbox(opts?: { timeoutMs?: number }): Promise<AgentSandboxHandle> {
  const sandbox = await Sandbox.create({
    // Hobby caps sessions at 45 minutes; 30 matches the previous agent TTL.
    timeout: opts?.timeoutMs ?? 30 * 60 * 1000,
    persistent: false,
  });
  const handle = wrapVercel(sandbox);
  await handle.files.makeDir(AGENT_WORKSPACE).catch(() => {});
  return handle;
}

export async function connectVercelSandbox(id: string): Promise<AgentSandboxHandle> {
  // The Vercel SDK identifies sandboxes by name, which is what we persist.
  const sandbox = await Sandbox.get({ name: id });
  return wrapVercel(sandbox);
}
