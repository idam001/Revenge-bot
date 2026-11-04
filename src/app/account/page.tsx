import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { AccountPanel } from "@/components/AccountPanel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account — REVENGE GPT" };

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/chat?auth_required=1");

  return (
    <main className="min-h-dvh bg-[var(--bg-main)] px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href="/chat"
          className="mb-6 inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to chat
        </Link>
        <AccountPanel user={user} />
      </div>
    </main>
  );
}
