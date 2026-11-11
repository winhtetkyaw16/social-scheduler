// Evergreen and Bulk upload cards shown in Queue settings.
import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, LoaderCircle, Repeat, Upload } from "lucide-react";
import { Ch, postTitle } from "./ui.jsx";
import { bulkSummary, evergreenStatus, intervalOptions } from "../queueExtras.js";

export function EvergreenCard({ request, accounts = [], timezone = "UTC" }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const platformOf = (row) =>
    accounts.find((account) => account.id === row.connected_account_id)?.platform;

  async function load() {
    setLoading(true);
    try {
      const result = await request("/publish/evergreen");
      setRows(Array.isArray(result) ? result.filter(Boolean) : []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load evergreen posts.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [request]);

  async function save(row, changes) {
    setBusy(row.post_id);
    setError("");
    try {
      const updated = await request(`/publish/evergreen/${row.post_id}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: changes.enabled ?? row.enabled,
          interval_days: changes.interval_days ?? row.interval_days,
          timezone,
        }),
      });
      setRows((current) =>
        current.map((item) => (item.post_id === row.post_id ? { ...item, ...updated } : item)),
      );
    } catch (err) {
      setError(err.message || "Could not save this post.");
    } finally {
      setBusy("");
    }
  }

  const enabledCount = rows.filter((row) => row.enabled).length;
  return (
    <div className="card card-pad col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <h2>Evergreen</h2>
        {enabledCount > 0 && <span className="badge nodot">{enabledCount} on</span>}
      </div>
      <p className="xs subtle" style={{ marginTop: -8 }}>
        Turn on a published post to re-share it when a queue slot is empty. The post that went out
        longest ago goes first, and each channel has at most one re-share waiting.
      </p>
      {error && (
        <div role="alert" className="alert error sm">
          {error}
        </div>
      )}
      {loading ? (
        <div className="col" style={{ gap: 8 }}>
          <div className="skel" style={{ height: 48 }} />
          <div className="skel" style={{ height: 48 }} />
        </div>
      ) : !rows.length ? (
        <div className="row sm subtle sc-evergreen-empty">
          <Repeat size={16} aria-hidden="true" />
          No published posts yet. Once a post goes out, you can turn it on here.
        </div>
      ) : (
        <ul className="sc-evergreen-list">
          {rows.map((row) => {
            const platform = platformOf(row);
            return (
              <li key={row.post_id} className="sc-evergreen-row">
                {platform && <Ch platform={platform} />}
                <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="sm sc-evergreen-title">{postTitle(row)}</span>
                  <span className="xs subtle">{evergreenStatus(row)}</span>
                </div>
                <select
                  className="select sc-evergreen-every"
                  aria-label="Re-share at most every"
                  value={row.interval_days}
                  disabled={busy === row.post_id}
                  onChange={(event) =>
                    void save(row, { interval_days: Number(event.target.value) })
                  }
                >
                  {intervalOptions(row.interval_days).map((days) => (
                    <option key={days} value={days}>
                      Every {days} days
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`toggle ${row.enabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`Evergreen for “${postTitle(row)}”`}
                  disabled={busy === row.post_id}
                  onClick={() => void save(row, { enabled: !row.enabled })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function BulkUploadCard({ request, timezone = "UTC", onScheduled, pickRef }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (pickRef) pickRef.current = () => inputRef.current?.click();
  }, [pickRef]);

  async function send(chosen, dryRun) {
    setBusy(dryRun ? "check" : "schedule");
    setError("");
    try {
      const body = new FormData();
      body.append("file", chosen);
      body.append("timezone", timezone);
      body.append("dry_run", dryRun ? "true" : "false");
      const outcome = await request("/publish/bulk", { method: "POST", body });
      setResult(outcome);
      if (!dryRun && outcome?.created) await onScheduled?.();
    } catch (err) {
      setError(err.message || "Could not upload this file.");
    } finally {
      setBusy("");
    }
  }

  function choose(chosen) {
    if (!chosen) return;
    setFile(chosen);
    setResult(null);
    void send(chosen, true);
  }

  async function downloadTemplate() {
    setError("");
    try {
      // The API answers with CSV text; the shared request helper hands non-JSON back as detail.
      const body = await request("/publish/bulk/template");
      const text = typeof body === "string" ? body : body?.detail || "";
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "socialcastly-bulk-template.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Could not download the template.");
    }
  }

  const summary = bulkSummary(result);
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  return (
    <div className="card card-pad col" style={{ gap: 16 }} id="bulk-upload">
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2>Bulk upload</h2>
          <p className="xs subtle" style={{ marginTop: 4 }}>
            Schedule many posts at once from a CSV file. Times use your timezone ({timezone}).
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={downloadTemplate}>
          <Download size={14} />
          Download template
        </button>
      </div>
      <label
        className={`dropzone sc-bulk-drop ${dragging ? "sc-drop-on" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {busy === "check" ? (
          <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <Upload size={18} aria-hidden="true" />
        )}
        <span className="sm">
          <b>{file ? file.name : "Drop a CSV here"}</b>
          {file ? " · choose another file" : " or click to choose one"}
        </span>
        <span className="xs subtle">Columns: date, time, channel, caption, image_url</span>
      </label>
      {error && (
        <div role="alert" className="alert error sm">
          {error}
        </div>
      )}
      {summary && (
        <div className={`sc-bulk-result ${summary.tone}`} role="status">
          {summary.tone === "error" ? (
            <AlertCircle size={16} className="sc-bulk-icon err" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={16} className="sc-bulk-icon ok" aria-hidden="true" />
          )}
          <div className="col grow" style={{ gap: 4 }}>
            <b className="sm">{summary.title}</b>
            <span className="xs subtle">{summary.text}</span>
            {errors.length > 0 && (
              <ul className="sc-bulk-errors">
                {errors.map((item, index) => (
                  <li key={`${item.row}-${index}`} className="sm">
                    {item.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {summary.tone === "ready" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!!busy}
              onClick={() => void send(file, false)}
            >
              {busy === "schedule" && <LoaderCircle size={14} className="animate-spin" />}
              Schedule {result.valid_rows} post{result.valid_rows === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
