import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function isAllowedAudioUrl(u: URL) {
  // Allow Freshcaller S3 buckets and freshcaller.com attachments hosts
  // Example hosts you showed:
  //   euc-freshcaller-attachments.s3.eu-central-1.amazonaws.com
  //   freshcaller-*-exports.s3.*.amazonaws.com (if needed)
  return (
    /\.amazonaws\.com$/i.test(u.hostname) ||
    /(^|\.)freshcaller\.com$/i.test(u.hostname)
  );
}

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("url");
    if (!raw) return new Response("Missing url", { status: 400 });

    const target = new URL(raw);
    if (!isAllowedAudioUrl(target)) {
      return new Response("Forbidden host", { status: 400 });
    }

    // Fetch the actual audio from the signed S3 URL
    const res = await fetch(target.toString());
    if (!res.ok) {
      return new Response("Download failed", { status: res.status });
    }

    // Stream it back to the client and preserve headers
    const contentType =
      res.headers.get("content-type") || "application/octet-stream";
    // Try to surface a filename from URL; fallback to "recording"
    const basename = target.pathname.split("/").pop() || "recording";
    const disposition = `attachment; filename="${basename}"`;

    // In the Edge runtime, res.body is a ReadableStream
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        // Propagate caching minimally (optional)
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500,
    });
  }
}
