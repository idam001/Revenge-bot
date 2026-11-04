import { AuthGate } from "@/components/AuthGate";
import { LandingPage } from "@/components/LandingPage";

export default function HomePage() {
  return (
    <AuthGate>
      <LandingPage />
    </AuthGate>
  );
}
