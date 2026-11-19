import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgentLoop, type AgentEvent } from "../../src/lib/agent-loop";
import type { AgentSandboxHandle } from "../../src/lib/sandbox-provider";

function streamReply(text: string): Response {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function fakeSandbox(): { sandbox: AgentSandboxHandle; files: Map<string, string> } {
  const files = new Map<string, string>();
  const sandbox: AgentSandboxHandle = {
    sandboxId: "test-sandbox",
    driver: "e2b",
    files: {
      async read(path) {
        const value = files.get(path);
        if (value === undefined) throw new Error("File not found");
        return value;
      },
      async write(path, content) {
        files.set(path, content);
      },
      async list() {
        return [];
      },
      async makeDir() {},
      async remove(path) {
        files.delete(path);
      },
      async rename(from, to) {
        const value = files.get(from);
        if (value !== undefined) {
          files.set(to, value);
          files.delete(from);
        }
      },
    },
    commands: {
      async run() {
        return { stdout: "mock command output", stderr: "", exitCode: 0 };
      },
      async list() {
        return [];
      },
    },
    async kill() {},
  };
  return { sandbox, files };
}

test("Agent Mode fails over from a rate-limited engine, writes a file, and returns a final answer", async () => {
  const previousFetch = globalThis.fetch;
  const replies = [
    new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), { status: 429 }),
    streamReply('```action\n{"tool":"write_file","args":{"path":"agent-smoke.txt","content":"agent executed successfully"}}\n```'),
    streamReply("I created agent-smoke.txt and verified the sandbox write completed."),
  ];
  let requests = 0;
  globalThis.fetch = (async () => {
    const response = replies[requests++];
    if (!response) throw new Error("Unexpected extra model request");
    return response;
  }) as typeof fetch;

  const { sandbox, files } = fakeSandbox();
  const events: AgentEvent[] = [];
  try {
    const outcome = await runAgentLoop(sandbox, {
      sessionId: "agent-test",
      task: "Create a text file containing the smoke test result",
      modelId: "revenge-omega-x",
      mode: "auto",
      savedKeysMap: {},
      shouldCancel: () => false,
      emit: (event) => events.push(event),
    });

    assert.equal(outcome.status, "completed");
    assert.equal(outcome.toolCallCount, 1);
    assert.equal(requests, 3);
    assert.equal(files.get("/home/user/workspace/agent-smoke.txt"), "agent executed successfully");
    assert.ok(events.some((event) => event.type === "agent.status" && String(event.text).includes("Switching")));
    assert.ok(events.some((event) => event.type === "tool.completed"));
    assert.ok(events.some((event) => event.type === "agent.completed"));
  } finally {
    globalThis.fetch = previousFetch;
  }
});
