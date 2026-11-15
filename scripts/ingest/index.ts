import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import registry from "@/lib/revenge-tools-registry.json";
import { parsePublicApisReadme } from "@/lib/registry/public-apis";

const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = option("source") || "all";
const limit = Math.max(0, Number(option("limit")) || 0);
const dryRun = args.includes("--dry-run");
const README_URL = "https://raw.githubusercontent.com/public-apis/public-apis/master/README.md";
const knownSources = ["public-apis", "apis-guru", "hf", "curated"];
if (!["all", ...knownSources].includes(source)) throw new Error(`Unsupported source '${source}'. Choose all, ${knownSources.join(", ")}.`);

async function readCachedReadme() {
  const cacheRoot = path.join(process.cwd(), ".cache", "ingest", "public-apis");
  await mkdir(cacheRoot, { recursive: true });
  const cacheMeta = path.join(cacheRoot, "latest.json");
  let etag = "";
  try { etag = JSON.parse(await readFile(cacheMeta, "utf8")).etag || ""; } catch { /* first fetch */ }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(README_URL, {
      headers: { "User-Agent": "REVENGE-registry-bot/1.0 (public API catalog discovery)", Accept: "text/plain", ...(etag ? { "If-None-Match": etag } : {}) },
      signal: controller.signal,
    });
    if (response.status === 304) {
      const pointer = JSON.parse(await readFile(cacheMeta, "utf8")) as { file: string };
      const cached = JSON.parse(await readFile(path.join(cacheRoot, pointer.file), "utf8")) as { markdown: string };
      return { markdown: cached.markdown, changed: false };
    }
    if (response.status === 429) throw new Error(`Public APIs source returned 429; retry later${response.headers.get("retry-after") ? ` (Retry-After ${response.headers.get("retry-after")}s)` : ""}.`);
    if (!response.ok) throw new Error(`Could not fetch public-apis README (HTTP ${response.status}).`);
    const markdown = await response.text();
    const sha = createHash("sha256").update(markdown).digest("hex");
    const file = `${sha}.json`;
    await writeFile(path.join(cacheRoot, file), JSON.stringify({ fetchedAt: new Date().toISOString(), sourceUrl: README_URL, markdown }));
    await writeFile(cacheMeta, JSON.stringify({ etag: response.headers.get("etag") || "", file }));
    return { markdown, changed: true };
  } finally { clearTimeout(timer); }
}

async function main() {
  const before = registry.endpoints.length;
  const report: string[] = [];
  report.push(`REVENGE registry ingest ${dryRun ? "dry run" : "discovery run"}`);
  report.push(`curated entries before: ${before}`);
  if (source === "all" || source === "curated") report.push(`curated: fetched=${before} parsed=${before} accepted=${before} rejected=0 (existing entries preserved)`);
  if (source === "all" || source === "public-apis") {
    const { markdown, changed } = await readCachedReadme();
    let candidates = parsePublicApisReadme(markdown, README_URL);
    if (limit) candidates = candidates.slice(0, limit);
    report.push(`public-apis: sourceChanged=${changed} parsed=${candidates.length} acceptedForCatalog=0 rejectedForPublication=${candidates.length}`);
    report.push("publication reason: external directory rows are discovery metadata only; no provider contract/example has been verified through REVENGE, so they are not added to the live invoke registry.");
    report.push(`sample candidates: ${candidates.slice(0, 5).map((item) => `${item.name} [${item.sourceCategory}]`).join("; ") || "none parsed"}`);
    if (!dryRun) {
      const reportDirectory = path.join(process.cwd(), "registry", "reports");
      await mkdir(reportDirectory, { recursive: true });
      await writeFile(path.join(reportDirectory, "public-apis-discovery.txt"), `${report.join("\n")}\n`);
      report.push("wrote registry/reports/public-apis-discovery.txt; live registry unchanged pending contract and terms review.");
    }
  }
  for (const unavailable of (source === "all" ? ["apis-guru", "hf"] : [source]).filter((name) => name !== "all" && name !== "curated" && name !== "public-apis")) {
    report.push(`${unavailable}: fetched=0 parsed=0 accepted=0 rejected=0 (connector/source parser not implemented yet)`);
  }
  report.push(`live registry after: ${before} (unchanged)`);
  report.forEach((line) => console.log(line));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Ingest failed."); process.exitCode = 1; });
