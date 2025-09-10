import { NextRequest } from "next/server";
import { unzipSync, strFromU8 } from "fflate";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    if (!url) return new Response("Missing url", { status: 400 });

    const res = await fetch(url);
    if (!res.ok) return new Response("Download failed", { status: res.status });

    const ctype = res.headers.get("content-type") || "";
    let calls: any[] = [];

    // Direct JSON?
    if (ctype.includes("application/json") || (url || "").toLowerCase().endsWith(".json")) {
      const j = await res.json();
      if (Array.isArray(j?.calls)) calls.push(...j.calls);
      else if (Array.isArray(j)) calls.push(...j);
      return new Response(JSON.stringify(calls), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // Otherwise assume ZIP
    const bytes = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(bytes); // { [filename]: Uint8Array }

    for (const [name, arr] of Object.entries(files)) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      try {
        const text = strFromU8(arr);
        const j = JSON.parse(text);
        if (Array.isArray(j?.calls)) calls.push(...j.calls);
        else if (Array.isArray(j)) calls.push(...j);
      } catch {
        // ignore bad JSON entry
      }
    }

    return new Response(JSON.stringify(calls), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500,
    });
  }
}
