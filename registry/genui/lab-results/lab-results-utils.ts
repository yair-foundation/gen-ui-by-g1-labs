/**
 * Lab Results: pure helpers (no React), unit-tested in Node.
 *
 * The component only places values on the lab's own reference range. Nothing
 * here interprets a result: "below", "within" and "above" are positions.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type LabRangeLike = {
  low?: number;
  high?: number;
  optimalLow?: number;
  optimalHigh?: number;
  text?: string;
};

export type LabFlagLike = "low" | "high" | "critical-low" | "critical-high";

/** Where a value sits against the lab's range. "unknown": no numeric range. */
export type LabPosition = "below" | "within" | "above" | "unknown";

export type LabStatus = {
  position: LabPosition;
  /** The lab printed a critical flag. */
  critical: boolean;
  /** Inside the lab's optimal band; null when the lab gives none. */
  optimal: boolean | null;
  /** "lab": taken from the printed flag; "range": computed from the range. */
  basis: "lab" | "range";
};

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Status from the lab's printed flag, else from the value and the range. */
export function markerStatus(
  value: number,
  range: LabRangeLike | undefined,
  flag?: LabFlagLike,
): LabStatus {
  const r = range ?? {};
  const low = isNum(r.low) ? r.low : undefined;
  const high = isNum(r.high) ? r.high : undefined;

  let position: LabPosition;
  let basis: LabStatus["basis"] = "range";
  if (flag) {
    basis = "lab";
    position = flag === "low" || flag === "critical-low" ? "below" : "above";
  } else if (low === undefined && high === undefined) {
    position = "unknown";
  } else if (low !== undefined && value < low) {
    position = "below";
  } else if (high !== undefined && value > high) {
    position = "above";
  } else {
    position = "within";
  }

  const oLow = isNum(r.optimalLow) ? r.optimalLow : undefined;
  const oHigh = isNum(r.optimalHigh) ? r.optimalHigh : undefined;
  const optimal =
    oLow === undefined && oHigh === undefined
      ? null
      : (oLow === undefined || value >= oLow) &&
        (oHigh === undefined || value <= oHigh);

  return {
    position,
    critical: flag === "critical-low" || flag === "critical-high",
    optimal,
    basis,
  };
}

export const positionLabel: Record<LabPosition, string> = {
  below: "Below range",
  within: "Within range",
  above: "Above range",
  unknown: "See lab's range",
};

/** Plain-language phrase for screen readers: "below the lab's range". */
export const positionPhrase: Record<LabPosition, string> = {
  below: "below the lab's range",
  within: "within the lab's range",
  above: "above the lab's range",
  unknown: "not placed on a range; see the lab's range",
};

export type SpectrumScale = {
  min: number;
  max: number;
  /** Zone edges as fractions 0–1 of the track. */
  zones: {
    below: [number, number] | null;
    within: [number, number];
    optimal: [number, number] | null;
    above: [number, number] | null;
  };
  /** Tick marks under the track for the lab's low and high bounds. */
  ticks: { value: number; at: number; kind: "low" | "high" }[];
  /** Marker position 0–1 (clamped). */
  at: number;
  /** The value lies beyond the padded scale; draw an arrow at that edge. */
  clamped: "below" | "above" | null;
};

const PAD = 0.25;

/**
 * A padded linear scale around the lab's range (25% of the range's span each
 * side, never below 0 for non-negative ranges), with zone widths and the
 * marker position. Null when the range has no numeric bound.
 */
export function spectrumScale(
  value: number,
  range: LabRangeLike | undefined,
): SpectrumScale | null {
  const r = range ?? {};
  const low = isNum(r.low) ? r.low : undefined;
  const high = isNum(r.high) ? r.high : undefined;
  if (low === undefined && high === undefined) return null;

  let min: number;
  let max: number;
  if (low !== undefined && high !== undefined && high > low) {
    const pad = (high - low) * PAD;
    min = low >= 0 ? Math.max(0, low - pad) : low - pad;
    max = high + pad;
  } else if (low !== undefined && high !== undefined) {
    // Degenerate range (low >= high): centre a small window on it.
    const mid = (low + high) / 2;
    const pad = Math.abs(mid) * PAD || 1;
    min = Math.min(low, high) - pad;
    max = Math.max(low, high) + pad;
  } else if (high !== undefined) {
    // "< 5.2": the range runs from 0 (or below) up to high.
    const span = Math.abs(high) || 1;
    min = high > 0 ? 0 : high - span;
    max = high + span * PAD;
  } else {
    // "> 50": show the bound and as much again above it.
    const lo = low as number;
    const span = Math.abs(lo) || 1;
    min = lo >= 0 ? Math.max(0, lo - span * PAD) : lo - span * PAD;
    max = lo + span + span * PAD;
  }

  const width = max - min;
  const f = (v: number) => Math.min(1, Math.max(0, (v - min) / width));

  const wStart = low !== undefined ? f(low) : 0;
  const wEnd = high !== undefined ? f(high) : 1;
  const below: [number, number] | null =
    low !== undefined && wStart > 0 ? [0, wStart] : null;
  const above: [number, number] | null =
    high !== undefined && wEnd < 1 ? [wEnd, 1] : null;

  const oLow = isNum(r.optimalLow) ? r.optimalLow : undefined;
  const oHigh = isNum(r.optimalHigh) ? r.optimalHigh : undefined;
  let optimal: [number, number] | null = null;
  if (oLow !== undefined || oHigh !== undefined) {
    const a = oLow !== undefined ? f(oLow) : wStart;
    const b = oHigh !== undefined ? f(oHigh) : wEnd;
    if (b > a) optimal = [a, b];
  }

  const ticks: SpectrumScale["ticks"] = [];
  if (low !== undefined) ticks.push({ value: low, at: f(low), kind: "low" });
  if (high !== undefined)
    ticks.push({ value: high, at: f(high), kind: "high" });

  const clamped = value < min ? "below" : value > max ? "above" : null;

  return {
    min,
    max,
    zones: { below, within: [wStart, wEnd], optimal, above },
    ticks,
    at: f(value),
    clamped,
  };
}

