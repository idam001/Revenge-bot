import { createHash } from "node:crypto";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { rateLimitShared } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CF = "https://api.cloudflare.com/client/v4";
const MAX_ARCHIVE = 20 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_TOTAL = 40 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8", xml: "application/xml; charset=utf-8", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wasm: "application/wasm", map: "application/json",
};

type SiteRow = { id: string; project_name: string; site_url: string | null; title: string | null; updated_at: string };
function jsonError(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
function credentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !account) return null;
  return { token, account };
}
async function ensureTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS hosted_sites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_key text NOT NULL UNIQUE,
    project_name text NOT NULL UNIQUE,
    site_url text,
    title text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}
async function cloudflare(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${CF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { success?: boolean; errors?: Array<{ message?: string }>; result?: unknown };
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(detail || `Cloudflare request failed (${response.status})`);
  }
  return payload;
}
function safePath(raw: string) {
  const normalized = raw.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..") || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  if (normalized.startsWith("_") && /^_(worker|routes|headers|redirects)/i.test(normalized)) return null;
  return normalized;
}
async function readSite(ownerKey: string): Promise<SiteRow | null> {
  const result = await db.execute(sql`SELECT id, project_name, site_url, title, updated_at FROM hosted_sites WHERE owner_key = ${ownerKey} LIMIT 1`);
  const rows = (result as unknown as { rows?: SiteRow[] }).rows ?? [];
  return rows[0] ?? null;
}

