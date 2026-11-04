import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, ensureDbSchema } from "@/db";
import { conversations, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { SparkIcon } from "@/components/SparkIcon";
import { CREATOR_NAME, getModelById } from "@/lib/revenge-registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared conversation · REVENGE GPT",
  robots: { index: false, follow: false },
};

export default async function SharedChatPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{16,40}$/i.test(token)) notFound();

  await ensureDbSchema();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.shareToken, token));
  if (!conv) notFound();

  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(asc(messages.createdAt));

  return (
    <div className="min-h-dvh bg-[var(--bg-main)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/90 backdrop-blur">
        <div className="max-w-[760px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <SparkIcon size={18} className="text-[var(--accent)] shrink-0" />
            <span className="font-claude-serif text-[16px] truncate">REVENGE GPT</span>
            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shrink-0">
              Shared · read-only
            </span>
          </div>
          <Link
            href="/"
            className="px-3.5 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[12.5px] font-semibold shrink-0"
          >
            Start your own chat
          </Link>
        </div>
      </header>

      <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-8">
        <h1 className="font-claude-serif text-[26px] sm:text-[32px] leading-tight">{conv.title}</h1>
        <p className="text-[12.5px] text-[var(--text-muted)] mt-1.5">
          {thread.length} messages · {getModelById(conv.modelId).shortName} · shared from REVENGE GPT
        </p>

        <div className="mt-8 space-y-7">
          {thread.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-[var(--text-primary)] text-[var(--bg-main)] flex items-center justify-center text-[11.5px] font-semibold shrink-0 mt-1">
                  U
                </span>
                <div className="min-w-0 flex-1 rounded-2xl bg-[var(--bg-user-msg)] px-4 py-3">
                  {(m.attachments ?? []).some((a) => a.content?.startsWith("data:image/")) && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {(m.attachments ?? [])
                        .filter((a) => a.content?.startsWith("data:image/"))
                        .map((a, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={a.content}
                            alt={a.name}
                            className="max-h-52 max-w-full rounded-xl border border-[var(--border-subtle)] object-cover"
                          />
                        ))}
                    </div>
                  )}
                  <div className="text-[15px] whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>
                </div>
              </div>
            ) : (
              <div key={m.id} className="space-y-3">
                <div className="flex items-center gap-2">
                  <SparkIcon size={18} className="text-[var(--accent)]" />
                  <span className="text-[12.5px] font-semibold">
                    {m.modelId ? getModelById(m.modelId).shortName : "REVENGE GPT"}
                  </span>
                </div>
                {m.videoUrl && (
                  <video
                    src={m.videoUrl}
                    controls
                    loop
                    muted
                    playsInline
                    className="w-full max-w-xl rounded-2xl border border-[var(--border-subtle)] bg-black"
                  />
                )}
                <MarkdownRenderer content={m.content} serifProse />
              </div>
            )
          )}
        </div>

        <footer className="mt-14 pt-6 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row items-center justify-between gap-3 pb-10">
          <p className="text-[12.5px] text-[var(--text-muted)]">
            Made with <span className="text-[var(--accent)] font-semibold">REVENGE GPT</span> · built by {CREATOR_NAME}
          </p>
          <Link href="/" className="text-[12.5px] text-[var(--accent)] font-semibold hover:underline">
            Try it free — no API key needed →
          </Link>
        </footer>
      </main>
    </div>
  );
}
