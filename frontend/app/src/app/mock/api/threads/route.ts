import type { NextRequest } from "next/server";

type CreateThreadRequest = {
  thread_id?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as CreateThreadRequest;
  const threadId =
    body.thread_id?.trim() || request.headers.get("x-thread-id")?.trim() || "";

  if (!threadId) {
    return Response.json(
      { error: "thread_id is required" },
      { status: 400 },
    );
  }

  return Response.json({ thread_id: threadId });
}
