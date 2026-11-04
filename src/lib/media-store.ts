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

function detectImageExtension(buf: Buffer): Exclude<MediaExtension, "mp4"> {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new Error("Image provider returned invalid or unsupported image bytes");
}

export async function saveMediaBuffer(
  buf: Buffer,
  ext: MediaExtension
): Promise<string> {
  if (buf.length === 0) throw new Error("Generated media buffer is empty");

  if (ext !== "mp4") {
    const imageExt = detectImageExtension(buf);
    const filename = makeFilename(imageExt);
    await ensureDbSchema();
    const id = filename.slice(0, filename.lastIndexOf("."));
    await pool.query(
      `INSERT INTO "generated_media" ("id", "data", "contentType") VALUES ($1, $2, $3)`,
      [id, buf, contentTypeFor(imageExt)]
    );
    return `/api/media/${filename}`;
  }

  const filename = makeFilename(ext);
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, filename), buf);
  return `/api/media/${filename}`;
}

async function readLocalMedia(
  filename: string,
  ext: MediaExtension
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const data = await fs.readFile(path.join(MEDIA_DIR, filename));
    return { data, contentType: contentTypeFor(ext) };
  } catch {
    return null;
  }
}

export async function readMediaFile(
  filename: string
): Promise<{ data: Buffer; contentType: string } | null> {
  const safe = path.basename(filename);
  const match = safe.match(/^([0-9a-f-]{36})\.(png|jpg|webp|mp4)$/i);
  if (match) {
    const [, id, extension] = match;
    const ext = extension.toLowerCase() as MediaExtension;
    if (ext === "mp4") return readLocalMedia(safe, ext);
    await ensureDbSchema();
    const result = await pool.query<{ data: Buffer; contentType: string }>(
      `SELECT "data", "contentType" FROM "generated_media" WHERE "id" = $1 LIMIT 1`,
      [id]
    );
    const asset = result.rows[0];
    return asset ? { data: asset.data, contentType: asset.contentType } : null;
  }

  // Read URLs emitted by the pre-durable-media version during warm rollouts.
  const legacy = safe.match(/^\d{10,}-[0-9a-f]{12}\.(png|jpg|webp|mp4)$/i);
  if (!legacy) return null;
  return readLocalMedia(safe, legacy[1].toLowerCase() as MediaExtension);
}
