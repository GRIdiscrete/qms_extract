export async function GET(_req: Request, { params }: { params: { id: string } }) {
    try {
    const res = await fetch(`${process.env.FRESHCHAT_BASE_URL}/v2/conversations/${params.id}/messages`, {
    headers: { "Authorization": `Bearer ${process.env.FRESHCHAT_TOKEN}` },
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { status: res.status });
    } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), { status: 500 });
    }
    }