import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Play, X as XIcon } from "lucide-react";
import ModalPortal from "./ModalPortal.jsx";
import { focusNoScroll } from "./scrollLock.js";
import { buildFixPlan, fmtDuration, indicesForChoice, planResult, togglePick } from "./fixPlan.js";

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"]),summary';
const isVideoItem = (item) => typeof item === "string" ? /\.(mp4|mov|webm|m4v)(\?|$)/i.test(item) : String(item?.type || "").startsWith("video/");

function useObjectUrl(file) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!file || typeof file === "string") { setUrl(typeof file === "string" ? file : ""); return undefined; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url;
}

/** Real preview: image, or a video frame with a play icon and duration. */
function Prev({ item, info, on, tick, onClick, label }) {
  const url = useObjectUrl(item);
  const vid = isVideoItem(item);
  const body = <>{url && (vid ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" /> : <img src={url} alt="" />)}
    {vid && <span className="pl" aria-hidden="true"><Play size={10} fill="currentColor" /></span>}
    {vid && fmtDuration(info?.duration) && <span className="du">{fmtDuration(info.duration)}</span>}
    {tick && <span className={`tk${on ? " on" : ""}`} aria-hidden="true">{on && <Check size={10} strokeWidth={3} />}</span>}</>;
  if (onClick) return <button type="button" className={`fxt${on ? "" : " off"}`} role="checkbox" aria-checked={on} aria-label={label} onClick={onClick}>{body}</button>;
  return <i className="fxt">{body}</i>;
}

function Strip({ items, infos, indices }) {
  const shown = indices.slice(0, 5);
  return <span className="th" aria-hidden="true">{shown.map((i) => <Prev key={i} item={items[i]} info={infos[i]} />)}{indices.length > 5 && <i className="more">+{indices.length - 5}</i>}</span>;
}

/** Photos | Video (| GIF) segmented control: radiogroup with arrow keys. */
function Seg({ options, value, onChange, label }) {
  const refs = useRef([]);
  const move = (e, i) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return; e.preventDefault();
    const n = (i + d + options.length) % options.length; onChange(options[n]); focusNoScroll(refs.current[n]);
  };
  return <span className="sg" role="radiogroup" aria-label={label}>{options.map((o, i) => <button key={o} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === o} tabIndex={value === o ? 0 : -1} className={value === o ? "on" : ""} onClick={() => onChange(o)} onKeyDown={(e) => move(e, i)}>{o}</button>)}</span>;
}

/**
 * "Fix for me" sheet. rows = mediaReport rows. Apply hands { selections, skip, count } to onApply.
 * renderAvatar(account) and nameOf(account) let the composer supply its identity components.
 */
