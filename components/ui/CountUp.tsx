"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";

export function CountUp({ kobo }: { kobo: number }) {
  const [shown, setShown] = useState(kobo);
  const from = useRef(kobo);
  useEffect(() => {
    if (from.current === kobo) return;
    const start = from.current;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 700);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(start + (kobo - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = kobo;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = kobo; };
  }, [kobo]);
  return <>{money(shown)}</>;
}
