import { readMediaFile } from "@/lib/media-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ file: string }> }
) {
  const { file } = await context.params;
  const found = await readMediaFile(file);
  if (!found) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(found.data), {
    headers: {
      "Content-Type": found.contentType,
      "Content-Length": String(found.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