/** Decimal places of a number as written, e.g. 4.10 → 1 (JS drops zeros). */
export function decimals(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]) || 0;
  return s.split(".")[1]?.length ?? 0;
}

/** A value as the lab printed it (no rounding beyond its own precision). */
export function formatNumber(
  n: number,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.min(6, decimals(n)),
  }).format(n);
}

/** The range in words: "3.5–5.1", "< 5.2", "≥ 50"; falls back to `text`. */
export function rangeText(
  range: LabRangeLike | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const r = range ?? {};
  const low = isNum(r.low) ? r.low : undefined;
  const high = isNum(r.high) ? r.high : undefined;
  if (low !== undefined && high !== undefined) {
    return `${formatNumber(low, locale)}–${formatNumber(high, locale)}`;
  }
  if (high !== undefined)
    return r.text?.trim() || `≤ ${formatNumber(high, locale)}`;
  if (low !== undefined)
    return r.text?.trim() || `≥ ${formatNumber(low, locale)}`;
  return r.text?.trim() || null;
}

/** The optimal band in words: "< 2.6", "1.0–1.5"; null when absent. */
export function optimalText(
  range: LabRangeLike | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const r = range ?? {};
  const a = isNum(r.optimalLow) ? r.optimalLow : undefined;
  const b = isNum(r.optimalHigh) ? r.optimalHigh : undefined;
  if (a !== undefined && b !== undefined)
    return `${formatNumber(a, locale)}–${formatNumber(b, locale)}`;
  if (b !== undefined) return `≤ ${formatNumber(b, locale)}`;
  if (a !== undefined) return `≥ ${formatNumber(a, locale)}`;
  return null;
}

export type Counts = Record<LabPosition, number>;

export function countPositions(positions: LabPosition[]): Counts {
  const c: Counts = { below: 0, within: 0, above: 0, unknown: 0 };
  for (const p of positions) c[p] += 1;
  return c;
}

/** "18 within range · 2 above · 1 below"; zero parts are left out. */
export function countsSummary(c: Counts): string {
  const parts: string[] = [];
  if (c.within > 0) parts.push(`${c.within} within range`);
  if (c.above > 0) parts.push(`${c.above} above`);
  if (c.below > 0) parts.push(`${c.below} below`);
  if (c.unknown > 0) parts.push(`${c.unknown} without a numeric range`);
  return parts.join(" · ");
}

/** Parses ISO dates; date-only strings are local dates, not UTC. */
export function parseDate(value: string | undefined): Date | null {
  if (typeof value !== "string") return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number);
    const date = new Date(y, m - 1, d);
    return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  value: string | undefined,
  style: "long" | "short" = "long",
  locale: string = DEFAULT_LOCALE,
): string | null {
  const d = parseDate(value);
  if (!d) return null;
  return new Intl.DateTimeFormat(
    locale,
    style === "long"
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", year: "2-digit" },
  ).format(d);
}

export type HistoryPointLike = { date: string; value: number };

/** Valid points, oldest first, all before `takenAt` when it parses. */
export function cleanHistory(
  history: Partial<HistoryPointLike>[] | undefined,
  takenAt?: string,
): HistoryPointLike[] {
  const cutoff = parseDate(takenAt)?.getTime();
  return (history ?? [])
    .filter(
      (p): p is HistoryPointLike =>
        isNum(p?.value) && parseDate(p?.date) !== null,
    )
    .map((p) => ({ p, t: (parseDate(p.date) as Date).getTime() }))
    .filter(({ t }) => cutoff === undefined || t < cutoff)
    .sort((a, b) => a.t - b.t)
    .map(({ p }) => ({ date: p.date, value: p.value }));
}

