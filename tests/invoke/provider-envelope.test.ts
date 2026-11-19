import test from "node:test";
import assert from "node:assert/strict";
import { interpretProviderOutcome } from "../../src/lib/provider-envelope";

test("treats provider-declared errors as failed even when upstream HTTP is 200", () => {
  assert.deepEqual(interpretProviderOutcome(true, { status: 401, success: false, error: "API_KEY_REQUIRED", message: "Authorize" }), {
    ok: false, providerStatus: 401, error: "Authorize",
  });
  assert.deepEqual(interpretProviderOutcome(true, { success: false, message: "No results" }), { ok: false, error: "No results" });
});

test("preserves successful JSON and catches HTTP failures", () => {
  assert.deepEqual(interpretProviderOutcome(true, { success: true, results: [1] }), { ok: true });
  assert.deepEqual(interpretProviderOutcome(false, { message: "failed" }), { ok: false });
});
