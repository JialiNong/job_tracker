"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Live width / height of an element (ResizeObserver). Charts lay out from it,
 * so they redraw when the window, the sidebar, or a neighbouring panel resizes.
 * A hidden element reports 0 x 0; callers skip drawing then.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) => (Math.abs(prev.width - width) < 2 && Math.abs(prev.height - height) < 2 ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
