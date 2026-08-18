import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timers = await prisma.activeTimer.findMany({
    include: {
      user: { select: { id: true, email: true } },
      task: { select: { name: true, hidden: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const tracking = timers
    .filter((timer) => !timer.task.hidden)
    .map((timer) => ({
      userId: timer.user.id,
      name: displayNameFromEmail(timer.user.email),
      taskName: timer.task.name,
      startTime: timer.startTime.getTime(),
    }));

  return NextResponse.json({ tracking });
}
