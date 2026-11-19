import test from "node:test";
import assert from "node:assert/strict";
import registry from "../../src/lib/revenge-tools-registry.json";
import { APP_EXPERIENCES } from "../../src/lib/app-experiences";
import { LOCAL_TOOL_IDS } from "../../src/lib/local-tools";

test("40+ tool actions map to registry endpoints, built-in utilities, or dedicated handlers", () => {
  const actions = APP_EXPERIENCES["api-tools"].actions;
  assert.equal(actions.length, 48);
  for (const action of actions) {
    if (action.endpointId === "github-repo-search" || action.endpointId === "local-image-public-url") continue;
    if (action.endpointId.startsWith("local-")) {
      assert.ok((LOCAL_TOOL_IDS as readonly string[]).includes(action.endpointId.replace("local-", "")), `${action.title} has a built-in handler`);
      continue;
    }
    const endpoint = registry.endpoints.find(item => item.id === action.endpointId);
    assert.ok(endpoint, `${action.title} endpoint ${action.endpointId} exists`);
    assert.ok(endpoint.methods.includes(action.method || "GET"), `${action.title} method is supported`);
    const supplied = new Set([...action.fields.map(field => field.name), ...Object.keys(action.defaults || {})]);
    for (const parameter of endpoint.params) {
      if (parameter.required) assert.ok(supplied.has(parameter.name), `${action.title} supplies required ${parameter.name}`);
    }
  }
});
