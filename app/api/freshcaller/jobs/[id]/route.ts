// app/api/freshcaller/jobs/[id]/route.ts

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const res = await fetch(
      `${process.env.FRESHCALLER_BASE_URL}/api/v1/jobs/${id}`,
      {
        headers: {
          Accept: "application/json",
          "X-Api-Auth": `${process.env.FRESHCALLER_TOKEN}`,
        },
      }
    );

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
