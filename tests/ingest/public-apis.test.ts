import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicApisReadme } from "@/lib/registry/public-apis";

const fixture = `# APIs\n\n## Animals\n| API | Description | Auth | HTTPS | CORS |\n| --- | --- | --- | --- | --- |\n| [Cat Facts](https://catfact.ninja) | Random cat facts | No | Yes | Yes |\n| [Bird Data](https://birds.example/api) | Bird records | apiKey | Yes | No |\n\n## Weather\n| API | Description | Auth | HTTPS | CORS |\n| --- | --- | --- | --- | --- |\n| [Open Weather](https://weather.example/api) | Weather data | No | Yes | Unknown |\n`;

test("Public APIs parser reads all category tables and preserves provenance/auth signals", () => {
  const rows = parsePublicApisReadme(fixture, "https://example.test/README.md");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].sourceCategory, "Animals");
  assert.equal(rows[0].auth, "No");
  assert.equal(rows[0].https, "Yes");
  assert.equal(rows[1].cors, "No");
  assert.equal(rows[2].sourceCategory, "Weather");
  assert.equal(rows[2].status, "unverified");
  assert.equal(rows[2].sourceUrl, "https://example.test/README.md");
});

test("Public APIs parser skips malformed/unlinked rows and deduplicates stable IDs", () => {
  const markdown = `${fixture}\n| Cat Facts | duplicate | No | Yes | Yes |\n| [Not secure](http://example.test) | Description | No | Yes | Yes |`;
  const rows = parsePublicApisReadme(markdown);
  assert.equal(rows.filter((row) => row.name === "Cat Facts").length, 1);
  assert.equal(rows.some((row) => row.name === "Not secure"), false);
  assert.match(rows[0].id, /^public-apis-animals-cat-facts$/);
});
