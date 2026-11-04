"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient, startGoogleSignIn } from "@/lib/supabase-browser";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Bug,
  Check,
  ChevronDown,
  Code2,
  FileSearch,
  Globe,
  Image as ImageIcon,
  Keyboard,
  Layers,
  Menu,
  MessageSquare,
  Mic,
  Search,
  ShieldCheck,
  Sparkles,
  Video,
  X,
  Zap,
} from "lucide-react";
import { ChatPreview } from "./ChatPreview";
import { CREATOR_NAME } from "@/lib/revenge-registry";

/* ------------------------------------------------------------------ *
 * Only integrations this app actually supports (see CLOUD_PROVIDERS).
 * ------------------------------------------------------------------ */
const INTEGRATIONS = [
  "Anthropic Claude",
  "OpenAI",
  "Google Gemini",
  "DeepSeek",
  "xAI Grok",
  "Groq LPU",
  "OpenRouter",
  "Mistral AI",
  "Together AI",
  "Cerebras",
  "Perplexity",
  "Cohere",
  "Ollama / vLLM",
  "Hugging Face",
  "AI Horde",
];

const CAPABILITIES = [
  {
    icon: MessageSquare,
    title: "Chat",
    body: "Fast, direct conversation with no lectures. Compare two models side by side, or run a temporary chat that never touches history.",
  },
  {
    icon: Code2,
    title: "Coding",
    body: "Complete, runnable files — not snippets. Long-output engines keep going until a 1,500-line artifact is whole, and it renders live.",
  },
  {
    icon: Globe,
    title: "Web research",
    body: "Live search across Bing, Google News, Wikipedia, Stack Overflow, GitHub and npm, with page reading and clickable citations.",
  },
  {
    icon: Sparkles,
    title: "Content generation",
    body: "Essays, scripts, roasts, product copy and documentation in the tone you ask for, with styles you can save per project.",
  },
  {
    icon: FileSearch,
    title: "Document analysis",
    body: "Drop in code, JSON, CSV, logs or docs and get extraction, summaries, tables and answers grounded in the actual file.",
  },
  {
    icon: Bug,
    title: "Debugging",
    body: "Paste an error or a screenshot. Get the root cause, the fix, and the corrected file — plus detection rules for audits.",
  },
  {
    icon: Zap,
    title: "Productivity",
    body: "Persistent memory, project instructions, bookmarks, branching, export, share links and a ⌘K palette over every message.",
  },
  {
    icon: ImageIcon,
    title: "Image & video",
    body: "Five free keyless image engines and three video engines generate real artwork and MP4 clips, with voice in and out.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Open the workspace",
    body: "No account, no card, no API key. Everything runs on free keyless providers from your browser.",
  },
  {
    n: "02",
    title: "Ask, attach, or search",
    body: "Type, paste code, drop a file, or send a photo. Web search and vision switch on automatically when they help.",
  },
  {
    n: "03",
    title: "Watch it think, then build",
    body: "Extended thinking shows its reasoning. Code renders live in an artifact panel you can edit and iterate on.",
  },
];

const FAQS = [
  {
    q: "Is it really free?",
    a: "Yes. REVENGE GPT runs on free keyless model providers, so there is no account, no card and no API key required. If you want frontier models, you can optionally paste your own key for Anthropic, OpenAI, Gemini, DeepSeek and more — that stays in your database and is never shared.",
  },
  {
    q: "Do I need an API key?",
    a: "No. There are 42 keyless models ready to use immediately. The key vault is optional and only unlocks direct connections to providers you already pay for.",
  },
  {
    q: "What can it actually do?",
    a: "Chat, full-file coding with live previews, deep web research with citations, image and video generation, photo and screenshot understanding, document analysis, debugging, and workspace features like memory, projects and branching.",
  },
  {
    q: "Where do my chats go?",
    a: "In your own PostgreSQL database. Nothing is sent anywhere except the model provider needed to answer. You can delete any conversation, or use temporary chat to save nothing at all.",
  },
  {
    q: "Can it help with security work?",
    a: "For explicitly authorized labs, CTFs and audits, it answers at full technical depth with working code — root-cause mechanics, lab reproduction, detection rules and hardening. It will not help with unauthorized access to systems you do not own, and it does not lecture about it.",
  },
];

