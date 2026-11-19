import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAgentSandbox, isSandboxConfigured, killSandbox } from "@/lib/e2b-manager";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Explicit, user-triggered runtime smoke test. Creates a disposable sandbox,
 * writes and reads one temporary file, then always tears the sandbox down.
 */
export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate.response) return gate.response;
  if (!isSandboxConfigured()) {
    return NextResponse.json({ ok: false, error: "No sandbox backend is configured." }, { status: 503 });
  }

  let sandbox: Awaited<ReturnType<typeof createAgentSandbox>> | null = null;
  try {
    sandbox = await createAgentSandbox({ timeoutMs: 120_000, metadata: { purpose: "agent-self-test" } });
    const result = await sandbox.commands.run(
      "mkdir -p /home/user/workspace && printf 'agent-sandbox-ok\\n' > /home/user/workspace/.agent-self-test && cat /home/user/workspace/.agent-self-test",
      { cwd: "/home/user/workspace", timeoutMs: 20_000 }
    );
    if (result.exitCode !== 0 || !result.stdout.includes("agent-sandbox-ok")) {
      return NextResponse.json({ ok: false, sandbox: sandbox.driver, error: result.stderr || "Sandbox command verification failed." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sandbox: sandbox.driver, result: "Sandbox created, command executed, file read back." });
  } catch {
    return NextResponse.json({ ok: false, error: "Sandbox startup or command check failed. Check the deployment's sandbox configuration and runtime logs." }, { status: 502 });
  } finally {
    if (sandbox) await killSandbox(sandbox);
  }
}