export type TrendDelta = {
  delta: number;
  direction: "up" | "down" | "same";
  /** Magnitude only: "0.4". */
  amount: string;
  /** "Mar" or "Mar 2025"; empty when the earlier date is unknown. */
  since: string;
  /** Visible: "↑ 0.4 since Mar". */
  text: string;
  /** For screen readers: "Up 0.4 since Mar 2026". */
  srText: string;
};

/**
 * Change since the most recent earlier result. Rounded to the precision the
 * lab used, so 4.5 − 4.1 reads 0.4, not 0.39999.
 */
export function trendDelta(
  value: number,
  history: HistoryPointLike[],
  takenAt?: string,
  locale: string = DEFAULT_LOCALE,
): TrendDelta | null {
  const prev = history[history.length - 1];
  if (!prev) return null;
  const places = Math.min(6, Math.max(decimals(value), decimals(prev.value)));
  const factor = 10 ** places;
  const delta = Math.round((value - prev.value) * factor) / factor;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "same";

  const prevDate = parseDate(prev.date);
  const taken = parseDate(takenAt);
  let since = "";
  let sinceLong = "";
  if (prevDate) {
    const sameYear = !taken || taken.getFullYear() === prevDate.getFullYear();
    since = new Intl.DateTimeFormat(
      locale,
      sameYear ? { month: "short" } : { month: "short", year: "numeric" },
    ).format(prevDate);
    sinceLong = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(prevDate);
  }
  const amount = new Intl.NumberFormat(locale, {
    maximumFractionDigits: places,
  }).format(Math.abs(delta));
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "=";
  const word =
    direction === "up" ? "Up" : direction === "down" ? "Down" : "No change";
  const text =
    direction === "same"
      ? `No change${since ? ` since ${since}` : ""}`
      : `${arrow} ${amount}${since ? ` since ${since}` : ""}`;
  const srText =
    direction === "same"
      ? `No change${sinceLong ? ` since ${sinceLong}` : ""}`
      : `${word} ${amount}${sinceLong ? ` since ${sinceLong}` : ""}`;
  return { delta, direction, amount, since, text, srText };
}

/**
 * Sparkline geometry in a w×h box: polyline points, the range band (y from the
 * top) and the last point. The domain covers the values and the range bounds.
 */
export function sparkline(
  values: number[],
  range: LabRangeLike | undefined,
  w: number,
  h: number,
  inset = 2,
): {
  points: string;
  band: { y: number; height: number } | null;
  last: { x: number; y: number };
} | null {
  const vals = values.filter(isNum);
  if (vals.length < 2) return null;
  const r = range ?? {};
  const low = isNum(r.low) ? r.low : undefined;
  const high = isNum(r.high) ? r.high : undefined;
  const domain = [...vals];
  if (low !== undefined) domain.push(low);
  if (high !== undefined) domain.push(high);
  let lo = Math.min(...domain);
  let hi = Math.max(...domain);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const y = (v: number) => inset + (1 - (v - lo) / (hi - lo)) * (h - inset * 2);
  const x = (i: number) => inset + (i / (vals.length - 1)) * (w - inset * 2);
  const round = (n: number) => Math.round(n * 100) / 100;
  const pts = vals.map((v, i) => `${round(x(i))},${round(y(v))}`).join(" ");
  let band: { y: number; height: number } | null = null;
  if (low !== undefined || high !== undefined) {
    const top = high !== undefined ? y(high) : 0;
    const bottom = low !== undefined ? y(low) : h;
    band = { y: round(top), height: round(Math.max(0, bottom - top)) };
  }
  const lastI = vals.length - 1;
  return {
    points: pts,
    band,
    last: { x: round(x(lastI)), y: round(y(vals[lastI])) },
  };
}

export type MarkerGroup<T> = { group: string | null; markers: T[] };

/** Groups in first-seen order; ungrouped markers form one group (null). */
export function groupMarkers<T extends { group?: string }>(
  markers: T[],
): MarkerGroup<T>[] {
  const out: MarkerGroup<T>[] = [];
  const index = new Map<string | null, number>();
  for (const m of markers) {
    const key = m.group?.trim() || null;
    let i = index.get(key);
    if (i === undefined) {
      i = out.length;
      index.set(key, i);
      out.push({ group: key, markers: [] });
    }
    out[i].markers.push(m);
  }
  return out;
}

export type LabFilter = "all" | "out";

export const isOutOfRange = (p: LabPosition) => p === "below" || p === "above";

export function filterMarkers<T>(
  markers: T[],
  filter: LabFilter,
  positionOf: (m: T) => LabPosition,
): T[] {
  return filter === "all"
    ? markers
    : markers.filter((m) => isOutOfRange(positionOf(m)));
}
