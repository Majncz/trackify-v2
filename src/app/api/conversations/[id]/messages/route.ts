import { getAuthUser } from "@/lib/api-auth";
import { chatMessagePartsFromDb } from "@/lib/database-mode";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
  });

  const normalized = messages.map((m) => ({
    ...m,
    parts: chatMessagePartsFromDb(m.parts),
  }));

  return NextResponse.json(normalized);
}
