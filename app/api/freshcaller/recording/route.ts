import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function isAllowedFreshcallerUrl(u: URL) {
  // Allow your Freshcaller domain(s)
  return /(^|\.)freshcaller\.com$/i.test(u.hostname);
}

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("url");
    if (!raw) return new Response("Missing url", { status: 400 });

    const target = new URL(raw);
    if (!isAllowedFreshcallerUrl(target)) {
      return new Response("Forbidden host", { status: 400 });
    }

    const res = await fetch(target.toString(), {
      headers: {
        Accept: "application/json",
        "X-Api-Auth": `${process.env.FRESHCALLER_TOKEN}`,
      },
    });

    const text = await res.text(); // pass-through JSON
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500,
    });
  }
}
