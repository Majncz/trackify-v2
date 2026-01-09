import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SocketProvider } from "@/contexts/socket-context";
import { AIChat } from "@/components/chat/ai-chat";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SocketProvider>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-20 md:pt-24 p-4 md:p-8 pb-24 md:pb-8">
          <div className="max-w-4xl mx-auto">{children}</div>
        </main>
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <AIChat />
        </div>
        {/* Mobile bottom nav */}
        <BottomNav />
      </div>
    </SocketProvider>
  );
}
