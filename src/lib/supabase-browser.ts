"use client";
/** Browser-only Supabase client. Only ever uses the publishable (anon) key. */
import { createBrowserClient } from "@supabase/ssr";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createSupabaseBrowserClient() {
  if (!URL_ || !ANON) return null;
  return createBrowserClient(URL_, ANON);
}
