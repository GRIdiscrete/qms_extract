// app/api/freshcaller/jobs/[id]/route.ts
import type { NextRequest } from "next/server";


export async function GET(req: NextRequest) {
  const id = req.nextUrl.pathname.split("/").pop()!;

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
    const data: unknown = await res.json();
    return new Response(JSON.stringify(data), { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
