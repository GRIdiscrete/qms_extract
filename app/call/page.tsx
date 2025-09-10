"use client";

import { JSX, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

// ---------- Types ----------
type Stage =
  | "idle"
  | "requesting"
  | "polling"
  | "downloading"
  | "parsing"
  | "done"
  | "error";

interface ExportCreateResponse {
  id: number;
  status?: string;
  message?: string;
}

interface JobStatusResponse {
  bulk_job: {
    id: number;
    status: "queued" | "started" | "completed" | "failed";
    created_time?: string;
    updated_time?: string;
    job_data?: { path?: string };
  };
}

interface RecordingMeta {
  id: number;
  url: string; // Freshcaller API path -> resolve to { recording: { download_url } }
  transcription_url?: string | null;
  duration?: number;
  duration_unit?: string;
}

interface Participant {
  id: number;
  participant_type: "Customer" | "Agent";
  caller_number?: string | null;
  caller_name?: string | null;
  duration?: number;
}

interface LifeCycle {
  type: string;
  time_stamp: string;
}

export interface CallRow {
  id: number;
  direction: "incoming" | "outgoing" | "internal" | null;
  phone_number: string | null;
  external_number: string | null;
  assigned_agent_name: string | null;
  assigned_team_name: string | null;
  assigned_call_queue_name: string | null;
  created_time: string | null;
  updated_time: string | null;
  bill_duration: number;
  participants: Participant[];
  life_cycle: LifeCycle[];
  recording: RecordingMeta | null;
  // UI
  recording_url?: string;
}

// ---------- Helpers ----------
function normalizeCall(c: any): CallRow {
  return {
    id: c?.id,
    direction: c?.direction ?? null,
    phone_number: c?.external_number ?? c?.phone_number ?? null,
    external_number: c?.external_number ?? null,
    assigned_agent_name: c?.assigned_agent_name ?? null,
    assigned_team_name: c?.assigned_team_name ?? null,
    assigned_call_queue_name: c?.assigned_call_queue_name ?? null,
    created_time: c?.created_time ?? null,
    updated_time: c?.updated_time ?? null,
    bill_duration:
      typeof c?.bill_duration === "number"
        ? c.bill_duration
        : c?.bill_duration
        ? Number(c.bill_duration)
        : 0,
    participants: Array.isArray(c?.participants) ? c.participants : [],
    life_cycle: Array.isArray(c?.life_cycle) ? c.life_cycle : [],
    recording: c?.recording ?? null,
  };
}

function fmt(x?: string | null) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString();
  } catch {
    return x;
  }
}

