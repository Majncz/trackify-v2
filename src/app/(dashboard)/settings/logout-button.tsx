"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <Button
      variant="destructive"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="w-full sm:w-auto"
    >
      <LogOut className="h-4 w-4 mr-2" />
      Sign out
    </Button>
  );
}
