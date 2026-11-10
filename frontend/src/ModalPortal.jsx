// Renders dialog children on document.body so they sit above the studio shell.
import { createPortal } from "react-dom";
import { modalLayerClass } from "./modalLayer.js";

/** Render a modal straight into <body>, wrapped in the `.scd` scope (plus `.c2` for composer styles when asked). */
export default function ModalPortal({ children, inner = "" }) {
  if (typeof document === "undefined") return null;
  const body = inner ? <div className={inner}>{children}</div> : children;
  return createPortal(<div className={modalLayerClass(document)}>{body}</div>, document.body);
}
