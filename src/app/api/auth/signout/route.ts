import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { GUEST_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/** Clears the Supabase session cookies and the guest cookie. */
export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    const store = await cookies();
    store.delete(GUEST_COOKIE);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
