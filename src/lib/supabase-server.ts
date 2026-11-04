/** Server-only Supabase client bound to request cookies. Never import in client code. */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isAuthConfigured(): boolean {
  return Boolean(URL_ && ANON);
}

export async function createSupabaseServerClient() {
  if (!URL_ || !ANON) return null;
  const cookieStore = await cookies();
  return createServerClient(URL_, ANON, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component render: read-only. Middleware refreshes instead.
        }
      },
    },
  });
}
