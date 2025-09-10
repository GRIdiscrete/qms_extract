"use client";

// app/chat/page.tsx
import { JSX, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

// --- Types ---
interface ReportCreateResponse {
  id: string;
  link: { rel: string; href: string };
}
interface ReportStatusLink {
  link: { rel: string; href: string };
  from: string;
  to: string;
  status: string;
}
interface ReportStatusResponse {
  id: string;
  status: string; // PROCESSING | COMPLETED | FAILED
  interval?: string;
  links?: ReportStatusLink[];
}
interface ConversationRow {
  id: string; // conversation_id from CSV
  channel?: string;
  created_at?: string;
  last_message_at?: string;
  messages_count?: number;
  preview?: string;
}

type Stage =
  | "idle"
  | "requesting"
  | "polling"
  | "downloading"
  | "parsing"
  | "fetching"
  | "done"
  | "error";

export default function ChatExtraction() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stageNote, setStageNote] = useState<string>("");
  const [reportId, setReportId] = useState<string>("");
  const [reportStatus, setReportStatus] = useState<string>("");
  const [table, setTable] = useState<ConversationRow[]>([]);
  const [error, setError] = useState<string>("");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pageCount = Math.max(1, Math.ceil(table.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
    if (page < 1) setPage(1);
  }, [page, pageCount]);
  const view = useMemo(() => table.slice((page - 1) * pageSize, page * pageSize), [table, page, pageSize]);

  const reset = () => {
    setStage("idle");
    setStageNote("");
    setReportId("");
    setReportStatus("");
    setTable([]);
    setError("");
    setPage(1);
  };

  // Minimal CSV parser (handles quoted cells)
  const parseCSV = (csv: string): string[][] => {
    const rows: string[][] = [];
    let i = 0,
      cell = '',
      row: string[] = [],
      inQuotes = false;
    while (i < csv.length) {
      const ch = csv[i];
      if (inQuotes) {
        if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (ch === '"') { inQuotes = false; i++; continue; }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      cell += ch; i++;
    }
    row.push(cell); rows.push(row); return rows;
  };

  const submit = useCallback(async () => {
    try {
      setError(""); setTable([]); setPage(1);
      if (!start || !end) throw new Error("Select a start and end date");

      // 1) Request report
      setStage("requesting"); setStageNote("Requesting report …");
      const createRes = await fetch("/api/freshchat/reports/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), event: "Conversation-Created", format: "csv" })
      });
      if (!createRes.ok) throw new Error(`Failed to request report (${createRes.status})`);
      const createJson = (await createRes.json()) as ReportCreateResponse; setReportId(createJson.id);

      // 2) Poll status
      setStage("polling"); setStageNote("Building extract …");
      let statusJson: ReportStatusResponse | null = null;
      for (let attempt = 0; attempt < 60; attempt++) {
        const r = await fetch(`/api/freshchat/reports/raw/${createJson.id}`);
        if (!r.ok) throw new Error(`Status check failed (${r.status})`);
        statusJson = (await r.json()) as ReportStatusResponse; setReportStatus(statusJson.status); setStageNote(`Report status: ${statusJson.status}`);
        if (statusJson.status === "COMPLETED") break; if (statusJson.status === "FAILED") throw new Error("Report generation failed");
        await new Promise(res => setTimeout(res, 5000));
      }
      if (!statusJson || statusJson.status !== "COMPLETED") throw new Error("Timed out waiting for report");

      // 3) Download CSV/ZIP
      setStage("downloading"); setStageNote("Downloading extract …");
      const href = statusJson.links?.[0]?.link?.href; if (!href) throw new Error("No extraction link found");
      const downloadRes = await fetch(`/api/freshchat/download?url=${encodeURIComponent(href)}`);
      if (!downloadRes.ok) throw new Error(`Download failed (${downloadRes.status})`);
      const csvText = await downloadRes.text();

      // 4) Parse CSV
      setStage("parsing"); setStageNote("Parsing CSV …");
      const rows = parseCSV(csvText).filter(r => r.length > 1);
      const header = rows.shift() || [];
      const idx = {
        conversation_id: header.findIndex((h) => /conversation[_\s-]?id/i.test(h)),
        created_at: header.findIndex((h) => /created[_\s-]?at|created[_\s-]?time/i.test(h)),
        channel: header.findIndex((h) => /channel/i.test(h)),
      };
      if (idx.conversation_id < 0) throw new Error("CSV does not include a conversation_id column");

      // Deduplicate by conversation_id
      const seen = new Set<string>(); const uniqueRows: string[][] = [];
      for (const r of rows) { const id = r[idx.conversation_id]; if (!id || seen.has(id)) continue; seen.add(id); uniqueRows.push(r); }
      const convIds = uniqueRows.map(r => r[idx.conversation_id]);
      const rowById = new Map<string, string[]>(uniqueRows.map(r => [r[idx.conversation_id], r]));

      // 5) Fetch conversation messages with small concurrency
      setStage("fetching");
      const limit = 5; let pointer = 0; const accMap = new Map<string, ConversationRow>();
      const runNext = async (): Promise<void> => {
        if (pointer >= convIds.length) return; const cid = convIds[pointer++];
        setStageNote(`Fetching messages ${accMap.size + 1}/${convIds.length} …`);
        try {
          const r = await fetch(`/api/freshchat/conversations/${cid}/messages`);
          if (r.ok) {
            const j = await r.json(); const msgs = (j?.messages ?? []) as any[];
            const preview = msgs.find((m) => m.message_parts?.[0]?.text?.content)?.message_parts?.[0]?.text?.content ?? "";
            const created = msgs[msgs.length - 1]?.created_time || rowById.get(cid)?.[idx.created_at] || "";
            const last = msgs[0]?.created_time || created; const ch = rowById.get(cid)?.[idx.channel];
            accMap.set(cid, { id: cid, channel: ch, created_at: created, last_message_at: last, messages_count: msgs.length, preview });
          } else { accMap.set(cid, { id: cid, preview: `Error ${r.status}` }); }
        } catch (e: any) { accMap.set(cid, { id: cid, preview: `Error ${e?.message || e}` }); }
        finally { setTable(Array.from(accMap.values())); if (pointer < convIds.length) await runNext(); }
      };
      const starters = Array.from({ length: Math.min(limit, convIds.length) }, () => runNext()); await Promise.all(starters);

      setStage("done"); setStageNote("Completed");
    } catch (e: any) { console.error(e); setStage("error"); setError(e?.message || "Unexpected error"); }
  }, [start, end]);

  return (
    <div className="relative min-h-dvh bg-white text-gray-800">
      <BackgroundFX />
      <div className="relative mx-auto max-w-7xl px-6 py-10">
        <header className="flex items-end justify-between gap-4">
          <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-800">
            Chat Extraction
          </motion.h1>
          <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 transition">Reset</button>
        </header>

        {/* Controls Card */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.05 }} className="mt-8 rounded-2xl border border-gray-200/80 bg-white/70 backdrop-blur shadow-lg shadow-gray-200/40">
          <div className="p-5 md:p-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
              <input type="date" value={start} onChange={e=>setStart(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-4 focus:ring-green-500/30 focus:border-green-500 transition" />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
              <input type="date" value={end} onChange={e=>setEnd(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-4 focus:ring-green-500/30 focus:border-green-500 transition" />
            </div>
            <div className="md:col-span-4 flex gap-3 md:justify-end">
              <button onClick={submit} className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 px-6 py-3 text-white shadow-md transition active:scale-[0.98]">
              <span className="relative z-10">
                {stage === "done" ? "Analyse Data" : "Extract"}
                </span>
                <span className="absolute inset-0 -translate-x-full bg-white/20 group-hover:translate-x-0 transition-transform duration-500" />
              </button>
            </div>
          </div>
          <div className="px-5 md:px-6 pb-5">
            <StageIndicator stage={stage} stageNote={stageNote} reportStatus={reportStatus} reportId={reportId} />
            {error && <div className="mt-4 rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm border border-red-200">{error}</div>}
          </div>
        </motion.div>

        {/* Table Card */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.1 }} className="mt-8 rounded-2xl border border-gray-200/80 bg-white/70 backdrop-blur shadow-lg shadow-gray-200/40">
          <div className="px-5 md:px-6 pt-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-gray-600">{table.length} conversations</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Rows</span>
              <select className="border rounded-lg px-2 py-1.5" value={pageSize} onChange={(e)=>setPageSize(parseInt(e.target.value,10))}>
                <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/70">
                <tr>
                  <Th>ID</Th>
                  <Th>Channel</Th>
                  <Th>Created</Th>
                  <Th>Last Message</Th>
                  <Th className="w-1/2">Preview</Th>
                  <Th>#</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {view.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-500">No rows.</td></tr>
                )}
                {view.map((r) => (
                  <motion.tr key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="hover:bg-gray-50/80">
                    <Td><code className="font-mono text-xs">{r.id}</code></Td>
                    <Td>{r.channel ?? "—"}</Td>
                    <Td>{fmt(r.created_at)}</Td>
                    <Td>{fmt(r.last_message_at)}</Td>
                    <Td className="truncate max-w-[50ch]" title={r.preview}>{r.preview ?? ""}</Td>
                    <Td>{r.messages_count ?? 0}</Td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination total={table.length} page={page} pageSize={pageSize} onPage={setPage} />
        </motion.div>
      </div>
    </div>
  );
}

function BackgroundFX() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Subtle grid */}
      <div className="absolute inset-0 [background:radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.06),transparent_45%)]" />
      {/* Orbiting blobs */}
      <motion.div className="absolute -top-16 -left-16 h-64 w-64 rounded-full bg-green-400/20 blur-3xl" animate={{ rotate: 360 }} transition={{ duration: 60, ease: "linear", repeat: Infinity }} />
      <motion.div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" animate={{ rotate: -360 }} transition={{ duration: 70, ease: "linear", repeat: Infinity }} />
    </div>
  );
}

