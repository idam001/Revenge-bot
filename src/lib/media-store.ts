import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDbSchema, pool } from "@/db";

// Video files may be large and continue to use their source URL when a local
// cache cannot be written. Images are stored durably in Postgres: a Vercel
// Lambda's /tmp directory is not shared with the later /api/media request.
const MEDIA_DIR = "/tmp/revenge-media";
type MediaExtension = "png" | "jpg" | "webp" | "mp4";

function contentTypeFor(ext: MediaExtension): string {
  return ext === "mp4"
    ? "video/mp4"
    : ext === "webp"
      ? "image/webp"
      : ext === "jpg"
        ? "image/jpeg"
        : "image/png";
}

function makeFilename(ext: MediaExtension): string {
  return `${crypto.randomUUID()}.${ext}`;
}

export async function saveMediaBuffer(
  buf: Buffer,
  ext: MediaExtension
): Promise<string> {
  if (buf.length === 0) throw new Error("Generated media buffer is empty");
  const filename = makeFilename(ext);

  if (ext !== "mp4") {
    await ensureDbSchema();
    const id = filename.slice(0, filename.lastIndexOf("."));
    await pool.query(
      `INSERT INTO "generated_media" ("id", "data", "contentType") VALUES ($1, $2, $3)`,
      [id, buf, contentTypeFor(ext)]
    );
    return `/api/media/${filename}`;
  }

  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, filename), buf);
  return `/api/media/${filename}`;
}

export async function readMediaFile(
  filename: string
): Promise<{ data: Buffer; contentType: string } | null> {
  const safe = path.basename(filename);
  const match = safe.match(/^([0-9a-f-]{36})\.(png|jpg|webp|mp4)$/i);
  if (!match) return null;

  const [, id, extension] = match;
  const ext = extension.toLowerCase() as MediaExtension;
  if (ext !== "mp4") {
    await ensureDbSchema();
    const result = await pool.query<{ data: Buffer; contentType: string }>(
      `SELECT "data", "contentType" FROM "generated_media" WHERE "id" = $1 LIMIT 1`,
      [id]
    );
    const asset = result.rows[0];
    return asset ? { data: asset.data, contentType: asset.contentType } : null;
  }

  try {
    const data = await fs.readFile(path.join(MEDIA_DIR, safe));
    return { data, contentType: contentTypeFor(ext) };
  } catch {
    return null;
  }
}
