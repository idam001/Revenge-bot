import type { AgentSandbox } from "./e2b-manager";
import {
  AGENT_WORKSPACE,
  assertCommandAllowed,
  resolveWorkspacePath,
  safeRmRf,
  truncateOutput,
} from "./e2b-manager";

export interface ToolStreamChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ToolResult {
  ok: boolean;
  tool: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  truncated: boolean;
  extra?: Record<string, unknown>;
}

export type ToolStreamHandler = (chunk: ToolStreamChunk) => void;

interface ExecOpts {
  cwd?: string;
  timeoutMs?: number;
  background?: boolean;
  onStream?: ToolStreamHandler;
}

const DEFAULT_CMD_TIMEOUT = 120_000;
const MAX_CMD_TIMEOUT = 300_000;

function nowIso(): string {
  return new Date().toISOString();
}

function shapeResult(
  tool: string,
  startedAt: string,
  stdout: string,
  stderr: string,
  exitCode: number,
  extra?: Record<string, unknown>
): ToolResult {
  const so = truncateOutput(stdout);
  const se = truncateOutput(stderr);
  return {
    ok: exitCode === 0,
    tool,
    stdout: so.text,
    stderr: se.text,
    exitCode,
    durationMs: Date.now() - Date.parse(startedAt),
    startedAt,
    completedAt: nowIso(),
    truncated: so.truncated || se.truncated,
    ...(extra ? { extra } : {}),
  };
}

function extractCommandError(err: unknown): { stdout: string; stderr: string; exitCode: number } {
  const e = err as { stdout?: unknown; stderr?: unknown; exitCode?: unknown; message?: string };
  const stdout = typeof e?.stdout === "string" ? e.stdout : "";
  const stderr =
    typeof e?.stderr === "string" && e.stderr
      ? e.stderr
      : e?.message
        ? String(e.message)
        : "Command failed";
  const exitCode = typeof e?.exitCode === "number" ? e.exitCode : 1;
  return { stdout, stderr, exitCode };
}

/** Run a command in the sandbox with real streaming + timeout + background support. */
async function runSandboxCommand(
  sandbox: AgentSandbox,
  tool: string,
  command: string,
  opts: ExecOpts = {}
): Promise<ToolResult & { pid?: number; background?: boolean }> {
  const startedAt = nowIso();
  assertCommandAllowed(command);
  const safeCommand = safeRmRf(command);
  const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_CMD_TIMEOUT, MAX_CMD_TIMEOUT);
  const cwd = opts.cwd ? resolveWorkspacePath(opts.cwd) : AGENT_WORKSPACE;

  const streamOpts = opts.onStream
    ? {
        onStdout: (data: string) => opts.onStream?.({ stream: "stdout", text: data }),
        onStderr: (data: string) => opts.onStream?.({ stream: "stderr", text: data }),
      }
    : {};

  if (opts.background) {
    try {
      const handle = await sandbox.commands.run(safeCommand, {
        cwd,
        timeoutMs: 0,
        background: true,
        ...streamOpts,
      });
      return {
        ...shapeResult(tool, startedAt, "", `Background process started (pid ${handle.pid}).`, 0, {
          pid: handle.pid,
        }),
        pid: handle.pid,
        background: true,
      };
    } catch (err) {
      const { stdout, stderr, exitCode } = extractCommandError(err);
      return shapeResult(tool, startedAt, stdout, stderr, exitCode);
    }
  }

  try {
    const result = await sandbox.commands.run(safeCommand, {
      cwd,
      timeoutMs,
      background: false,
      ...streamOpts,
    });
    return shapeResult(tool, startedAt, result.stdout ?? "", result.stderr ?? "", result.exitCode ?? 0);
  } catch (err) {
    const { stdout, stderr, exitCode } = extractCommandError(err);
    return shapeResult(tool, startedAt, stdout, stderr, exitCode);
  }
}

function readSandboxText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return Buffer.from(content).toString("utf-8");
  if (Array.isArray(content)) return Buffer.from(content as number[]).toString("utf-8");
  return String(content ?? "");
}

/* ------------------------------------------------------------------ *
 * Tool implementations — every one hits the real E2B sandbox.
 * ------------------------------------------------------------------ */

