import { AuthGate } from "@/components/AuthGate";

export default function ChatPage() {
  return (
    <AuthGate>
      <RevengeStudioInner />
    </AuthGate>
  );
}

// Kept in a separate call so the studio bundle only loads once a session exists.
import { RevengeStudio } from "@/components/RevengeStudio";
function RevengeStudioInner() {
  return <RevengeStudio />;
}
