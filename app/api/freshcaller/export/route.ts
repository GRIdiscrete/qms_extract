export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const res = await fetch(
      `${process.env.FRESHCALLER_BASE_URL}/api/v1/account/export`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Api-Auth": `${process.env.FRESHCALLER_TOKEN}`,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();
    return new Response(JSON.stringify(data), { status: res.status });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "error" }),
      { status: 500 }
    );
  }
}
