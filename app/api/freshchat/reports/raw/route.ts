export const dynamic = "force-dynamic";
export async function POST(req: Request) {
try {
const body = await req.json();
const res = await fetch(`${process.env.FRESHCHAT_BASE_URL}/v2/reports/raw`, {
method: "POST",
headers: {
"Content-Type": "application/json",
"Authorization": `Bearer ${process.env.FRESHCHAT_TOKEN}`,
},
body: JSON.stringify(body),
});
const data = await res.json();
return new Response(JSON.stringify(data), { status: res.status });
} catch (e: any) {
return new Response(JSON.stringify({ error: e?.message || "error" }), { status: 500 });
}
}
