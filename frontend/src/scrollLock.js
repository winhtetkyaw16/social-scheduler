// Body scroll lock with a nesting counter. Pure: env (doc/win) is injected so it can be tested with node --test.
// The page scrolls on the window (html/body), so we lock <body> with position:fixed + top offset (works on iOS Safari),
// pad by the scrollbar width to avoid layout shift, and restore the exact scroll position when the last lock releases.
export function createScrollLock(env) {
  let count = 0;
  let saved = null;
  const lock = () => {
    count += 1;
    if (count > 1) return;
    const { doc, win } = env();
    const body = doc.body;
    const html = doc.documentElement;
    const y = win.scrollY || win.pageYOffset || 0;
    const x = win.scrollX || win.pageXOffset || 0;
    const bar = Math.max(0, (win.innerWidth || 0) - (html.clientWidth || 0));
    const keys = ["overflow", "position", "top", "left", "right", "width", "paddingRight", "touchAction"];
    saved = { y, x, body: Object.fromEntries(keys.map((k) => [k, body.style[k]])), htmlOverflow: html.style.overflow };
    const pad = parseFloat(win.getComputedStyle ? win.getComputedStyle(body).paddingRight : 0) || 0;
    Object.assign(body.style, { overflow: "hidden", position: "fixed", top: `-${y}px`, left: `-${x}px`, right: "0", width: "100%", touchAction: "none" });
    if (bar > 0) body.style.paddingRight = `${pad + bar}px`;
    html.style.overflow = "hidden";
  };
  const unlock = () => {
    if (count === 0) return;
    count -= 1;
    if (count > 0 || !saved) return;
    const { doc, win } = env();
    Object.assign(doc.body.style, saved.body);
    doc.documentElement.style.overflow = saved.htmlOverflow;
    const { x, y } = saved;
    saved = null;
    if (win.scrollTo) win.scrollTo(x, y);
  };
  return { lock, unlock, count: () => count };
}

let shared = null;
export function sharedScrollLock() {
  if (!shared) shared = createScrollLock(() => ({ doc: document, win: window }));
  return shared;
}
