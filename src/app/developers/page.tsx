import { AuthGate } from "@/components/AuthGate";
import { DeveloperPortal } from "@/components/DeveloperPortal";

export const metadata = { title: "Developer Portal — REVENGE" };

export default function DevelopersPage() {
  return <AuthGate><DeveloperPortal /></AuthGate>;
}
