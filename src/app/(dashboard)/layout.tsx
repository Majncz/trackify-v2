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
      <div className="min-h-dvh min-h-[100svh] w-full overflow-x-hidden bg-background">
        <Header />
        <main className="w-full min-w-0 px-3 pt-[calc(env(safe-area-inset-top,0px)+4.5rem)] pb-[calc(6rem+env(safe-area-inset-bottom,0px))] sm:px-4 md:px-8 md:pt-[calc(env(safe-area-inset-top,0px)+5.5rem)] md:pb-8">
          <div className="max-w-4xl mx-auto w-full min-w-0">{children}</div>
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