const FOOTER_LINKS: Array<{ label: string; href: string }> = [
  { label: "Open chat", href: "/chat" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Workflow", href: "#workflow" },
  { label: "FAQ", href: "#faq" },
];

function useReveal() {
  const [visible, setVisible] = useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, visible };
}

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={`lp-reveal ${visible ? "is-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export function LandingPage() {
  const [navOpen, setNavOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  // Every "Open chat" entry point goes straight to Google for a new visitor.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setSignedIn(false);
      return;
    }
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (alive) setSignedIn(Boolean(data.user));
    });
    return () => {
      alive = false;
    };
  }, []);

  const openChat = async (e?: React.MouseEvent) => {
    if (signedIn) return; // let the <Link> navigate normally
    e?.preventDefault();
    await startGoogleSignIn("/chat");
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu on Escape for keyboard users
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const scrollTo = (id: string) => {
    setNavOpen(false);
    const el = document.querySelector(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lp-root min-h-dvh">
      {/* ============================ NAV ============================ */}
      <header
        className={`sticky top-0 z-50 transition-colors duration-300 ${
          scrolled
            ? "bg-[#08080a]/85 backdrop-blur-xl border-b border-white/[0.07]"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#d97757] to-[#8b5cf6] flex items-center justify-center text-[13px] shadow-lg">
              😈
            </span>
            <span className="font-semibold tracking-[0.16em] text-[13.5px] text-white">
              REVENGE GPT
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/chat"
              onClick={(e) => void openChat(e)}
              className="hidden sm:inline-flex items-center gap-2 h-10 px-5 rounded-full bg-white text-[#0b0b0e] text-[13.5px] font-semibold hover:bg-white/90 transition cursor-pointer"
            >
              Open chat
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>

            <button
              type="button"
              aria-label={navOpen ? "Close menu" : "Open menu"}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((o) => !o)}
              className="sm:hidden w-10 h-10 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center text-white/80 hover:text-white cursor-pointer"
            >
              {navOpen ? <X className="w-4.5 h-4.5" /> : <Menu className="w-4.5 h-4.5" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {navOpen && (
          <div className="sm:hidden border-t border-white/[0.07] bg-[#08080a]/95 backdrop-blur-xl">
            <div className="px-4 py-4 space-y-1">
              {FOOTER_LINKS.map((l) =>
                l.href.startsWith("#") ? (
                  <button
                    key={l.label}
                    type="button"
                    onClick={() => scrollTo(l.href)}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-[14.5px] text-white/75 hover:bg-white/[0.05] hover:text-white transition cursor-pointer"
                  >
                    {l.label}
                  </button>
                ) : (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={() => setNavOpen(false)}
                    className="block px-3 py-2.5 rounded-xl text-[14.5px] text-white/75 hover:bg-white/[0.05] hover:text-white transition"
                  >
                    {l.label}
                  </Link>
                )
              )}
              <Link
                href="/chat"
                onClick={(e) => {
                  setNavOpen(false);
                  void openChat(e);
                }}
                className="mt-2 flex items-center justify-center gap-2 h-11 rounded-full bg-white text-[#0b0b0e] text-[14px] font-semibold"
              >
                Open chat
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 lp-grid lp-grid-fade" aria-hidden="true" />
        <div className="absolute inset-0 lp-glow" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-14 sm:pt-20 pb-10 sm:pb-14">
          <Reveal>
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-2.5 h-9 px-4 rounded-full border border-white/10 bg-white/[0.04] text-[12px] text-white/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                100% FREE
                <span className="text-white/25">·</span>
                NO API KEY
                <span className="text-white/25">·</span>
                42 MODELS
              </span>
            </div>
          </Reveal>

          <Reveal delay={70}>
            <h1 className="mt-7 text-center font-semibold tracking-tight text-white text-[42px] leading-[1.06] sm:text-[64px] lg:text-[76px]">
              Your AI assistant for
              <br className="hidden sm:block" />{" "}
              <span className="text-white/45">thinking, building, and creating.</span>
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="mx-auto mt-6 max-w-2xl text-center text-[15.5px] sm:text-[17px] leading-relaxed text-white/55">
              REVENGE GPT chats, researches the live web, shows its thinking, and
              writes complete working code — exploits, malware analysis, game hacks
              and CTF challenges included. It writes the code, not a warning label.
            </p>
          </Reveal>

          <Reveal delay={210}>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/chat"
              onClick={(e) => void openChat(e)}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto h-12 px-7 rounded-full bg-white text-[#0b0b0e] text-[14.5px] font-semibold hover:bg-white/90 transition cursor-pointer"
              >
                Open chat
                <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                type="button"
                onClick={() => scrollTo("#capabilities")}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto h-12 px-7 rounded-full border border-white/12 bg-white/[0.04] text-white text-[14.5px] font-semibold hover:bg-white/[0.08] transition cursor-pointer"
              >
                Explore capabilities
              </button>
            </div>
          </Reveal>

          <Reveal delay={280}>
            <p className="mt-5 text-center text-[12.5px] text-white/35">
              Runs on free keyless model providers · your chats stay in your browser
              and your database
            </p>
          </Reveal>

          {/* Chat preview */}
          <Reveal delay={340} className="mt-14 sm:mt-16">
            <div className="mx-auto max-w-3xl">
              <ChatPreview />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ==================== INTEGRATIONS STRIP ==================== */}
      <section className="relative border-y border-white/[0.07] bg-[#0a0a0d] py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <p className="lp-eyebrow text-center">Bring your own key — optional</p>
            <h2 className="mt-3 text-center text-[22px] sm:text-[26px] font-semibold text-white tracking-tight">
              Fluent in the ecosystem
            </h2>
            <p className="mx-auto mt-2.5 max-w-xl text-center text-[14px] text-white/45">
              Every provider below is wired into the key vault. Paste a key to go
              direct; otherwise the 42 free models answer instead.
            </p>
          </Reveal>
        </div>

        <div className="lp-marquee relative mt-8 overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 z-10 bg-gradient-to-r from-[#0a0a0d] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 z-10 bg-gradient-to-l from-[#0a0a0d] to-transparent" />
          <div className="lp-marquee-track gap-3 px-3">
            {[...INTEGRATIONS, ...INTEGRATIONS].map((name, i) => (
              <span
                key={`${name}-${i}`}
                className="shrink-0 inline-flex items-center h-11 px-5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-[13.5px] text-white/60 whitespace-nowrap"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ====================== CAPABILITIES ====================== */}
      <section id="capabilities" className="relative scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <p className="lp-eyebrow text-center">Capabilities</p>
            <h2 className="mx-auto mt-3 max-w-2xl text-center text-[32px] sm:text-[44px] leading-[1.1] font-semibold text-white tracking-tight">
              A copilot that shows its work.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-center text-[15px] leading-relaxed text-white/50">
              Chat, live web research, notes and an always-on operator persona — in
              one free workspace.
            </p>
          </Reveal>

          <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {CAPABILITIES.map((cap, i) => {
              const Icon = cap.icon;
              return (
                <Reveal key={cap.title} delay={i * 55}>
                  <article className="lp-card h-full p-6">
                    <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                      <Icon className="w-[18px] h-[18px] text-[#d97757]" />
                    </span>
                    <h3 className="mt-4 text-[15.5px] font-semibold text-white">
                      {cap.title}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-white/50">
                      {cap.body}
                    </p>
                  </article>
                </Reveal>
              );
            })}
          </div>

          {/* Feature proof row */}
          <Reveal delay={120}>
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: Brain, label: "Extended thinking", sub: "visible reasoning" },
                { icon: Layers, label: "Live artifacts", sub: "HTML · React · SVG" },
                { icon: ImageIcon, label: "5 image engines", sub: "SDXL · FLUX · Sana" },
                { icon: Video, label: "3 video engines", sub: "LTX · AnimateDiff" },
              ].map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.label}
                    className="lp-card p-5 flex items-center gap-3.5"
                  >
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-[#d97757]/12 border border-[#d97757]/25 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-[#d97757]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-white truncate">
                        {f.label}
                      </span>
                      <span className="block text-[11.5px] text-white/40 truncate">
                        {f.sub}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ======================= HOW IT WORKS ======================= */}
      <section
        id="workflow"
        className="relative scroll-mt-20 border-y border-white/[0.07] bg-[#0a0a0d] py-20 sm:py-28"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <p className="lp-eyebrow text-center">Workflow</p>
            <h2 className="mx-auto mt-3 max-w-2xl text-center text-[32px] sm:text-[44px] leading-[1.1] font-semibold text-white tracking-tight">
              Straight answers. No lectures.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-center text-[15px] leading-relaxed text-white/50">
              Built for labs, CTFs, red-team engagements and research. It answers like
              an operator — and you stay responsible for where you point it.
            </p>
          </Reveal>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 80}>
                <article className="lp-card h-full p-7">
                  <span className="font-mono text-[12px] text-[#d97757]">{s.n}</span>
                  <h3 className="mt-4 text-[17px] font-semibold text-white">
                    {s.title}
                  </h3>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-white/50">
                    {s.body}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>

          {/* Trust points */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                icon: ShieldCheck,
                title: "Operator persona, always on",
                body: "Every chat runs the direct operator prompt: hacking requests get working answers, not refusals or lectures.",
              },
              {
                icon: Search,
                title: "Honest by design",
                body: "Every reply shows which model actually answered, and rate-limit fallbacks are labelled — no pretending.",
              },
              {
                icon: Layers,
                title: "Your chats stay yours",
                body: "Stored in your own PostgreSQL database. Temporary chat saves nothing at all.",
              },
            ].map((t, i) => {
              const Icon = t.icon;
              return (
                <Reveal key={t.title} delay={i * 80}>
                  <article className="lp-card h-full p-6">
                    <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                      <Icon className="w-[18px] h-[18px] text-[#d97757]" />
                    </span>
                    <h3 className="mt-4 text-[15.5px] font-semibold text-white">
                      {t.title}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-white/50">
                      {t.body}
                    </p>
                  </article>
                </Reveal>
              );
            })}
          </div>

          <Reveal delay={140}>
            <p className="mt-8 text-center text-[12.5px] text-white/35">
              REVENGE GPT gives answers, not permission. Keep your testing authorized.
            </p>
          </Reveal>
        </div>
      </section>

      {/* =========================== FAQ =========================== */}
      <section id="faq" className="relative scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal>
            <p className="lp-eyebrow text-center">FAQ</p>
            <h2 className="mt-3 text-center text-[32px] sm:text-[44px] leading-[1.1] font-semibold text-white tracking-tight">
              The deal
            </h2>
          </Reveal>

          <div className="mt-12 divide-y divide-white/[0.07] border-y border-white/[0.07]">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q} delay={i * 45}>
                  <div>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenFaq(open ? null : i)}
                      className="w-full flex items-center justify-between gap-4 py-5 text-left cursor-pointer group"
                    >
                      <span className="text-[15.5px] font-medium text-white group-hover:text-white/85">
                        {f.q}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 text-white/40 transition-transform duration-300 ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    <div
                      className={`grid transition-all duration-300 ease-out ${
                        open
                          ? "grid-rows-[1fr] opacity-100 pb-5"
                          : "grid-rows-[0fr] opacity-0"
                      }`}
                    >
                      <p className="overflow-hidden text-[14.5px] leading-relaxed text-white/50">
                        {f.a}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ======================== FINAL CTA ======================== */}
      <section className="relative overflow-hidden border-t border-white/[0.07] py-24 sm:py-32">
        <div className="absolute inset-0 lp-grid lp-grid-fade" aria-hidden="true" />
        <div className="absolute inset-0 lp-glow" aria-hidden="true" />

        <div className="relative mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <Reveal>
            <h2 className="text-[34px] sm:text-[52px] leading-[1.05] font-semibold text-white tracking-tight">
              Start building in the next 30 seconds.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[15.5px] leading-relaxed text-white/50">
              No account. No API key. No daily limit. Open the workspace and ask it
              something you would not ask anywhere else.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/chat"
              onClick={(e) => void openChat(e)}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto h-12 px-8 rounded-full bg-white text-[#0b0b0e] text-[14.5px] font-semibold hover:bg-white/90 transition cursor-pointer"
              >
                Open chat
                <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                type="button"
                onClick={() => scrollTo("#faq")}
                className="inline-flex items-center justify-center w-full sm:w-auto h-12 px-8 rounded-full border border-white/12 bg-white/[0.04] text-white text-[14.5px] font-semibold hover:bg-white/[0.08] transition cursor-pointer"
              >
                Read the FAQ
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ========================== FOOTER ========================== */}
      <footer className="border-t border-white/[0.07] bg-[#08080a]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
            <div>
              <Link href="/" className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#d97757] to-[#8b5cf6] flex items-center justify-center text-[13px]">
                  😈
                </span>
                <span className="font-semibold tracking-[0.16em] text-[13.5px] text-white">
                  REVENGE GPT
                </span>
              </Link>
              <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-white/45">
                The free AI for security work — no refusals, live web research, visible
                thinking and notes. Built as a security course project by {CREATOR_NAME}.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className="lp-eyebrow">Product</p>
                <ul className="mt-4 space-y-2.5">
                  {FOOTER_LINKS.slice(0, 3).map((l) => (
                    <li key={l.label}>
                      {l.href.startsWith("#") ? (
                        <button
                          type="button"
                          onClick={() => scrollTo(l.href)}
                          className="text-[14px] text-white/55 hover:text-white transition cursor-pointer"
                        >
                          {l.label}
                        </button>
                      ) : (
                        <Link
                          href={l.href}
                          className="text-[14px] text-white/55 hover:text-white transition"
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="lp-eyebrow">Project</p>
                <ul className="mt-4 space-y-2.5">
                  <li>
                    <Link
                      href="/chat"
              onClick={(e) => void openChat(e)}
                      className="text-[14px] text-white/55 hover:text-white transition"
                    >
                      Open chat
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/chat"
              onClick={(e) => void openChat(e)}
                      className="text-[14px] text-white/55 hover:text-white transition"
                    >
                      Workspace
                    </Link>
                  </li>
                  <li>
                    <span className="inline-flex items-center gap-1.5 text-[14px] text-white/55">
                      <Keyboard className="w-3.5 h-3.5" /> ⌘K palette
                    </span>
                  </li>
                  <li>
                    <span className="inline-flex items-center gap-1.5 text-[14px] text-white/55">
                      <Mic className="w-3.5 h-3.5" /> Voice in &amp; out
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="lp-hairline mt-12 h-px" aria-hidden="true" />

          <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-[12.5px] text-white/35">
              © {new Date().getFullYear()} REVENGE GPT — a security course project ·
              for authorized testing only
            </p>
            <p className="text-[12.5px] text-white/35">
              Built by <span className="text-white/60">{CREATOR_NAME}</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
