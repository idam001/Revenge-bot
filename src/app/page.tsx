import { LandingPage } from "@/components/LandingPage";

/**
 * The landing page is public on purpose: it is the product page, so visitors
 * need to be able to read it before deciding to sign in. Every "Open chat"
 * link leads to /chat, which is gated by <AuthGate />, and the APIs behind it
 * reject anonymous callers server-side.
 */
export default function HomePage() {
  return <LandingPage />;
}
