export async function GET(_req: Request, { params }: { params: { id: string } }) {
    try {
      const res = await fetch(
        `${process.env.FRESHCALLER_BASE_URL}/api/v1/jobs/${params.id}`,
        {
          headers: {
            Accept: "application/json",
            "X-Api-Auth": `${process.env.FRESHCALLER_TOKEN}`,
          },
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
  