import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Mail, User } from "lucide-react";
import { LogoutButton } from "./logout-button";
import { HiddenTasks } from "./hidden-tasks";
import { DisplayNameForm } from "./display-name-form";

export default async function SettingsPage() {
  const session = await auth();
  const profile = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { displayName: true },
      })
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            Account
          </CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{session?.user?.email}</p>
            </div>
          </div>

          <DisplayNameForm initialName={profile?.displayName ?? ""} />

          <LogoutButton />
        </CardContent>
      </Card>

      <HiddenTasks />
    </div>
  );
}
