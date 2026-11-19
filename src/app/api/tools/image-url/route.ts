import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { rateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUCKET = "image-links";
const MAX_BYTES = 4 * 1024 * 1024;
const FORMATS = {
  "image/png": { extension: "png", signature: (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/jpeg": { extension: "jpg", signature: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { extension: "webp", signature: (b: Buffer) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  "image/gif": { extension: "gif", signature: (b: Buffer) => b.length >= 6 && ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)) },
} as const;

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  const rate = await rateLimitShared(`image-url:${gate.user.id}`, 10, 60 * 60 * 1000);
  if (!rate.ok) return NextResponse.json({ error: "Upload limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be between 1 byte and 4 MB." }, { status: 413 });
  const format = FORMATS[file.type as keyof typeof FORMATS];
  if (!format) return NextResponse.json({ error: "Use a PNG, JPEG, WebP, or GIF image." }, { status: 415 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!format.signature(bytes)) return NextResponse.json({ error: "The file contents do not match its image type." }, { status: 415 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Image storage is not configured." }, { status: 503 });

  const path = `${gate.user.id}/${randomUUID()}.${format.extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    console.error("[image-url] Storage upload failed:", uploadError.message);
    return NextResponse.json({ error: "Could not store the image. Please try again." }, { status: 502 });
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data.publicUrl) return NextResponse.json({ error: "Storage did not return a share URL." }, { status: 502 });
  return NextResponse.json({ ok: true, url: data.publicUrl, path, filename: file.name.slice(0, 180), size: file.size, visibility: "public" });
}

export async function DELETE(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  let body: { path?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (typeof body.path !== "string" || !body.path.startsWith(`${gate.user.id}/`) || body.path.includes("..")) {
    return NextResponse.json({ error: "That image does not belong to your account." }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Image storage is not configured." }, { status: 503 });
  const { error } = await supabase.storage.from(BUCKET).remove([body.path]);
  if (error) {
    console.error("[image-url] Storage delete failed:", error.message);
    return NextResponse.json({ error: "Could not remove the image." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
