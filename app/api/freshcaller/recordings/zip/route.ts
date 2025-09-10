// app/api/freshcaller/recordings/zip/route.ts
import { NextRequest } from "next/server";
import { Zip, ZipPassThrough, strToU8 } from "fflate";

export const runtime = "nodejs"; // streaming-friendly

type ZipItem = {
  callId: number;
  recId: number;
  metaUrl: string;
  created_time?: string | null;
  phone?: string | null;
  agent?: string | null;
};

// ---------- helpers ----------
function safeSlug(s: string) {
  return (s || "")
    .trim()
    .replace(/[^\w.+-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function guessExt(contentType?: string | null, url?: string) {
  const lower = (contentType || "").toLowerCase();
  if (lower.includes("audio/mpeg") || lower.includes("audio/mp3")) return ".mp3";
  if (lower.includes("audio/wav") || lower.includes("audio/x-wav")) return ".wav";
  if (lower.includes("audio/mp4") || lower.includes("audio/x-m4a")) return ".m4a";
  if (lower.includes("audio/ogg")) return ".ogg";
  if (lower.includes("audio/webm")) return ".webm";
  try {
    const u = new URL(url || "");
    const m = u.pathname.match(/\.(mp3|wav|m4a|ogg|webm)(?:$|\?)/i);
    if (m) return `.${m[1].toLowerCase()}`;
  } catch {}
  return ".bin";
}

// simple p-limit (no deps)
function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(
          (v) => {
            next();
            resolve(v);
          },
          (e) => {
            next();
            reject(e);
          }
        );
      };
      if (active < max) run();
      else queue.push(run);
    });
}

async function retry<T>(fn: () => Promise<T>, tries = 3, baseDelayMs = 400): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const backoff = baseDelayMs * Math.pow(2, i) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

// ---------- route ----------
export async function POST(req: NextRequest) {
  try {
    const { items } = (await req.json()) as { items: ZipItem[] };
    if (!Array.isArray(items) || items.length === 0) {
      return new Response("No items supplied", { status: 400 });
    }

    const origin = new URL(req.url).origin;
    const concurrency = Number(process.env.ZIP_CONCURRENCY || 8);
    const limit = createLimiter(concurrency);

    const fname = `freshcaller_recordings_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.zip`;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // hook fflate Zip output to the ReadableStream
        const zip = new Zip((err, chunk, final) => {
          if (err) {
            controller.error(err);
            return;
          }
          if (chunk) controller.enqueue(chunk);
          if (final) controller.close();
        });

        // manifest we’ll append at the end
        const manifest: {
          generated_at: string;
          count: number;
          entries: Array<{ callId: number; recId: number; file: string; bytes?: number }>;
          errors: Array<{ callId?: number; recId?: number; error: string }>;
        } = {
          generated_at: new Date().toISOString(),
          count: items.length,
          entries: [],
          errors: [],
        };

        function addTextFile(name: string, text: string) {
          const entry = new ZipPassThrough(name);
          zip.add(entry);
          entry.push(strToU8(text), true); // finalize with final=true
        }

        // do all items in parallel (with limit)
        const tasks = items.map((it) =>
          limit(async () => {
            try {
              // 1) resolve fresh signed download URL
              const meta = await retry(async () => {
                const r = await fetch(
                  `${origin}/api/freshcaller/recording?url=${encodeURIComponent(it.metaUrl)}`
                );
                if (!r.ok) throw new Error(`metadata fetch ${r.status}`);
                return r.json();
              });

              const downloadUrl: string | undefined = meta?.recording?.download_url;
              if (!downloadUrl) throw new Error("no download_url in metadata");

              // 2) fetch audio (streaming)
              const audioRes = await retry(async () => {
                const r = await fetch(downloadUrl);
                if (!r.ok) throw new Error(`audio fetch ${r.status}`);
                return r;
              });

              const ext = guessExt(audioRes.headers.get("content-type"), downloadUrl);

              const datePart = it.created_time
                ? new Date(it.created_time).toISOString().slice(0, 10)
                : "unknown-date";
              const phone = it.phone ? safeSlug(it.phone.replace(/[^+\d]/g, "")) : "";
              const agent = it.agent ? safeSlug(it.agent) : "";
              const base =
                `${datePart}_call-${it.callId}_rec-${it.recId}` +
                (phone ? `_${phone}` : "") +
                (agent ? `_${agent}` : "");
              const fileName = `${safeSlug(base)}${ext}`;

              // 3) create a ZIP entry and pipe the response body into it
              const entry = new ZipPassThrough(fileName); // pass-through = no recompression (fastest for audio)
              zip.add(entry);

              let total = 0;
              const reader = audioRes.body?.getReader();
              if (!reader) throw new Error("no readable body");

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                entry.push(value); // write chunk to zip
              }
              // finalize entry
              entry.push(new Uint8Array(0), true);

              manifest.entries.push({
                callId: it.callId,
                recId: it.recId,
                file: fileName,
                bytes: total,
              });
            } catch (e: any) {
              manifest.errors.push({
                callId: it.callId,
                recId: it.recId,
                error: e?.message || String(e),
              });
            }
          })
        );

        // finalize after all entries complete
        (async () => {
          try {
            await Promise.allSettled(tasks);
            addTextFile("manifest.json", JSON.stringify(manifest, null, 2));
            zip.end(); // completes the archive -> triggers controller.close()
          } catch (e) {
            controller.error(e);
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (e: any) {
    return new Response(e?.message || "zip error", { status: 500 });
  }
}
