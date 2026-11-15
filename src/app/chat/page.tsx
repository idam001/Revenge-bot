import { AuthGate } from "@/components/AuthGate";
import { RevengeStudio } from "@/components/RevengeStudio";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ apps?: string; app?: string }> }) {
  const query = await searchParams;
  const initialAppsOpen = query.apps === "1";
  const appIds = new Set(["downloader", "temporary-email", "email-osint", "anime", "image", "search", "creator", "converter", "sports", "scripture", "ai-studio", "18+", "espn-sports", "naijaprey", "religion", "stalk", "image-editing", "tools", "textmate", "pokemon", "bilibili-tv", "audiomack", "canvas-studio"]);
  const initialApp = initialAppsOpen && query.app && appIds.has(query.app) ? query.app : null;
  return (
    <AuthGate>
      <RevengeStudio initialAppsOpen={initialAppsOpen} initialApp={initialApp} />
    </AuthGate>
  );
}
