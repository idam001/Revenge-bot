import { NextResponse } from "next/server";
import { gatherWebGrounding } from "@/lib/web-grounding";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      query?: string;
    };
    const query = (body.query || "").trim().slice(0, 300);
    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }
    const { sources } = await gatherWebGrounding(query, true, { forceSearch: true });
    return NextResponse.json({ sources, query });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
