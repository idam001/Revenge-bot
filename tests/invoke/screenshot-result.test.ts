import test from "node:test";
import assert from "node:assert/strict";
import { screenshotUrlOf } from "../../src/lib/screenshot-result";

test("finds nested screenshot links even when the provider returns a URL instead of base64", () => {
  assert.equal(screenshotUrlOf({ data: { result: { screenshot_url: "https://cdn.example.test/capture.png?sig=abc" } } }), "https://cdn.example.test/capture.png?sig=abc");
  assert.equal(screenshotUrlOf({ image: "https://cdn.example.test/capture" }), "https://cdn.example.test/capture");
  assert.equal(screenshotUrlOf({ success: true, url: "https://cdn.example.test/capture/abc" }), "https://cdn.example.test/capture/abc");
});

test("does not treat an ordinary source-page URL as the screenshot image", () => {
  assert.equal(screenshotUrlOf({ url: "https://example.org/page" }), "");
  assert.equal(screenshotUrlOf({ result: "javascript:alert(1)" }), "");
});
