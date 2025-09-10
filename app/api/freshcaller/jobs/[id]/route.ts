// app/api/freshcaller/jobs/[id]/route.ts
import type { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/freshcaller/jobs/[id]">
) {
  const { id } = await ctx.params; // <- params is async in Next 15

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
