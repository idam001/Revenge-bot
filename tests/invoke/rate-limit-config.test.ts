import test from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER_API_KEY_REQUESTS_PER_MINUTE, USER_TOOL_REQUESTS_PER_MINUTE } from "../../src/lib/rate-limit-config";

test("sets tool and developer-key quotas to 300 requests per minute", () => {
  assert.equal(USER_TOOL_REQUESTS_PER_MINUTE, 300);
  assert.equal(CUSTOMER_API_KEY_REQUESTS_PER_MINUTE, 300);
  assert.ok(Number.isFinite(USER_TOOL_REQUESTS_PER_MINUTE));
});
