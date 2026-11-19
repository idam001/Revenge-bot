import test from "node:test";
import assert from "node:assert/strict";
import { APP_EXPERIENCES } from "../../src/lib/app-experiences";

test("image-to-public-URL action requires an image and explicit public-sharing consent", () => {
  const action = APP_EXPERIENCES["api-tools"].actions.find(item => item.endpointId === "local-image-public-url");
  assert.ok(action);
  const file = action.fields.find(field => field.type === "file");
  const consent = action.fields.find(field => field.type === "checkbox");
  assert.equal(file?.required, true);
  assert.equal(file?.accept, "image/png,image/jpeg,image/webp,image/gif");
  assert.equal(consent?.required, true);
});
