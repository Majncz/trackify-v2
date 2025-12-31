import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/header";

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
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-14 p-4 md:p-8">
        <div className="max-w-4xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