function StageIndicator({ stage, stageNote, reportStatus, reportId }: { stage: Stage; stageNote: string; reportStatus: string; reportId: string; }) {
  const steps: { key: Stage; label: string; icon: JSX.Element }[] = [
    { key: "requesting", label: "Request", icon: <IconRequest /> },
    { key: "polling", label: "Build", icon: <IconCog /> },
    { key: "downloading", label: "Download", icon: <IconDownload /> },
    { key: "parsing", label: "Parse", icon: <IconParse /> },
    { key: "fetching", label: "Fetch", icon: <IconChat /> },
    { key: "done", label: "Complete", icon: <IconCheck /> },
  ];
  const activeIdx = Math.max(0, steps.findIndex(s => s.key === stage));
  const progress = (activeIdx / (steps.length - 1)) * 100;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white/60 backdrop-blur p-4 md:p-5 shadow-sm">
      <div className="relative">
        {/* Track */}
        <div className="h-2 rounded-full bg-gray-100" />
        {/* Animated fill */}
        <motion.div className="absolute left-0 top-0 h-2 rounded-full bg-gradient-to-r from-green-500 via-emerald-400 to-green-600" style={{ width: `${progress}%` }} initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
        {/* Shimmer */}
        <motion.div className="pointer-events-none absolute left-0 top-0 h-2 w-20 bg-white/40 blur-[2px]" animate={{ x: [0, Math.max(0, progress) + '%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
      </div>

      {/* Steps */}
      <div className="mt-4 grid grid-cols-6">
        {steps.map((s, idx) => {
          const state: "done" | "active" | "upcoming" = idx < activeIdx ? "done" : idx === activeIdx ? "active" : "upcoming";
          return (
            <div key={s.key} className="flex flex-col items-center gap-1">
              <div className={`relative grid place-items-center h-9 w-9 rounded-full ${state === 'done' ? 'bg-green-500 text-white' : state === 'active' ? 'bg-green-50 text-green-600 ring-2 ring-green-500/40' : 'bg-gray-100 text-gray-400'}`}>
                {state === 'active' && <motion.span className="absolute -inset-1 rounded-full bg-green-500/20" initial={{ opacity: 0 }} animate={{ opacity: [0.2, 0.5, 0.2] }} transition={{ duration: 1.6, repeat: Infinity }} />}
                <span className="relative z-10">{state === 'done' ? <IconCheck /> : s.icon}</span>
              </div>
              <div className={`text-[11px] ${state === 'upcoming' ? 'text-gray-400' : 'text-gray-700'}`}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Status pill */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-gray-500">Status:</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${stage === 'done' ? 'bg-green-50 text-green-700 border border-green-200' : stage === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
          {stage === 'polling' && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />}
          {stage === 'fetching' && <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-green-500" />}
          <span className="font-medium">{stage.toUpperCase()}</span>
          {stageNote && <span className="text-gray-500">— {stageNote}</span>}
        </span>
        {reportId && <span className="text-gray-400">Report ID: <code className="font-mono">{reportId}</code></span>}
      </div>
    </div>
  );
}

function Pagination({ total, page, pageSize, onPage }: { total: number; page: number; pageSize: number; onPage: (p:number)=>void; }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  const pages = useMemo(() => {
    const maxButtons = 7; if (pageCount <= maxButtons) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set<number>(); set.add(1); set.add(pageCount); set.add(page); set.add(page-1); set.add(page+1); set.add(page-2); set.add(page+2);
    const arr = Array.from(set).filter(p => p >=1 && p <= pageCount).sort((a,b)=>a-b);
    const out: number[] = []; for (let i=0;i<arr.length;i++){ out.push(arr[i]); if (i < arr.length-1 && arr[i+1]-arr[i] > 1) out.push(-1); }
    return out;
  }, [page, pageSize, pageCount, total]);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-5 md:px-6 py-4 bg-gray-50/70 border-t border-gray-200/80 text-sm text-gray-700 rounded-b-2xl">
      <div>Showing <strong>{start}</strong>–<strong>{end}</strong> of <strong>{total}</strong></div>
      <div className="flex items-center gap-1">
        <PagerBtn disabled={page<=1} onClick={()=>onPage(1)}>«</PagerBtn>
        <PagerBtn disabled={page<=1} onClick={()=>onPage(page-1)}>‹</PagerBtn>
        {pages.map((p,i)=> p === -1 ? <span key={`gap-${i}`} className="px-2 text-gray-400">…</span> : <PagerBtn key={p} active={p===page} onClick={()=>onPage(p)}>{p}</PagerBtn>)}
        <PagerBtn disabled={page>=pageCount} onClick={()=>onPage(page+1)}>›</PagerBtn>
        <PagerBtn disabled={page>=pageCount} onClick={()=>onPage(pageCount)}>»</PagerBtn>
      </div>
    </div>
  );
}

function PagerBtn({ children, onClick, disabled, active }: { children: any; onClick?: ()=>void; disabled?: boolean; active?: boolean; }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`min-w-9 h-9 px-2 rounded-lg border transition ${active ? 'bg-green-600 text-white border-green-600 shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'} disabled:opacity-50 disabled:cursor-not-allowed`}>
      {children}
    </button>
  );
}

function Th({ children, className = "" }: any) { return <th className={`px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider ${className}`}>{children}</th>; }
function Td({ children, className = "" }: any) { return <td className={`px-4 py-3 text-sm text-gray-700 ${className}`}>{children}</td>; }
function fmt(x?: string) { if (!x) return "—"; try { return new Date(x).toLocaleString(); } catch { return x; } }

// ---- Icons (inline, no external lib) ----
function IconCheck(){ return (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>); }
function IconDownload(){ return (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>); }
function IconParse(){ return (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="M9 9h6M9 13h3"/></svg>); }
function IconChat(){ return (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8z"/><path d="M8 9h8M8 13h6"/></svg>); }
function IconRequest(){ return (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22"/><path d="M5 8l7-7 7 7"/></svg>); }
function IconCog(){ return (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 2.09V2a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 22 11v2a1.65 1.65 0 0 0-1.51 1z"/></svg>); }
