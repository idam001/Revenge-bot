import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_TOOL_IDS, runLocalTool } from "../../src/lib/local-tools";

const run = (id: string, values: Record<string, string | number | boolean>) => runLocalTool(id, values);

test("exposes 16 built-in utility tools", () => assert.equal(LOCAL_TOOL_IDS.length, 16));

test("formats and minifies only valid JSON", () => {
  assert.equal(run("json-pretty", { text: "{\"a\":1}" }), "{\n  \"a\": 1\n}");
  assert.equal(run("json-minify", { text: "{ \"a\": 1 }" }), "{\"a\":1}");
  assert.throws(() => run("json-pretty", { text: "nope" }));
});

test("converts CSV with quoted commas, escaped quotes, and newlines", () => {
  const json = JSON.parse(run("csv-to-json", { text: 'name,note\nAda,"hello, world"\n"B""ob","line 1\nline 2"' }));
  assert.deepEqual(json, [{ name: "Ada", note: "hello, world" }, { name: 'B"ob', note: "line 1\nline 2" }]);
  assert.equal(run("json-to-csv", { text: '[{"a":"one, two","b":"x"},{"a":"say \\"hi\\"","c":3}]' }), 'a,b,c\n"one, two",x,\n"say ""hi""",,3');
});

test("URL and UTF-8 Base64 tools round-trip Unicode", () => {
  const text = "Hello 🌍 & Lagos";
  assert.equal(run("url-decode", { text: run("url-encode", { text }) }), text);
  assert.equal(run("base64-decode", { text: run("base64-encode", { text }) }), text);
});

test("generates UUID v4 and valid requested password lengths", () => {
  assert.match(run("uuid-generate", {}), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(run("password-generate", { length: 32 }).length, 32);
  assert.throws(() => run("password-generate", { length: 7 }));
});

test("converts timestamps and HEX colors", () => {
  assert.match(run("timestamp-convert", { value: "0", mode: "timestamp-to-date" }), /1970-01-01T00:00:00\.000Z/);
  assert.equal(run("timestamp-convert", { value: "1970-01-01T00:00:01Z", mode: "date-to-unix" }), "Unix seconds: 1\nUnix milliseconds: 1000");
  assert.match(run("color-convert", { hex: "#fff" }), /HEX: #FFFFFF\nRGB: rgb\(255, 255, 255\)\nHSL: hsl\(0, 0%, 100%\)/);
});

test("checks WCAG contrast and counts text", () => {
  assert.match(run("contrast-check", { foreground: "#000000", background: "#FFFFFF" }), /WCAG AA normal text: PASS/);
  assert.match(run("contrast-check", { foreground: "#777777", background: "#FFFFFF" }), /WCAG AA normal text: FAIL/);
  assert.match(run("text-stats", { text: "Hello world\n🌍" }), /Words: 3[\s\S]*Characters: 13[\s\S]*Lines: 2/);
});

test("escapes and safely decodes basic and numeric HTML entities", () => {
  assert.equal(run("html-escape", { text: `<a title="x">'&</a>` }), "&lt;a title=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;");
  assert.equal(run("html-unescape", { text: "&lt;Hi&#32;&amp;&#x1F30D;&gt;" }), "<Hi &🌍>");
});
