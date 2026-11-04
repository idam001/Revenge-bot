import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MEDIA_DIR = "/tmp/revenge-media";

export async function saveMediaBuffer(
  buf: Buffer,
  ext: "png" | "jpg" | "webp" | "mp4"
): Promise<string> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const id = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const fullPath = path.join(MEDIA_DIR, id);
  await fs.writeFile(fullPath, buf);
  return `/api/media/${id}`;
}

export async function readMediaFile(
  filename: string
): Promise<{ data: Buffer; contentType: string } | null> {
  const safe = path.basename(filename);
  if (!/^[a-zA-Z0-9._-]+$/.test(safe)) return null;
  const fullPath = path.join(MEDIA_DIR, safe);
  try {
    const data = await fs.readFile(fullPath);
    const ext = path.extname(safe).toLowerCase();
    const contentType =
      ext === ".mp4"
        ? "video/mp4"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : "image/png";
    return { data, contentType };
  } catch {
    return null;
  }
}
