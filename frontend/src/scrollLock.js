// Page scroll lock with a nesting counter. Pure: env (doc/win) is injected so it can be tested with node --test.
// The page scrolls on the window (html/body). We lock with overflow:hidden on <html> and <body> only — NO position:fixed —
// so the document never moves and the scroll position is never reset. A padding-right equal to the scrollbar width
// avoids layout shift. scroll-behavior is forced to auto while locking/unlocking so a safety restore can't animate.
// iOS touch scroll-through is blocked by overscroll-behavior/touch-action on the modal backdrop (CSS).
export function createScrollLock(env) {
  let count = 0;
  let saved = null;
  const lock = () => {
    count += 1;
    if (count > 1) return;
    const { doc, win } = env();
    const body = doc.body;
    const html = doc.documentElement;
    // Save the position FIRST, before any style change, focus or render can touch it.
    const y = win.scrollY || win.pageYOffset || 0;
    const x = win.scrollX || win.pageXOffset || 0;
    const bar = Math.max(0, (win.innerWidth || 0) - (html.clientWidth || 0));
    saved = {
      y,
      x,
      body: { overflow: body.style.overflow, paddingRight: body.style.paddingRight },
      html: { overflow: html.style.overflow, scrollBehavior: html.style.scrollBehavior },
    };
    const pad = parseFloat(win.getComputedStyle ? win.getComputedStyle(body).paddingRight : 0) || 0;
    html.style.scrollBehavior = "auto";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (bar > 0) body.style.paddingRight = `${pad + bar}px`;
    // Safety net: if anything moved the page while locking, put it straight back (instant).
    if ((win.scrollY || 0) !== y && win.scrollTo) win.scrollTo(x, y);
  };
  const unlock = () => {
    if (count === 0) return;
    count -= 1;
    if (count > 0 || !saved) return;
    const { doc, win } = env();
    const { x, y } = saved;
    const html = doc.documentElement;
    html.style.scrollBehavior = "auto";
    Object.assign(doc.body.style, saved.body);
    html.style.overflow = saved.html.overflow;
    if ((win.scrollY || 0) !== y && win.scrollTo) win.scrollTo(x, y);
    html.style.scrollBehavior = saved.html.scrollBehavior;
    saved = null;
  };
  return { lock, unlock, count: () => count, savedY: () => (saved ? saved.y : null) };
}

let shared = null;
export function sharedScrollLock() {
  if (!shared) shared = createScrollLock(() => ({ doc: document, win: window }));
  return shared;
}

// Focus without ever scrolling the page.
export function focusNoScroll(el) {
  if (!el || typeof el.focus !== "function") return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

// Facebook OAuth appends "#_=_"; drop it so it can never cause a hash jump.
export function cleanFbHash(loc, hist) {
  if (!loc || loc.hash !== "#_=_" || !hist || !hist.replaceState) return false;
  hist.replaceState(hist.state ?? null, "", loc.pathname + loc.search);
  return true;
}