async function toolExecuteCommand(
  sandbox: AgentSandbox,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult & { pid?: number; background?: boolean }> {
  const command = String(args.command ?? "").trim();
  if (!command) throw new Error("execute_command requires a non-empty 'command'.");
  if (command.length > 8000) throw new Error("Command too long (max 8000 chars).");
  return runSandboxCommand(sandbox, "execute_command", command, {
    cwd: typeof args.cwd === "string" ? args.cwd : undefined,
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    background: args.background === true,
    onStream: stream,
  });
}

async function toolRunPython(
  sandbox: AgentSandbox,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult> {
  const code = String(args.code ?? "");
  if (!code.trim()) throw new Error("run_python requires non-empty 'code'.");
  if (code.length > 100_000) throw new Error("Code too long (max 100k chars).");
  const file = `/tmp/agent_run_${Date.now()}.py`;
  await sandbox.files.write(file, code);
  const argv = Array.isArray(args.args) ? args.args.map(String).join(" ") : "";
  return runSandboxCommand(sandbox, "run_python", `python3 ${JSON.stringify(file)} ${argv}`.trim(), {
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    onStream: stream,
  });
}

async function toolRunJavascript(
  sandbox: AgentSandbox,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult> {
  const code = String(args.code ?? "");
  if (!code.trim()) throw new Error("run_javascript requires non-empty 'code'.");
  if (code.length > 100_000) throw new Error("Code too long (max 100k chars).");
  const isTs = /\.ts(x)?\b|:\s*(string|number|boolean|any)\b/.test(code.slice(0, 2000));
  const file = `/tmp/agent_run_${Date.now()}${isTs ? ".ts" : ".mjs"}`;
  await sandbox.files.write(file, code);
  const runner = isTs ? "npx -y tsx" : "node";
  if (isTs) {
    await sandbox.commands.run("command -v tsx >/dev/null 2>&1 || npm i -g tsx >/dev/null 2>&1 || true", {
      timeoutMs: 120_000,
    }).catch(() => undefined);
  }
  return runSandboxCommand(sandbox, "run_javascript", `${runner} ${JSON.stringify(file)}`, {
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    onStream: stream,
  });
}

async function toolReadFile(sandbox: AgentSandbox, args: Record<string, unknown>): Promise<ToolResult> {
  const startedAt = nowIso();
  const path = resolveWorkspacePath(String(args.path ?? ""));
  try {
    const raw = (await sandbox.files.read(path)) as unknown;
    const text = readSandboxText(raw);
    if (text.length > 100_000) {
      return shapeResult("read_file", startedAt, text.slice(0, 100_000), "File truncated at 100k chars.", 0, { path });
    }
    return shapeResult("read_file", startedAt, text, "", 0, { path });
  } catch (err) {
    return shapeResult("read_file", startedAt, "", err instanceof Error ? err.message : "Read failed", 1, { path });
  }
}

async function toolWriteFile(sandbox: AgentSandbox, args: Record<string, unknown>): Promise<ToolResult> {
  const startedAt = nowIso();
  const path = resolveWorkspacePath(String(args.path ?? ""));
  const content = String(args.content ?? "");
  if (content.length > 500_000) throw new Error("File too large (max 500k chars).");
  try {
    await sandbox.files.write(path, content);
    return shapeResult("write_file", startedAt, `Wrote ${content.length} chars to ${path}`, "", 0, { path });
  } catch (err) {
    return shapeResult("write_file", startedAt, "", err instanceof Error ? err.message : "Write failed", 1, { path });
  }
}

async function toolEditFile(sandbox: AgentSandbox, args: Record<string, unknown>): Promise<ToolResult> {
  const startedAt = nowIso();
  const path = resolveWorkspacePath(String(args.path ?? ""));
  const oldText = String(args.oldText ?? "");
  const newText = String(args.newText ?? "");
  if (!oldText) throw new Error("edit_file requires 'oldText'.");
  try {
    const current = readSandboxText((await sandbox.files.read(path)) as unknown);
    const idx = current.indexOf(oldText);
    if (idx === -1) {
      return shapeResult("edit_file", startedAt, "", `oldText not found in ${path} — no changes made.`, 1, { path });
    }
    const updated = current.slice(0, idx) + newText + current.slice(idx + oldText.length);
    await sandbox.files.write(path, updated);
    return shapeResult("edit_file", startedAt, `Edited ${path} (${oldText.length} chars replaced).`, "", 0, { path });
  } catch (err) {
    return shapeResult("edit_file", startedAt, "", err instanceof Error ? err.message : "Edit failed", 1, { path });
  }
}

async function toolListFiles(sandbox: AgentSandbox, args: Record<string, unknown>): Promise<ToolResult> {
  const startedAt = nowIso();
  const raw = typeof args.path === "string" && args.path.trim() ? String(args.path) : ".";
  const path = raw === "." ? AGENT_WORKSPACE : resolveWorkspacePath(raw);
  try {
    const entries = await sandbox.files.list(path);
    const lines = entries.map((e) => {
      const isDir = (e.type as string) === "dir";
      return `${isDir ? "DIR " : "FILE"} ${e.name}${isDir ? "/" : ""} (${e.size ?? 0}b)`;
    });
    return shapeResult(
      "list_files",
      startedAt,
      lines.length > 0 ? lines.join("\n") : "(empty directory)",
      "",
      0,
      { path, entries: entries.map((e) => ({ name: e.name, type: String(e.type ?? ""), path: e.path, size: e.size ?? 0 })) }
    );
  } catch (err) {
    return shapeResult("list_files", startedAt, "", err instanceof Error ? err.message : "List failed", 1, { path });
  }
}

async function toolCreateDirectory(sandbox: AgentSandbox, args: Record<string, unknown>): Promise<ToolResult> {
  const startedAt = nowIso();
  const path = resolveWorkspacePath(String(args.path ?? ""));
  try {
    await sandbox.files.makeDir(path);
    return shapeResult("create_directory", startedAt, `Created ${path}`, "", 0, { path });
  } catch (err) {
    return shapeResult("create_directory", startedAt, "", err instanceof Error ? err.message : "mkdir failed", 1, { path });
  }
}

async function toolDeleteFile(
  sandbox: AgentSandbox,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult> {
  const path = resolveWorkspacePath(String(args.path ?? ""));
  const startedAt = nowIso();
  try {
    await sandbox.files.remove(path);
    return shapeResult("delete_file", startedAt, `Deleted ${path}`, "", 0, { path });
  } catch {
    if (args.recursive === true) {
      return runSandboxCommand(sandbox, "delete_file", `rm -rf ${JSON.stringify(path)}`, { onStream: stream });
    }
    return shapeResult("delete_file", startedAt, "", `Cannot delete ${path} (may be a directory — pass recursive:true).`, 1, { path });
  }
}

async function toolInspectProject(
  sandbox: AgentSandbox,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult> {
  const startedAt = nowIso();
  const base = typeof args.path === "string" && args.path.trim() ? resolveWorkspacePath(String(args.path)) : AGENT_WORKSPACE;
  const script = [
    `cd ${JSON.stringify(base)}`,
    `echo "=== TREE (depth 3) ==="`,
    `find . -maxdepth 3 -not -path '*/node_modules*' -not -path '*/.git*' -not -path '*/__pycache__*' | head -100`,
    `echo "=== package.json ==="`,
    `cat package.json 2>/dev/null | head -60 || echo "(no package.json)"`,
    `echo "=== requirements ==="`,
    `cat requirements.txt 2>/dev/null | head -30 || echo "(no requirements.txt)"`,
    `echo "=== README ==="`,
    `cat README.md 2>/dev/null | head -40 || echo "(no README.md)"`,
    `echo "=== runtimes ==="`,
    `node --version 2>/dev/null; python3 --version 2>/dev/null; pip --version 2>/dev/null | head -1`,
  ].join("\n");
  return runSandboxCommand(sandbox, "inspect_project", `bash -lc ${JSON.stringify(script)}`, {
    timeoutMs: 30_000,
    onStream: stream,
  });
}

async function toolInstallPackage(
  sandbox: AgentSandbox,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult> {
  const manager = String(args.manager ?? "npm").toLowerCase();
  const pkg = String(args.package ?? "").trim();
  if (!pkg || pkg.length > 300) throw new Error("install_package requires a valid 'package' name.");
  if (!/^[a-zA-Z0-9@/_+~^.\-]+$/.test(pkg)) throw new Error(`Suspicious package name blocked: ${pkg}`);
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? resolveWorkspacePath(String(args.cwd)) : AGENT_WORKSPACE;
  const cmd =
    manager === "pip"
      ? `pip install ${JSON.stringify(pkg)}`
      : manager === "npm"
        ? `npm install -S ${JSON.stringify(pkg)}`
        : null;
  if (!cmd) throw new Error("manager must be 'npm' or 'pip'.");
  return runSandboxCommand(sandbox, "install_package", `bash -lc ${JSON.stringify(`cd ${JSON.stringify(cwd)} && ${cmd}`)}`, {
    timeoutMs: 180_000,
    onStream: stream,
  });
}

async function toolRunTests(
  sandbox: AgentSandbox,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult> {
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? resolveWorkspacePath(String(args.cwd)) : AGENT_WORKSPACE;
  let cmd = typeof args.command === "string" && args.command.trim() ? args.command.trim() : "";
  if (!cmd) {
    const probe = await runSandboxCommand(
      sandbox,
      "run_tests",
      `bash -lc ${JSON.stringify(`cd ${JSON.stringify(cwd)} && (test -f package.json && echo HAS_PKG_JSON || true) && (test -f pytest.ini -o -f setup.cfg -o -f pyproject.toml -o -d tests && echo HAS_PYTEST || true)`)}`,
      { timeoutMs: 20_000 }
    );
    if (probe.stdout.includes("HAS_PKG_JSON")) cmd = "npm test -- --watchAll=false 2>&1 | head -100";
    else if (probe.stdout.includes("HAS_PYTEST")) cmd = "python3 -m pytest -q 2>&1 | head -100";
    else throw new Error("No test setup detected (no package.json test script or pytest config). Pass an explicit 'command'.");
  }
  return runSandboxCommand(sandbox, "run_tests", `bash -lc ${JSON.stringify(`cd ${JSON.stringify(cwd)} && ${cmd}`)}`, {
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : 180_000,
    onStream: stream,
  });
}

async function toolGetProcessStatus(sandbox: AgentSandbox, args: Record<string, unknown>): Promise<ToolResult> {
  const startedAt = nowIso();
  const pid = Number(args.pid);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("get_process_status requires an integer 'pid'.");
  try {
    const procs = await sandbox.commands.list();
    const found = procs.find((p) => p.pid === pid);
    if (found) {
      return shapeResult("get_process_status", startedAt, `RUNNING pid=${pid} cmd=${found.cmd ?? ""}`, "", 0, { pid, running: true });
    }
    return shapeResult("get_process_status", startedAt, `pid=${pid} is no longer running (exited).`, "", 0, { pid, running: false });
  } catch (err) {
    return shapeResult("get_process_status", startedAt, "", err instanceof Error ? err.message : "Status check failed", 1, { pid });
  }
}

async function toolStopProcess(sandbox: AgentSandbox, args: Record<string, unknown>): Promise<ToolResult> {
  const startedAt = nowIso();
  const pid = Number(args.pid);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("stop_process requires an integer 'pid'.");
  try {
    if (!sandbox.commands.connect) {
      // Backend has no process table; fall back to a targeted kill.
      const r = await sandbox.commands.run(`kill -9 ${pid} 2>/dev/null || true`);
      return shapeResult("stop_process", startedAt, `stop requested for pid=${pid}`, r.stderr, 0, { pid });
    }
    const handle = await sandbox.commands.connect(pid);
    await handle.kill();
    const killed = true;
    return shapeResult(
      "stop_process",
      startedAt,
      killed ? `pid=${pid} terminated (SIGKILL).` : `pid=${pid} not found (already exited).`,
      "",
      0,
      { pid, killed }
    );
  } catch (err) {
    return shapeResult("stop_process", startedAt, "", err instanceof Error ? err.message : "Kill failed", 1, { pid });
  }
}

/* ------------------------------------------------------------------ *
 * Dispatcher + tool schemas (OpenAI + Anthropic formats)
 * ------------------------------------------------------------------ */

const TOOL_IMPLS: Record<
  string,
  (sandbox: AgentSandbox, args: Record<string, unknown>, stream?: ToolStreamHandler) => Promise<ToolResult & { pid?: number; background?: boolean }>
> = {
  execute_command: toolExecuteCommand,
  run_python: toolRunPython,
  run_javascript: toolRunJavascript,
  read_file: toolReadFile,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  list_files: toolListFiles,
  create_directory: toolCreateDirectory,
  delete_file: toolDeleteFile,
  run_tests: toolRunTests,
  inspect_project: toolInspectProject,
  install_package: toolInstallPackage,
  get_process_status: toolGetProcessStatus,
  stop_process: toolStopProcess,
};

export function isKnownTool(name: string): boolean {
  return name in TOOL_IMPLS;
}

export async function executeAgentTool(
  sandbox: AgentSandbox,
  toolName: string,
  args: Record<string, unknown>,
  stream?: ToolStreamHandler
): Promise<ToolResult & { pid?: number; background?: boolean }> {
  const impl = TOOL_IMPLS[toolName];
  if (!impl) throw new Error(`Unknown tool: ${toolName}`);
  const safeArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") safeArgs[k] = v;
    else if (Array.isArray(v)) safeArgs[k] = v.filter((x) => typeof x === "string" || typeof x === "number").slice(0, 50);
  }
  return impl(sandbox, safeArgs, stream);
}

const TOOL_SCHEMAS: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
  {
    name: "execute_command",
    description: "Run a bash command in the isolated Linux sandbox workspace (/home/user/workspace). Returns real stdout, stderr and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run." },
        cwd: { type: "string", description: "Workspace-relative working directory. Default: workspace root." },
        timeoutMs: { type: "number", description: "Timeout in ms (max 300000). Default 120000." },
        background: { type: "boolean", description: "Run in background for servers/long jobs. Returns a pid." },
      },
      required: ["command"],
    },
  },
  {
    name: "run_python",
    description: "Write Python code to a temp file and execute it with python3. Returns real output.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Full Python source to execute." },
        args: { type: "array", items: { type: "string" }, description: "CLI args." },
        timeoutMs: { type: "number" },
      },
      required: ["code"],
    },
  },
  {
    name: "run_javascript",
    description: "Write JavaScript/TypeScript to a temp file and run it with node (tsx for TypeScript). Returns real output.",
    parameters: {
      type: "object",
      properties: { code: { type: "string" }, timeoutMs: { type: "number" } },
      required: ["code"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the workspace (parents created automatically).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace the first occurrence of oldText with newText in a workspace file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "list_files",
    description: "List files and directories in a workspace path.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Workspace-relative dir. Default root." } } },
  },
  {
    name: "create_directory",
    description: "Create a directory (including parents) in the workspace.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "delete_file",
    description: "Delete a workspace file. Directories need recursive:true.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, recursive: { type: "boolean" } },
      required: ["path"],
    },
  },
  {
    name: "run_tests",
    description: "Run the project test suite (auto-detects npm test or pytest) or a custom test command.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, cwd: { type: "string" }, timeoutMs: { type: "number" } },
    },
  },
  {
    name: "inspect_project",
    description: "Show directory tree, package.json, requirements, README and runtime versions.",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "install_package",
    description: "Install an npm or pip package inside the sandbox workspace.",
    parameters: {
      type: "object",
      properties: {
        manager: { type: "string", enum: ["npm", "pip"] },
        package: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["manager", "package"],
    },
  },
  {
    name: "get_process_status",
    description: "Check whether a background process pid is still running.",
    parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] },
  },
  {
    name: "stop_process",
    description: "SIGKILL a background process by pid.",
    parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] },
  },
];

export function getOpenAITools(): Array<Record<string, unknown>> {
  return TOOL_SCHEMAS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function getAnthropicTools(): Array<Record<string, unknown>> {
  return TOOL_SCHEMAS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  execute_command: "Bash",
  run_python: "Python",
  run_javascript: "Node.js",
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_files: "List files",
  create_directory: "New folder",
  delete_file: "Delete",
  run_tests: "Run tests",
  inspect_project: "Inspect",
  install_package: "Install",
  get_process_status: "Process",
  stop_process: "Stop",
};

export function toolDisplayName(tool: string): string {
  return TOOL_DISPLAY_NAMES[tool] ?? tool;
}
