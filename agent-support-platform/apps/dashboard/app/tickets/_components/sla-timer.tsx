"use client";

import { useEffect, useState } from "react";

export function SlaTimer({ deadline }: { deadline: string | null }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return <span className="text-xs text-slate-400">no SLA</span>;

  const diffMs = new Date(deadline).getTime() - Date.now();
  const absSec = Math.floor(Math.abs(diffMs) / 1000);
  const overdue = diffMs < 0;

  const text = formatDuration(absSec, overdue);
  const color = colorFor(diffMs);

  return (
    <span className={`text-xs tabular-nums ${color}`}>
      {text}
    </span>
  );
}

function formatDuration(sec: number, overdue: boolean): string {
  const prefix = overdue ? "overdue " : "";
  const suffix = overdue ? "" : " left";

  if (sec < 60) return `${prefix}${sec}s${suffix}`;
  const m = Math.floor(sec / 60);
  if (m < 60) {
    const s = sec % 60;
    return `${prefix}${m}m ${s}s${suffix}`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    const mm = m % 60;
    return `${prefix}${h}h ${mm}m${suffix}`;
  }
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return `${prefix}${d}d ${hh}h${suffix}`;
}

function colorFor(diffMs: number): string {
  if (diffMs < 0) return "text-red-600 font-medium";
  const mins = diffMs / 60000;
  if (mins < 30) return "text-red-600";
  if (mins < 240) return "text-amber-600"; // <4h
  return "text-slate-500";
}
