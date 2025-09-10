// app/api/freshcaller/jobs/[id]/route.ts
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> } // 👈 params is a Promise
) {
  try {
    const { id } = await params; // 👈 await it

    const res = await fetch(
      `${process.env.FRESHCALLER_BASE_URL}/api/v1/jobs/${id}`,
      {
        headers: {
          Accept: "application/json",
          "X-Api-Auth": `${process.env.FRESHCALLER_TOKEN}`,
        },
      }
    );

    const data: unknown = await res.json();
    return new Response(JSON.stringify(data), { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