export default function Caller() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stageNote, setStageNote] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("");
  const [allRows, setAllRows] = useState<CallRow[]>([]);
  const [error, setError] = useState("");

  // filter toggle
  const [onlyWithRecordings, setOnlyWithRecordings] = useState(true);

  // derive filtered rows
  const rows = useMemo(
    () =>
      onlyWithRecordings
        ? allRows.filter((c) => !!(c.recording && c.recording.id))
        : allRows,
    [allRows, onlyWithRecordings]
  );

  // pagination (applies to filtered rows)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
    if (page < 1) setPage(1);
  }, [page, pageCount]);
  const view = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize]
  );

  const reset = () => {
    setStage("idle");
    setStageNote("");
    setJobId(null);
    setJobStatus("");
    setAllRows([]);
    setError("");
    setPage(1);
  };

  const submit = useCallback(async () => {
    try {
      setError("");
      setAllRows([]);
      setPage(1);

      if (!start || !end) throw new Error("Select a start and end date");

      const startISO = new Date(start).toISOString();
      const endISO = new Date(end).toISOString();

      // 1) Create export
      setStage("requesting");
      setStageNote("Requesting export …");
      const createRes = await fetch("/api/freshcaller/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_range: { start_date: startISO, end_date: endISO },
          resources: [
            {
              name: "calls",
              include: [
                "participants",
                "recording",
                "life_cycle",
                "integrated_resources",
              ],
            },
          ],
          output_format: "json",
          delivery_type: "email",
        }),
      });
      if (!createRes.ok) {
        const tx = await createRes.text();
        throw new Error(`Export failed (${createRes.status}): ${tx}`);
      }
      const createJson = (await createRes.json()) as ExportCreateResponse;
      if (!createJson.id) throw new Error("No job id returned");
      setJobId(createJson.id);

      // 2) Poll status
      setStage("polling");
      setStageNote("Building export …");
      let finalJob: JobStatusResponse | null = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        const r = await fetch(`/api/freshcaller/jobs/${createJson.id}`);
        if (!r.ok) throw new Error(`Status check failed (${r.status})`);
        const j = (await r.json()) as JobStatusResponse;
        const status = j?.bulk_job?.status ?? "unknown";
        setJobStatus(status);
        setStageNote(`Job status: ${status}`);
        if (status === "completed") {
          finalJob = j;
          break;
        }
        if (status === "failed") throw new Error("Export job failed");
        await new Promise((res) => setTimeout(res, 5000));
      }
      if (!finalJob || finalJob.bulk_job.status !== "completed")
        throw new Error("Timed out waiting for export");

      // 3) Download and merge JSON files
      const href = finalJob.bulk_job.job_data?.path;
      if (!href) throw new Error("No export download path");
      setStage("downloading");
      setStageNote("Downloading export …");
      const dlRes = await fetch(
        `/api/freshcaller/download?url=${encodeURIComponent(href)}`
      );
      if (!dlRes.ok) throw new Error(`Download failed (${dlRes.status})`);

      // 4) Parse + normalize
      setStage("parsing");
      setStageNote("Parsing JSON …");
      const raw = await dlRes.json();
      const calls: CallRow[] = Array.isArray(raw) ? raw.map(normalizeCall) : [];

      setAllRows(calls);
      setStage("done");
      setStageNote("Completed");
    } catch (e: any) {
      console.error(e);
      setStage("error");
      setError(e?.message || "Unexpected error");
    }
  }, [start, end]);

  // Resolve fresh signed URL then download via our proxy
  const downloadRecording = useCallback(
    async (callId: number) => {
      try {
        const row = rows.find((r) => r.id === callId);
        if (!row) throw new Error("Row not found");
        if (!row.recording?.id || !row.recording?.url) {
          throw new Error("No recording metadata for this call");
        }

        // 1) Resolve metadata -> fresh signed S3 download_url
        const metaRes = await fetch(
          `/api/freshcaller/recording?url=${encodeURIComponent(
            row.recording.url
          )}`
        );
        if (!metaRes.ok)
          throw new Error(`Metadata fetch failed (${metaRes.status})`);
        const meta = await metaRes.json();
        const downloadUrl: string | undefined = meta?.recording?.download_url;
        if (!downloadUrl) throw new Error("No download_url in metadata");

        // 2) Download via our proxy
        const saveHref = `/api/freshcaller/recording/save?url=${encodeURIComponent(
          downloadUrl
        )}`;

        // Open in new tab to trigger browser download dialog
        window.open(saveHref, "_blank", "noopener,noreferrer");
      } catch (e: any) {
        setError(e?.message || "Recording download error");
        setStage("error");
      }
    },
    [rows]
  );

  // ---- NEW: Zip-all state + handler ----
  const [zipBusy, setZipBusy] = useState(false);

  const downloadAllZip = useCallback(async () => {
    try {
      setZipBusy(true);
      setError("");

      const items = allRows
        .filter((r) => r.recording?.id && r.recording?.url)
        .map((r) => ({
          callId: r.id,
          recId: r.recording!.id,
          metaUrl: r.recording!.url,
          created_time: r.created_time,
          phone: r.external_number || r.phone_number || null,
          agent: r.assigned_agent_name || null,
        }));

      if (items.length === 0) throw new Error("No recordings to download");

      const res = await fetch("/api/freshcaller/recordings/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Zip failed (${res.status}): ${text}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `freshcaller_recordings_${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "Zip download error");
      setStage("error"); // optional: reuses the existing status surfacing
    } finally {
      setZipBusy(false);
    }
  }, [allRows]);

  const downloadableCount = useMemo(
    () => allRows.filter((r) => r.recording?.id && r.recording?.url).length,
    [allRows]
  );

  return (
    <div className="relative min-h-dvh bg-white text-gray-800">
      <BackgroundFX />
      <div className="relative mx-auto max-w-7xl px-6 py-10">
        <header className="flex items-end justify-between gap-4">
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-800"
          >
            Caller Extraction
          </motion.h1>
          <button
            onClick={reset}
            className="text-sm text-gray-500 hover:text-gray-700 transition"
          >
            Reset
          </button>
        </header>

        {/* Controls */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="mt-8 rounded-2xl border border-gray-200/80 bg-white/70 backdrop-blur shadow-lg shadow-gray-200/40"
        >
          <div className="p-5 md:p-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Start
              </label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-4 focus:ring-green-500/30 focus:border-green-500 transition"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                End
              </label>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-4 focus:ring-green-500/30 focus:border-green-500 transition"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Filter
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyWithRecordings}
                  onChange={(e) => {
                    setOnlyWithRecordings(e.target.checked);
                    setPage(1); // reset pagination on filter change
                  }}
                />
                Only with recordings
              </label>
            </div>

            <div className="md:col-span-3 flex gap-3 md:justify-end">
              <button
                onClick={submit}
                className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 px-6 py-3 text-white shadow-md transition active:scale-[0.98]"
              >
                <span className="relative z-10">
                  {stage === "done" ? "Analyse Calls" : "Extract"}
                </span>
                <span className="absolute inset-0 -translate-x-full bg-white/20 group-hover:translate-x-0 transition-transform duration-500" />
              </button>
            </div>
          </div>

          <div className="px-5 md:px-6 pb-5">
            <StageIndicator
              stage={stage}
              stageNote={stageNote}
              jobStatus={jobStatus}
              jobId={jobId ?? undefined}
            />
            {error && (
              <div className="mt-4 rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm border border-red-200">
                {error}
              </div>
            )}
          </div>
        </motion.div>

        {/* Table */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="mt-8 rounded-2xl border border-gray-200/80 bg-white/70 backdrop-blur shadow-lg shadow-gray-200/40"
        >
          <div className="px-5 md:px-6 pt-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-gray-600">
              {rows.length} call{rows.length === 1 ? "" : "s"}
              {onlyWithRecordings && " (with recordings)"}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Rows</span>
                <select
                  className="border rounded-lg px-2 py-1.5"
                  value={pageSize}
                  onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              {/* NEW: Download all (.zip) */}
              <button
                onClick={downloadAllZip}
                disabled={zipBusy || downloadableCount === 0}
                className="group relative overflow-hidden rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-100 disabled:opacity-50"
                title={
                  downloadableCount === 0
                    ? "No recordings to download"
                    : "Download all recordings as a single zip"
                }
              >
                <span className="relative z-10">
                  {zipBusy ? "Preparing…" : `Download all (.zip)`}
                </span>
                <span className="absolute inset-0 -translate-x-full bg-gray-200/40 group-hover:translate-x-0 transition-transform duration-500" />
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/70">
                <tr>
                  <Th>ID</Th>
                  <Th>Direction</Th>
                  <Th>Number</Th>
                  <Th>Agent</Th>
                  <Th>Team / Queue</Th>
                  <Th>Created</Th>
                  <Th>Bill (s)</Th>
                  <Th>Recording</Th>
                  <Th className="w-1/5">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {view.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-500">
                      No rows.
                    </td>
                  </tr>
                )}
                {view.map((r) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="hover:bg-gray-50/80"
                  >
                    <Td>
                      <code className="font-mono text-xs">{r.id}</code>
                    </Td>
                    <Td className="capitalize">{r.direction ?? "—"}</Td>
                    <Td className="truncate max-w-[20ch]">
                      {r.external_number || r.phone_number || "—"}
                    </Td>
                    <Td>{r.assigned_agent_name ?? "—"}</Td>
                    <Td>
                      <div
                        className="max-w-[28ch] truncate"
                        title={`${r.assigned_team_name ?? ""} / ${r.assigned_call_queue_name ?? ""}`}
                      >
                        {(r.assigned_team_name || "—") +
                          " / " +
                          (r.assigned_call_queue_name || "—")}
                      </div>
                    </Td>
                    <Td>{fmt(r.created_time)}</Td>
                    <Td>
                      {typeof r.bill_duration === "number" ? r.bill_duration : 0}
                    </Td>
                    <Td>{r.recording?.id ? `#${r.recording.id}` : "—"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-xs rounded-lg border px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
                          disabled={!r.recording?.id}
                          onClick={() => downloadRecording(r.id)}
                          title="Download recording"
                        >
                          Download
                        </button>
                      </div>
                    </Td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            total={rows.length}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
          />
        </motion.div>
      </div>
    </div>
  );
}

// ---------- UI bits ----------
function BackgroundFX() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 [background:radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.06),transparent_45%)]" />
      <motion.div
        className="absolute -top-16 -left-16 h-64 w-64 rounded-full bg-green-400/20 blur-3xl"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, ease: "linear", repeat: Infinity }}
      />
      <motion.div
        className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl"
        animate={{ rotate: -360 }}
        transition={{ duration: 70, ease: "linear", repeat: Infinity }}
      />
    </div>
  );
}

