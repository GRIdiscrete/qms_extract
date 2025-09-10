import { NextRequest } from "next/server";
import { unzipSync, strFromU8 } from "fflate";
export const runtime = "edge"; // works in Node too
export async function GET(req: NextRequest) {
try {
const url = req.nextUrl.searchParams.get("url");
if (!url) return new Response("Missing url", { status: 400 });

const res = await fetch(url);
if (!res.ok) return new Response("Download failed", { status: res.status });

const ctype = res.headers.get("content-type") || "";

// If Freshchat already gives CSV
if (ctype.includes("text/csv") || url.toLowerCase().endsWith(".csv")) {
const text = await res.text();
return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// Otherwise treat as zip and extract the first CSV entry
const bytes = new Uint8Array(await res.arrayBuffer());
const files = unzipSync(bytes); // { [filename]: Uint8Array }
const entryName = Object.keys(files).find((k) => k.toLowerCase().endsWith(".csv"));
if (!entryName) return new Response("No CSV in zip", { status: 400 });
const csvText = strFromU8(files[entryName]);
return new Response(csvText, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
} catch (e: any) {
return new Response(JSON.stringify({ error: e?.message || "error" }), { status: 500 });
}
}
