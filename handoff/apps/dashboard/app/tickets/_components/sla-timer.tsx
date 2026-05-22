"use client";

import { useEffect, useState } from "react";

// Compact SLA indicator: a circular progress ring + remaining time.
// Ring fills as the deadline approaches; turns red when overdue.
//
// Props match the original component so all existing call sites
// (KanbanBoard cards, ticket detail page) keep working.
export function SlaTimer({
  deadline,
  size = 16,
  showLabel = true,
}: {
  deadline: string | null;
  size?: number;
  showLabel?: boolean;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!deadline) return;
    // 30s ticks — the ring's 1-minute granularity makes anything
    // faster a waste of renders.
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) {
    return showLabel ? (
      <span className="text-xs text-slate-400">no SLA</span>
    ) : null;
  }

  const diffMs = new Date(deadline).getTime() - Date.now();
  const absSec = Math.floor(Math.abs(diffMs) / 1000);
  const overdue = diffMs < 0;

  // Fill fraction: 0 when fresh, 1 when overdue.
  // We anchor "full ring" to 4 hours of SLA window — past that, ring is
  // mostly empty and reads as "plenty of time".
  const windowSec = 4 * 60 * 60;
  const fill = overdue ? 1 : Math.min(1, 1 - diffMs / (windowSec * 1000));

  const tone = colorFor(diffMs);
  const stroke = 1.8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${tone.text}`}>
      <svg width={size} height={size} className="shrink-0">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          className="stroke-slate-200"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          className={tone.stroke}
          strokeWidth={stroke}
          strokeDasharray={`${circ * fill} ${circ * (1 - fill)}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray .3s" }}
        />
      </svg>
      {showLabel && (
        <span className="text-[11px] font-medium">{formatDuration(absSec, overdue)}</span>
      )}
    </span>
  );
}

function formatDuration(sec: number, overdue: boolean): string {
  const suffix = overdue ? " over" : "";
  if (sec < 60) return `${sec}s${suffix}`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const mm = m % 60;
    return mm === 0 ? `${h}h${suffix}` : `${h}h ${mm}m${suffix}`;
  }
  const d = Math.floor(h / 24);
  return `${d}d${suffix}`;
}

function colorFor(diffMs: number): { text: string; stroke: string } {
  if (diffMs < 0) return { text: "text-rose-600 font-semibold", stroke: "stroke-rose-500" };
  const mins = diffMs / 60_000;
  if (mins < 30)  return { text: "text-rose-600",  stroke: "stroke-rose-500" };
  if (mins < 240) return { text: "text-amber-600", stroke: "stroke-amber-500" };
  return { text: "text-slate-500", stroke: "stroke-emerald-500" };
}