function StageIndicator({
  stage,
  stageNote,
  jobStatus,
  jobId,
}: {
  stage: Stage;
  stageNote: string;
  jobStatus?: string;
  jobId?: number;
}) {
  const steps: { key: Stage; label: string; icon: JSX.Element }[] = [
    { key: "requesting", label: "Request", icon: <IconRequest /> },
    { key: "polling", label: "Build", icon: <IconCog /> },
    { key: "downloading", label: "Download", icon: <IconDownload /> },
    { key: "parsing", label: "Parse", icon: <IconParse /> },
    { key: "done", label: "Complete", icon: <IconCheck /> },
  ];
  const activeIdx = Math.max(0, steps.findIndex((s) => s.key === stage));
  const progress = (activeIdx / (steps.length - 1)) * 100;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white/60 backdrop-blur p-4 md:p-5 shadow-sm">
      <div className="relative">
        <div className="h-2 rounded-full bg-gray-100" />
        <motion.div
          className="absolute left-0 top-0 h-2 rounded-full bg-gradient-to-r from-green-500 via-emerald-400 to-green-600"
          style={{ width: `${progress}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
        <motion.div
          className="pointer-events-none absolute left-0 top-0 h-2 w-20 bg-white/40 blur-[2px]"
          animate={{ x: [0, Math.max(0, progress) + "%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="mt-4 grid grid-cols-5">
        {steps.map((s, idx) => {
          const state: "done" | "active" | "upcoming" =
            idx < activeIdx ? "done" : idx === activeIdx ? "active" : "upcoming";
          return (
            <div key={s.key} className="flex flex-col items-center gap-1">
              <div
                className={`relative grid place-items-center h-9 w-9 rounded-full ${
                  state === "done"
                    ? "bg-green-500 text-white"
                    : state === "active"
                    ? "bg-green-50 text-green-600 ring-2 ring-green-500/40"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {state === "active" && (
                  <motion.span
                    className="absolute -inset-1 rounded-full bg-green-500/20"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.2, 0.5, 0.2] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                  />
                )}
                <span className="relative z-10">
                  {state === "done" ? <IconCheck /> : s.icon}
                </span>
              </div>
              <div
                className={`text-[11px] ${
                  state === "upcoming" ? "text-gray-400" : "text-gray-700"
                }`}
              >
                {s.label}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-gray-500">Status:</span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
            stage === "done"
              ? "bg-green-50 text-green-700 border border-green-200"
              : stage === "error"
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-gray-50 text-gray-700 border border-gray-200"
          }`}
        >
          {stage === "polling" && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
          )}
          <span className="font-medium">{stage.toUpperCase()}</span>
          {stageNote && <span className="text-gray-500">— {stageNote}</span>}
        </span>
        {typeof jobId === "number" && (
          <span className="text-gray-400">
            Job ID: <code className="font-mono">{jobId}</code>
          </span>
        )}
        {jobStatus && (
          <span className="text-gray-400">({jobStatus.toUpperCase()})</span>
        )}
      </div>
    </div>
  );
}

function Pagination({
  total,
  page,
  pageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  const pages = useMemo(() => {
    const maxButtons = 7;
    if (pageCount <= maxButtons)
      return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set<number>();
    set.add(1);
    set.add(pageCount);
    set.add(page);
    set.add(page - 1);
    set.add(page + 1);
    set.add(page - 2);
    set.add(page + 2);
    const arr = Array.from(set)
      .filter((p) => p >= 1 && p <= pageCount)
      .sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      out.push(arr[i]);
      if (i < arr.length - 1 && arr[i + 1] - arr[i] > 1) out.push(-1);
    }
    return out;
  }, [page, pageSize, pageCount, total]);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-5 md:px-6 py-4 bg-gray-50/70 border-t border-gray-200/80 text-sm text-gray-700 rounded-b-2xl">
      <div>
        Showing <strong>{start}</strong>–<strong>{end}</strong> of{" "}
        <strong>{total}</strong>
      </div>
      <div className="flex items-center gap-1">
        <PagerBtn disabled={page <= 1} onClick={() => onPage(1)}>
          «
        </PagerBtn>
        <PagerBtn disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹
        </PagerBtn>
        {pages.map((p, i) =>
          p === -1 ? (
            <span key={`gap-${i}`} className="px-2 text-gray-400">
              …
            </span>
          ) : (
            <PagerBtn key={p} active={p === page} onClick={() => onPage(p)}>
              {p}
            </PagerBtn>
          )
        )}
        <PagerBtn disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          ›
        </PagerBtn>
        <PagerBtn disabled={page >= pageCount} onClick={() => onPage(pageCount)}>
          »
        </PagerBtn>
      </div>
    </div>
  );
}

function PagerBtn({
  children,
  onClick,
  disabled,
  active,
}: {
  children: any;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-9 h-9 px-2 rounded-lg border transition ${
        active
          ? "bg-green-600 text-white border-green-600 shadow-sm"
          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Th({ children, className = "" }: any) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }: any) {
  return <td className={`px-4 py-3 text-sm text-gray-700 ${className}`}>{children}</td>;
}

// ---- Icons (inline) ----
function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}
function IconParse() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16v16H4z" />
      <path d="M9 9h6M9 13h3" />
    </svg>
  );
}
function IconRequest() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1v22" />
      <path d="M5 8l7-7 7 7" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 2.09V2a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 22 11v2a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
