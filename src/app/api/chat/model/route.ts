import { getRuntimeChatModelInfo } from "@/lib/build-info";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getRuntimeChatModelInfo(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
