import fs from "fs";
import path from "path";

function loadThreadState(threadId: string) {
  const jsonString = fs.readFileSync(
    path.resolve(process.cwd(), `public/demo/threads/${threadId}/thread.json`),
    "utf8",
  );
  return JSON.parse(jsonString);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ thread_id: string }> },
) {
  const threadId = (await params).thread_id;
  return Response.json(loadThreadState(threadId));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ thread_id: string }> },
) {
  const threadId = (await params).thread_id;
  return Response.json(loadThreadState(threadId));
}