export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate.response) return gate.response;
  try {
    await ensureTable();
    const site = await readSite(`user:${gate.user.id}`);
    return NextResponse.json({ configured: Boolean(credentials()), site });
  } catch {
    return jsonError("Hosting is temporarily unavailable. Please try again.", 503);
  }
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate.response) return gate.response;
  const rate = await rateLimitShared(`host-site:${gate.user.id}`, 3, 60 * 60_000);
  if (!rate.ok) return NextResponse.json({ error: `Upload limit reached. Try again in about ${Math.ceil(rate.retryAfterSec / 60)} minutes.` }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } });
  const creds = credentials();
  if (!creds) return jsonError("Static hosting is not configured yet. Ask the site administrator to finish Cloudflare setup.", 503);
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) return jsonError("Upload a ZIP archive of your static site.", 415);
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_ARCHIVE + 1024 * 1024) return jsonError("ZIP upload limit is 20 MB.", 413);

  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError("Could not read the upload. Please try a ZIP file under 20 MB.", 400); }
  const zipFile = form.get("site");
  const titleInput = String(form.get("title") || "My website").trim().slice(0, 70);
  if (!(zipFile instanceof File) || !zipFile.name.toLowerCase().endsWith(".zip")) return jsonError("Choose a .zip file containing your static website.", 400);
  if (zipFile.size < 1 || zipFile.size > MAX_ARCHIVE) return jsonError("ZIP upload limit is 20 MB.", 413);

  let archive: JSZip;
  try { archive = await JSZip.loadAsync(await zipFile.arrayBuffer(), { checkCRC32: false, createFolders: false }); }
  catch { return jsonError("That ZIP file is invalid or damaged.", 400); }

  const files = Object.values(archive.files).filter((entry) => !entry.dir);
  if (!files.length || files.length > MAX_FILES) return jsonError(`Your site must contain between 1 and ${MAX_FILES} files.`, 400);
  const assets: Array<{ path: string; hash: string; contentType: string; bytes: Buffer }> = [];
  let total = 0;
  for (const entry of files) {
    const path = safePath(entry.name);
    if (!path) return jsonError("The ZIP contains an unsafe or unsupported file path.", 400);
    const declaredBytes = (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declaredBytes === "number" && (declaredBytes > MAX_FILE || total + declaredBytes > MAX_TOTAL)) {
      return jsonError("Unzipped site limit is 40 MB total and 5 MB per file.", 413);
    }
    const bytes = Buffer.from(await entry.async("uint8array"));
    total += bytes.length;
    if (bytes.length > MAX_FILE || total > MAX_TOTAL) return jsonError("Unzipped site limit is 40 MB total and 5 MB per file.", 413);
    const extension = path.split(".").pop()?.toLowerCase() || "";
    const hash = createHash("sha256").update(bytes).digest("hex");
    assets.push({ path, hash, contentType: MIME[extension] || "application/octet-stream", bytes });
  }
  if (!assets.some((asset) => asset.path.toLowerCase() === "index.html")) {
    return jsonError("Add an index.html file at the root of the ZIP, then try again.", 400);
  }

  let projectName = "";
  let createdRow = false;
  try {
    await ensureTable();
    const ownerKey = `user:${gate.user.id}`;
    const digest = createHash("sha256").update(gate.user.id).digest("hex").slice(0, 16);
    const proposed = `revenge-site-${digest}`;
    const inserted = await db.execute(sql`INSERT INTO hosted_sites (owner_key, project_name, title)
      VALUES (${ownerKey}, ${proposed}, ${titleInput || "My website"}) ON CONFLICT (owner_key) DO NOTHING RETURNING id`);
    createdRow = Boolean((inserted as unknown as { rows?: unknown[] }).rows?.length);
    const site = await readSite(ownerKey);
    if (!site) throw new Error("Could not reserve your site slot.");
    projectName = site.project_name;

    const projectPath = `/accounts/${encodeURIComponent(creds.account)}/pages/projects/${encodeURIComponent(projectName)}`;
    let existing = await fetch(`${CF}${projectPath}`, { headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
    if (existing.status === 404) {
      await cloudflare(`/accounts/${encodeURIComponent(creds.account)}/pages/projects`, creds.token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, production_branch: "main" }),
      });
    } else if (!existing.ok) {
      const detail = await existing.text().catch(() => "");
      throw new Error(`Could not check your hosting project (${existing.status}) ${detail.slice(0, 150)}`);
    }

    const tokenResponse = await cloudflare(`${projectPath}/upload-token`, creds.token);
    const uploadToken = (tokenResponse.result as { jwt?: string } | undefined)?.jwt;
    if (!uploadToken) throw new Error("Cloudflare did not issue an upload token.");

    for (let start = 0; start < assets.length; start += 50) {
      const batch = assets.slice(start, start + 50);
      const registered = await cloudflare("/pages/assets/upsert-hashes", uploadToken, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: batch.map((asset) => asset.hash) }),
      });
      const missing = (registered.result as { buckets?: string[] } | undefined)?.buckets ?? [];
      for (const bucket of missing) {
        const toUpload = batch.filter((asset) => asset.hash.startsWith(bucket));
        if (!toUpload.length) continue;
        await cloudflare("/pages/assets/upload", uploadToken, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toUpload.map((asset) => ({ key: asset.hash, value: asset.bytes.toString("base64"), base64: true, metadata: { contentType: asset.contentType } }))),
        });
      }
    }

    const manifest = Object.fromEntries(assets.map((asset) => [`/${asset.path}`, { hash: asset.hash } as { hash: string }]));
    const deployForm = new FormData();
    deployForm.set("manifest", JSON.stringify(manifest));
    const deployment = await cloudflare(`${projectPath}/deployments`, creds.token, { method: "POST", body: deployForm });
    const result = deployment.result as { url?: string; aliases?: string[]; latest_stage?: { name?: string } } | undefined;
    const siteUrl = result?.url ? `https://${result.url.replace(/^https?:\/\//, "")}` : `https://${projectName}.pages.dev`;
    await db.execute(sql`UPDATE hosted_sites SET site_url = ${siteUrl}, title = ${titleInput || "My website"}, updated_at = now() WHERE owner_key = ${ownerKey}`);
    return NextResponse.json({ ok: true, site: { ...site, title: titleInput || "My website", site_url: siteUrl }, files: assets.length });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown hosting error";
    if (createdRow) {
      try { await db.execute(sql`DELETE FROM hosted_sites WHERE owner_key = ${`user:${gate.user.id}`} AND site_url IS NULL`); } catch { /* retain the user's reserved site slot if cleanup fails */ }
    }
    console.error("[host-site] deployment failed:", detail.slice(0, 240));
    return jsonError(`Deployment failed: ${detail.slice(0, 220)}`, 502);
  }
}
