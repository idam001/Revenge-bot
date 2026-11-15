import test from "node:test";
import assert from "node:assert/strict";
import registry from "@/lib/revenge-tools-registry.json";
import { discoverEndpoints, enrichEndpoint, validatePublicHttpUrl, validateUrlParameters } from "@/lib/revenge-tools-discovery";
import { acceptedLicense, makePublicMovie, pickLicensedVideoFile } from "@/lib/movie-box";

test("SSRF preflight accepts public HTTPS and rejects metadata, loopback, private ranges, and custom ports", () => {
  assert.equal(validatePublicHttpUrl("https://example.com/path").ok, true);
  for (const value of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/admin",
    "http://10.0.0.2/",
    "http://192.168.1.1/",
    "http://localhost/",
    "http://[::1]/",
    "https://example.com:8443/",
    "file:///etc/passwd",
  ]) assert.equal(validatePublicHttpUrl(value).ok, false, value);
});

test("URL-shaped parameter guard rejects dangerous values before upstream calls", async () => {
  const blocked = await validateUrlParameters({ image: "http://169.254.169.254/latest/meta-data/" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok ? "" : blocked.param, "image");
  assert.equal((await validateUrlParameters({ prompt: "http://127.0.0.1" })).ok, true);
});

test("legacy endpoint enrichment is additive and never claims an unverified example works", () => {
  const original = registry.endpoints[0];
  const enriched = enrichEndpoint(original);
  assert.equal(enriched.id, original.id);
  assert.equal(enriched.status, "unverified");
  assert.equal((enriched.example as { verified: boolean }).verified, false);
  assert.equal((enriched.auth as { keyEnvVar: string }).keyEnvVar, "NABEES_API_KEY");
  assert.equal(JSON.stringify(enriched).includes("nabeestech"), true);
});

test("catalog discovery ranks exact IDs first and paginates without losing total", () => {
  const firstId = registry.endpoints[0].id;
  const exact = discoverEndpoints(registry.endpoints, { query: firstId, limit: 10 });
  assert.equal(exact.matches[0].endpoint.id, firstId);
  const page = discoverEndpoints(registry.endpoints, { category: registry.endpoints[0].category, limit: 2 });
  assert.equal(page.matches.length, 2);
  assert.ok(page.total >= 2);
  assert.equal(typeof page.nextCursor, "string");
  const detail = discoverEndpoints(registry.endpoints, { endpointId: firstId });
  assert.equal(detail.matches.length, 1);
});

test("Movie Box only enables source-reported supported licenses and direct video files", () => {
  assert.equal(acceptedLicense("https://creativecommons.org/publicdomain/mark/1.0/", null)?.label, "Public domain / CC0");
  assert.equal(acceptedLicense("https://example.com/license", "copyright reserved"), null);
  assert.equal(acceptedLicense("https://evil.example/creativecommons.org/licenses/by/4.0/", ""), null);
  assert.equal(pickLicensedVideoFile([{ name: "movie.mp4", format: "MPEG4", size: "1234" }, { name: "poster.jpg", format: "JPEG" }])?.name, "movie.mp4");
  assert.equal(pickLicensedVideoFile([{ name: "../private.mp4", format: "MPEG4" }]), null);
  const movie = makePublicMovie("sample-film", { title: "Sample" }, {
    metadata: { title: "Sample Film", licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/", year: "1930" },
    files: [{ name: "Film.mp4", format: "MPEG4", size: "1000" }],
  });
  assert.ok(movie);
  assert.equal(movie?.videoUrl, "https://archive.org/download/sample-film/Film.mp4");
  assert.equal(makePublicMovie("bad/id", {}, {}), null);
});