export default function FixSheet({ rows, items, onApply, onCancel, onAddMedia, renderAvatar, nameOf, returnFocus }) {
  const [ov, setOv] = useState({});
  const [pick, setPick] = useState(null); // { id, sel }
  const [drag, setDrag] = useState(0);
  const box = useRef(null), closeBtn = useRef(null), dragStart = useRef(null);
  const input = useMemo(() => rows.map((r) => ({ account: r.account, format: r.format, infos: r.sharedInfos, problems: r.check.problems.length })), [rows]);
  const plan = useMemo(() => buildFixPlan(input, ov), [input, ov]);
  const infosOf = (id) => input.find((r) => r.account.id === id)?.infos || [];

  useEffect(() => {
    const trigger = returnFocus?.current || document.activeElement;
    focusNoScroll(closeBtn.current);
    return () => { if (trigger && typeof trigger.focus === "function") window.setTimeout(() => focusNoScroll(trigger), 0); };
  }, []);
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); return; }
    if (e.key !== "Tab" || !box.current) return;
    const f = [...box.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); focusNoScroll(last); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); focusNoScroll(first); }
  };
  const set = (id, patch) => setOv((o) => ({ ...o, [id]: { ...(o[id] || {}), ...patch } }));
  // Mobile: drag the handle down to cancel.
  const down = (e) => { dragStart.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const moveDrag = (e) => { if (dragStart.current != null) setDrag(Math.max(0, e.clientY - dragStart.current)); };
  const up = () => { if (dragStart.current == null) return; const d = drag; dragStart.current = null; setDrag(0); if (d > 90) onCancel(); };

  const row = (e) => {
    const id = e.account.id, infos = infosOf(id), name = nameOf(e.account);
    const open = pick?.id === id;
    return <div className={`fr${e.skipped ? " skip" : ""}`} key={id}>
      <span className="av">{renderAvatar(e.account)}</span>
      <div className="tx">
        <div className="nm">{name}<span>{e.identity}</span></div>
        <div className="s2">{e.line2}{!e.skipped && e.changed ? <em className="chgd">Changed from suggestion</em> : null}</div>
        {e.line3 && <div className="s3">{e.line3}</div>}
      </div>
      <span className="rt">{!e.skipped && e.indices.length > 0 && <Strip items={items} infos={infos} indices={e.indices} />}</span>
      <div className="ctl">
        {e.skipped ? <button type="button" className="chg" onClick={() => set(id, { skip: false })}>Undo skip</button> : <>
          {e.options.length > 0 && <><Seg label={`Media for ${name}`} options={e.options} value={e.choice} onChange={(c) => set(id, { indices: indicesForChoice(e.platform, infos, c, { xPhotos: ov[id]?.xPhotos }) })} />{!e.changed && <span className="sug">Suggested</span>}</>}
          {e.picker && (e.picker.kind !== "x4" || e.choice === "Photos") && <>{!e.options.length && !e.changed && <span className="sug">Suggested</span>}<button type="button" className="chg" aria-expanded={open} onClick={() => setPick(open ? null : { id, sel: e.indices.filter((i) => e.picker.items.includes(i)) })}>{e.picker.label}</button></>}
          {e.empty && <><button type="button" className="chg" onClick={onAddMedia}>Add a video</button><button type="button" className="chg" onClick={() => set(id, { skip: true })}>Skip this account</button></>}
        </>}
      </div>
      {open && !e.skipped && <div className="pk" role="group" aria-label={`Pick items for ${name}`}>
        <div className="ph"><b>{e.picker.kind === "x4" ? `Choose which 4 for ${name}` : `Pick items for ${name}`}</b><span>{pick.sel.length} of {e.picker.items.length} · up to {e.picker.limit}</span></div>
        <div className="pg">{e.picker.items.map((i) => <Prev key={i} item={items[i]} info={infos[i]} tick on={pick.sel.includes(i)} label={`Item ${i + 1}`} onClick={() => setPick((p) => ({ ...p, sel: togglePick(p.sel, i, e.picker.limit) }))} />)}</div>
        <div className="pa"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPick(null)}>Cancel</button><button type="button" className="btn btn-grad btn-sm" onClick={() => { set(id, e.picker.kind === "x4" ? { xPhotos: pick.sel, indices: pick.sel } : { indices: pick.sel }); setPick(null); }}>Done</button></div>
      </div>}
    </div>;
  };

  const total = plan.counts.total;
  return <ModalPortal inner="c2"><div className="fx" onClick={(ev) => { if (ev.target === ev.currentTarget) onCancel(); }} onKeyDown={onKey}>
    <div className="bx" ref={box} role="dialog" aria-modal="true" aria-labelledby="fx-title" style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
      <div className="hdl" aria-hidden="true" onPointerDown={down} onPointerMove={moveDrag} onPointerUp={up} onPointerCancel={up}><span /></div>
      <div className="fh" onPointerDown={down} onPointerMove={moveDrag} onPointerUp={up} onPointerCancel={up}>
        <div><h3 id="fx-title">Here's what each account will get</h3><p>We picked the best fit for each one. Change anything below.</p></div>
        <button type="button" ref={closeBtn} className="x" aria-label="Close" onPointerDown={(ev) => ev.stopPropagation()} onClick={onCancel}><XIcon size={18} /></button>
      </div>
      <div className="fb">
        {plan.changing.map(row)}
        {plan.unchanged.length > 0 && <details className="nc"><summary><span className="avs" aria-hidden="true">{plan.unchanged.slice(0, 5).map((e) => <span key={e.account.id}>{renderAvatar(e.account)}</span>)}</span><span className="grow">No changes needed · {plan.unchanged.length} account{plan.unchanged.length === 1 ? "" : "s"}</span><ChevronDown size={16} aria-hidden="true" /></summary>{plan.unchanged.map(row)}</details>}
      </div>
      <div className="ff">
        <p>You can still edit each account after.</p>
        <button type="button" className="btn btn-secondary fc" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-grad fa" disabled={!total} onClick={() => onApply(planResult(plan))}>Apply to {total} account{total === 1 ? "" : "s"}</button>
      </div>
    </div>
  </div></ModalPortal>;
}
