import React, { useEffect, useRef, useState } from "react";
import { X as XIcon } from "lucide-react";
import { ChannelTile } from "./sc/ui.jsx";
import { connectIntroCopy } from "./connectIntro.js";
import { focusNoScroll } from "./scrollLock.js";
import useBodyScrollLock from "./useBodyScrollLock.js";
import ModalPortal from "./ModalPortal.jsx";
import "./sc/fb-picker.css";

function useIsMobile() {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches),
  );
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.(query) : null;
    if (!mq) return undefined;
    const on = () => setMobile(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

/** Pre-OAuth intro shown on Connect and Re-auth, before the provider login. */
export default function ConnectIntroDialog({
  channel,
  reconnect = false,
  onClose,
  onConnect,
  busy = false,
  error = "",
}) {
  const mobile = useIsMobile();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const continueRef = useRef(null);
  const dragStart = useRef(null);
  const [drag, setDrag] = useState(0);
  useBodyScrollLock(!!channel);

  const cancel = () => {
    if (!busy) onClose?.();
  };

  useEffect(() => {
    if (!channel) return undefined;
    focusNoScroll(continueRef.current);
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [
        ...dialogRef.current.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]'),
      ];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        focusNoScroll(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focusNoScroll(first);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [channel, busy]);

  if (!channel) return null;

  const copy = connectIntroCopy(channel.id, { reconnect, label: channel.label });
  const markSize = mobile ? 24 : 28;
  const mark = <ChannelTile platform={channel.id} size={markSize} className="fbp-mark" />;

  const onDragStart = (event) => {
    if (mobile && !busy) dragStart.current = event.clientY;
  };
  const onDragMove = (event) => {
    if (dragStart.current != null) setDrag(Math.max(0, event.clientY - dragStart.current));
  };
  const onDragEnd = () => {
    if (dragStart.current == null) return;
    dragStart.current = null;
    if (drag > 90) cancel();
    setDrag(0);
  };

  const continueBtn = (
    <button
      ref={continueRef}
      type="button"
      className="btn btn-grad fbp-add"
      disabled={busy}
      onClick={() => onConnect?.(channel.id)}
    >
      {busy ? "Redirecting\u2026" : copy.continueLabel}
    </button>
  );
  const cancelBtn = (
    <button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>
      Cancel
    </button>
  );

  return (
    <ModalPortal>
      <div
        className={`fbp-wrap${mobile ? " m" : ""}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) cancel();
        }}
      >
        <div
          ref={dialogRef}
          className="fbp fbp-intro"
          role="dialog"
          aria-modal="true"
          aria-labelledby="connect-intro-title"
          style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
        >
          {mobile && (
            <div
              className="fbp-grab"
              aria-hidden="true"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <i />
            </div>
          )}
          <header
            className="fbp-h"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            {mark}
            <div className="fbp-ht">
              <h2 id="connect-intro-title">{copy.title}</h2>
              <p className="sm subtle">{copy.subtitle}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={cancel}
              className="btn btn-ghost btn-icon btn-sm fbp-x"
              aria-label="Close"
              disabled={busy}
            >
              <XIcon size={17} />
            </button>
          </header>
          <div className="fbp-b">
            {copy.bullets.length > 0 && (
              <ul className="fbp-bul">
                {copy.bullets.map((item) => (
                  <li key={item}>
                    <i />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
            {copy.note ? <p className="fbp-stay">{copy.note}</p> : null}
            {error ? (
              <p role="alert" className="sm fbp-err" style={{ marginTop: 12 }}>
                {error}
              </p>
            ) : null}
          </div>
          <footer className="fbp-f">
            {mobile ? (
              <>
                {continueBtn}
                {cancelBtn}
              </>
            ) : (
              <>
                <span className="fbp-count" />
                {cancelBtn}
                {continueBtn}
              </>
            )}
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}
