// app/api/freshcaller/recordings/[callId]/[recordingId]/route.ts

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callId: string; recordingId: string }> }
) {
  const { callId, recordingId } = await params;

  try {
    const upstream = await fetch(
      `${process.env.FRESHCALLER_BASE_URL}/api/v1/calls/${callId}/recordings/${recordingId}`,
      {
        headers: {
          Accept: "*/*",
          "X-Api-Auth": `${process.env.FRESHCALLER_TOKEN}`,
        },
      }
    );

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
        "content-length": upstream.headers.get("content-length") ?? "",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
