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
      "Cache-Control": "public, max-age=86400, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}
