import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { createSocketTicket } from "@/lib/socket-ticket";

export const dynamic = "force-dynamic";

/** GET /api/socket-ticket — signed ticket for the realtime socket's `authenticate`. */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(createSocketTicket(user.id), {
    headers: { "Cache-Control": "no-store" },
  });
}
