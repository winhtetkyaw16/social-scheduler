import React, { useEffect, useRef, useState } from "react";
import { Clock3, ChevronDown, LoaderCircle, Zap, CalendarDays } from "lucide-react";

export const PUBLISH_MODES = [
  { id: "schedule", label: "Schedule", cta: "Schedule post" },
  { id: "queue", label: "Queue", cta: "Add to queue" },
  { id: "now", label: "Now", cta: "Post now" },
];

/** Segmented Schedule | Queue | Now control (radiogroup with roving tabindex + arrow keys). */
export function PublishModeControl({ mode, onChange, disabled }) {
  const refs = useRef([]);
  const idx = Math.max(0, PUBLISH_MODES.findIndex((m) => m.id === mode));
  function onKeyDown(e) {
    const step = ["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 0;
    let next = null;
    if (step) next = (idx + step + PUBLISH_MODES.length) % PUBLISH_MODES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = PUBLISH_MODES.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(PUBLISH_MODES[next].id);
    refs.current[next]?.focus();
  }
  return <div className="c2-pseg" role="radiogroup" aria-label="When to publish" onKeyDown={onKeyDown}>
    {PUBLISH_MODES.map((m, i) => <button key={m.id} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={mode === m.id} tabIndex={mode === m.id ? 0 : -1} disabled={disabled} className={mode === m.id ? "on" : ""} onClick={() => onChange(m.id)}>{m.label}</button>)}
  </div>;
}

function formatSlot(iso, timeZone) {
  const d = new Date(iso);
  const opts = { timeZone: timeZone || undefined };
  try {
    return `${d.toLocaleDateString(undefined, { ...opts, weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { ...opts, hour: "numeric", minute: "2-digit" })}`;
  } catch { return d.toLocaleString(); }
}

/** Earliest free queue slot across the selected channels, via GET /publish/queue/next (same slot service /queue/allocate uses). */
export function useNextQueueSlot({ request, accounts, timeZone, enabled }) {
  const [state, setState] = useState({ loading: false, slot: null, none: false });
  const key = accounts.map((a) => a.id).sort().join(",");
  useEffect(() => {
    if (!enabled || !request || !accounts.length) { setState({ loading: false, slot: null, none: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const tz = encodeURIComponent(timeZone || "UTC");
    Promise.allSettled(accounts.map((a) => request(`/publish/queue/next?connected_account_id=${encodeURIComponent(a.id)}&timezone=${tz}`)))
      .then((results) => {
        if (!alive) return;
        const ok = results.filter((r) => r.status === "fulfilled" && r.value?.scheduled_at).map((r) => r.value);
        // Every selected channel needs a slot, otherwise allocate would fail on submit.
        if (ok.length < accounts.length) { setState({ loading: false, slot: null, none: true }); return; }
        const earliest = ok.reduce((a, b) => (new Date(b.scheduled_at) < new Date(a.scheduled_at) ? b : a));
        setState({ loading: false, slot: earliest, none: false });
      });
    return () => { alive = false; };
  }, [enabled, request, key, timeZone]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export default function PublishBar(props) {
  const { mode, setMode, busy, submit, saveAsDraft, whenText, zoneText, date, setDate, time, setTime, timeZone, setTimeZone, timezones, minDate, request, selectedAccounts, onSetupQueue } = props;
  const [whenOpen, setWhenOpen] = useState(false);
  const q = useNextQueueSlot({ request, accounts: selectedAccounts, timeZone, enabled: mode === "queue" });
  const noSlots = mode === "queue" && q.none;
  const cta = PUBLISH_MODES.find((m) => m.id === mode)?.cta || "Schedule post";

  let detail;
  if (mode === "schedule") {
    detail = <span style={{ position: "relative" }} className="c2-when-wrap">
      <button type="button" className="when" aria-expanded={whenOpen} aria-label={`Publish time: ${whenText} ${zoneText}`} onClick={() => setWhenOpen((o) => !o)}><CalendarDays className="ico" />{whenText}<span className="subtle">{zoneText}</span><ChevronDown size={14} className="subtle" /></button>
      {whenOpen && <div className="menu c2-whenpop">
        <label className="label">Date<input type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="label">Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="label">Time zone<select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>{!timezones.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}{timezones.map((tz) => <option key={tz} value={tz}>{tz.replaceAll("_", " ")}</option>)}</select></label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWhenOpen(false)}>Done</button>
      </div>}
    </span>;
  } else if (mode === "queue") {
    detail = <span className="c2-pinfo" aria-live="polite"><Clock3 className="ico" />{
      !selectedAccounts.length ? "Pick a channel to see the next slot"
        : q.loading && !q.slot ? "Finding next slot…"
          : q.none ? <>No queue times set <a className="c2-plink" onClick={onSetupQueue} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onSetupQueue?.(); }}>Set up</a></>
            : q.slot ? `Next slot: ${formatSlot(q.slot.scheduled_at, timeZone)}` : "Next slot"
    }</span>;
  } else {
    detail = <span className="c2-pinfo"><Zap className="ico" />Publishes immediately</span>;
  }

  return <div className="abar c2-pbar">
    <button type="button" className="btn btn-secondary c2-pdraft" onClick={() => void saveAsDraft()} disabled={busy}>Save draft</button>
    <span className="grow c2-pgrow" />
    <div className="c2-pctl">
      <PublishModeControl mode={mode} onChange={(m) => { setMode(m); setWhenOpen(false); }} />
      <div className="c2-pdet">{detail}</div>
    </div>
    <button type="button" className="btn btn-primary c2-pbtn" disabled={busy || noSlots} onClick={() => submit(mode)}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : null}{cta}</button>
  </div>;
}
