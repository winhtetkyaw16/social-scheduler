// Locks body scroll while a modal is open, including nested dialogs.
import { useLayoutEffect } from "react";
import { sharedScrollLock } from "./scrollLock.js";

// While `active`, lock the page scroll; nested locks are counted, and everything is restored on close/unmount.
export default function useBodyScrollLock(active = true) {
  useLayoutEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    const scrollLock = sharedScrollLock();
    scrollLock.lock();
    return () => scrollLock.unlock();
  }, [active]);
}
