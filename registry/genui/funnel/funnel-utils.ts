/**
 * Funnel: pure helpers (no React), so they can be unit-tested in Node.
 *
 * - pctOfFirst / stepConversions / dropCounts: the per-step numbers.
 * - biggestDrop: the step-to-step drop with the highest rate.
 * - overallConversion / conversionChange: first → last, and the change vs
 *   the previous period in percentage points.
 * - findIncreases: steps whose count goes up (a data problem worth showing).
 * - normalizeSegments: drops segments whose counts don't match the steps.
 * - estimateOpportunity: what recovering a share of the biggest drop is worth.
 * - csvEscape / buildCsv / funnelCsv / csvFileName: the export.
 * - formatCount / formatCompact / formatPct / formatSignedPct / formatPts /
 *   formatMoney / formatAsOf: display text.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

/** The share of the biggest drop the opportunity line assumes is recovered. */
export const RECOVERY_SHARE = 0.05;

export type FunnelStepData = {
  id: string;
  label: string;
  count: number;
  previous?: number;
};

export type FunnelSegmentData = {
  id: string;
  label: string;
  counts: number[];
};

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Per-step numbers
// ---------------------------------------------------------------------------

/** Each count as a fraction of the first (0–1+). All zeros when the first is 0. */
export function pctOfFirst(counts: number[]): number[] {
  const first = counts[0];
  if (!isNum(first) || first <= 0) return counts.map(() => 0);
  return counts.map((c) => (isNum(c) ? c / first : 0));
}

/**
 * Step-to-step conversion: count[i] / count[i-1]. Null for the first step
 * and when the previous step is 0.
 */
export function stepConversions(counts: number[]): (number | null)[] {
  return counts.map((c, i) => {
    if (i === 0) return null;
    const prev = counts[i - 1];
    if (!isNum(prev) || prev <= 0 || !isNum(c)) return null;
    return c / prev;
  });
}

/** People lost before each step: count[i-1] - count[i]. 0 for the first step. */
export function dropCounts(counts: number[]): number[] {
  return counts.map((c, i) => (i === 0 ? 0 : counts[i - 1] - c));
}

export type Drop = {
  /** Index of the step after the drop (the connector sits above it). */
  index: number;
  /** Fraction of the previous step that left, 0–1. */
  rate: number;
  /** People who left. */
  lost: number;
};

/**
 * The step-to-step drop with the highest rate (ties: the earlier one).
 * Only real drops count; null when nobody leaves anywhere.
 */
export function biggestDrop(counts: number[]): Drop | null {
  let best: Drop | null = null;
  for (let i = 1; i < counts.length; i++) {
    const prev = counts[i - 1];
    const cur = counts[i];
    if (!isNum(prev) || !isNum(cur) || prev <= 0) continue;
    const lost = prev - cur;
    if (lost <= 0) continue;
    const rate = lost / prev;
    if (!best || rate > best.rate + 1e-12) best = { index: i, rate, lost };
  }
  return best;
}

/** Last / first, or null when the first step is 0 or missing. */
export function overallConversion(counts: number[]): number | null {
  if (counts.length < 2) return null;
  const first = counts[0];
  const last = counts[counts.length - 1];
  if (!isNum(first) || !isNum(last) || first <= 0) return null;
  return last / first;
}

export type ConversionChange = {
  current: number;
  previous: number;
  /** In percentage points: 2.8% vs 2.5% is +0.3. */
  deltaPts: number;
};

/**
 * Overall conversion now and in the previous period. Needs `previous` on
 * the first and last steps; null otherwise.
 */
export function conversionChange(
  steps: Pick<FunnelStepData, "count" | "previous">[],
): ConversionChange | null {
  if (steps.length < 2) return null;
  const current = overallConversion(steps.map((s) => s.count));
  const first = steps[0].previous;
  const last = steps[steps.length - 1].previous;
  if (current === null || !isNum(first) || !isNum(last)) return null;
  const previous = overallConversion([first, last]);
  if (previous === null) return null;
  return { current, previous, deltaPts: (current - previous) * 100 };
}

/** Relative change of a count vs its previous value, or null. */
export function countChange(count: number, previous: number | undefined) {
  if (!isNum(previous) || previous <= 0 || !isNum(count)) return null;
  return (count - previous) / previous;
}

export type Increase = { index: number; label: string; message: string };

/** Steps whose count is higher than the step before: a funnel can't grow. */
export function findIncreases(
  steps: Pick<FunnelStepData, "label">[],
  counts: number[],
): Increase[] {
  const out: Increase[] = [];
  for (let i = 1; i < counts.length; i++) {
    if (isNum(counts[i]) && isNum(counts[i - 1]) && counts[i] > counts[i - 1]) {
      const label = steps[i]?.label ?? `step ${i + 1}`;
      out.push({
        index: i,
        label,
        message: `Step counts go up at ${label}: check the data`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export type SegmentIssue = { id: string; label: string; message: string };

/**
 * Keeps segments with one finite, non-negative count per step (at most 4,
 * unique ids). The rest are reported, never silently dropped.
 */
export function normalizeSegments(
  segments: Partial<FunnelSegmentData>[] | undefined,
  stepCount: number,
  max = 4,
): { valid: FunnelSegmentData[]; issues: SegmentIssue[] } {
  const valid: FunnelSegmentData[] = [];
  const issues: SegmentIssue[] = [];
  const seen = new Set<string>();
  for (const s of segments ?? []) {
    if (typeof s.id !== "string" || typeof s.label !== "string") continue;
    const label = s.label;
    const counts = Array.isArray(s.counts) ? s.counts : [];
    if (seen.has(s.id)) {
      issues.push({
        id: s.id,
        label,
        message: `${label} left out: duplicate id`,
      });
      continue;
    }
    if (counts.length !== stepCount) {
      issues.push({
        id: s.id,
        label,
        message: `${label} left out: ${counts.length} ${counts.length === 1 ? "count" : "counts"} for ${stepCount} steps`,
      });
      continue;
    }
    if (!counts.every((c) => isNum(c) && c >= 0)) {
      issues.push({
        id: s.id,
        label,
        message: `${label} left out: counts must be numbers ≥ 0`,
      });
      continue;
    }
    if (valid.length >= max) {
      issues.push({
        id: s.id,
        label,
        message: `${label} left out: at most ${max} segments`,
      });
      continue;
    }
    seen.add(s.id);
    valid.push({ id: s.id, label, counts });
  }
  return { valid, issues };
}

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

export type Opportunity = Drop & {
  /** People recovered at the step after the drop. */
  recovered: number;
  /** Extra conversions, assuming recovered people convert like the rest. */
  conversions: number;
  /** conversions × value per conversion. */
  value: number;
  share: number;
};

/**
 * Recovering `share` of the people lost at the biggest drop: they reach the
 * step after it, then convert to the last step at that step's rate.
 */
export function estimateOpportunity(
  counts: number[],
  perConversion: number | undefined,
  share = RECOVERY_SHARE,
): Opportunity | null {
  if (!isNum(perConversion) || perConversion <= 0) return null;
  const drop = biggestDrop(counts);
  if (!drop) return null;
  const at = counts[drop.index];
  const last = counts[counts.length - 1];
  const downstream =
    drop.index === counts.length - 1 ? 1 : at > 0 ? last / at : 0;
  const recovered = drop.lost * share;
  const conversions = recovered * downstream;
  return {
    ...drop,
    recovered,
    conversions,
    value: conversions * perConversion,
    share,
  };
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

/**
 * Bar width in percent of the track: count / base, at least `min` so a
 * tiny step still shows a mark (0 stays 0), at most 100.
 */
export function barWidth(count: number, base: number, min = 1.5): number {
  if (!isNum(count) || count <= 0 || !isNum(base) || base <= 0) return 0;
  return Math.min(100, Math.max(min, (count / base) * 100));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, quote or newline,
 * with quotes doubled. Text starting with = + - @ (or a tab/CR) is prefixed
 * with ' so spreadsheets don't run it as a formula; numbers stay numbers.
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** The funnel as CSV: one row per step, ratios in percent with 1 decimal. */
export function funnelCsv(
  steps: FunnelStepData[],
  segments: FunnelSegmentData[] = [],
): string {
  const counts = steps.map((s) => s.count);
  const ofFirst = pctOfFirst(counts);
  const conv = stepConversions(counts);
  const hasPrevious = steps.some((s) => isNum(s.previous));
  const header = [
    "Step",
    "Count",
    "% of first step",
    "Step conversion %",
    ...(hasPrevious ? ["Previous"] : []),
    ...segments.map((s) => `${s.label} count`),
  ];
  const rows = steps.map((s, i) => [
    s.label,
    s.count,
    round(ofFirst[i] * 100, 1),
    conv[i] === null ? null : round((conv[i] as number) * 100, 1),
    ...(hasPrevious ? [isNum(s.previous) ? s.previous : null] : []),
    ...segments.map((seg) => seg.counts[i] ?? null),
  ]);
  return buildCsv([header, ...rows]);
}

/** "Checkout funnel" → "checkout-funnel.csv". */
export function csvFileName(title: string | undefined): string {
  const slug = (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "funnel"}.csv`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 18240 → "18,240". */
export function formatCount(
  n: number,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

/** 18240 → "18.2K"; under 10,000 the full number. */
export function formatCompact(
  n: number,
  locale: string = DEFAULT_LOCALE,
): string {
  if (Math.abs(n) < 10_000) return formatCount(n, locale);
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** A ratio as a percent: one decimal under 10% (2.8%), none above (42%). */
export function formatPct(
  ratio: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const pct = Math.abs(ratio * 100);
  const digits = pct > 0 && pct < 10 ? 1 : 0;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(ratio);
}

const MINUS = "−";

/** A ratio with a sign: +4.0%, −42%. Zero is "0%". */
export function formatSignedPct(
  ratio: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const text = formatPct(Math.abs(ratio), locale);
  if (text === formatPct(0, locale)) return text;
  return ratio > 0 ? `+${text}` : `${MINUS}${text}`;
}

/** Percentage points with a sign and one decimal: "+0.3 pts", "−1.2 pts". */
export function formatPts(
  pts: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const abs = Math.abs(pts);
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const text = nf.format(abs);
  const zero = nf.format(0);
  if (text === zero) return `${zero} pts`;
  return `${pts > 0 ? "+" : MINUS}${text} pts`;
}

/** "Up 0.3 points", "Down 1.2 points", "No change". */
export function describePts(
  pts: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const text = formatPts(pts, locale);
  if (text === formatPts(0, locale)) return "No change";
  const abs = text.slice(1).replace(" pts", "");
  const one = formatPts(1, locale).slice(1).replace(" pts", "");
  return `${pts > 0 ? "Up" : "Down"} ${abs} ${abs === one ? "point" : "points"}`;
}

/** "Up 4.0%", "Down 3%", "No change". */
export function describeChange(
  ratio: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const text = formatPct(Math.abs(ratio), locale);
  if (text === formatPct(0, locale)) return "No change";
  return `${ratio > 0 ? "Up" : "Down"} ${text}`;
}

export type Direction = "up" | "down" | "flat";

/** Up, down or flat; flat when the displayed text rounds to zero. */
export function direction(
  value: number,
  display: string,
  locale: string = DEFAULT_LOCALE,
): Direction {
  // Zero shown = no non-zero digit, in the locale's own digits.
  const nf = new Intl.NumberFormat(locale);
  const shown = [1, 2, 3, 4, 5, 6, 7, 8, 9].some((d) =>
    display.includes(nf.format(d)),
  );
  if (!shown) return "flat";
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

/**
 * An estimate in a currency, to 3 significant digits so it doesn't read as
 * exact: 12437 → "$12,400". Falls back to a plain number for bad codes.
 */
export function formatMoney(
  value: number,
  currency: string | undefined,
  locale: string = DEFAULT_LOCALE,
) {
  const opts: Intl.NumberFormatOptions = { maximumSignificantDigits: 3 };
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        ...opts,
      }).format(value);
    } catch {
      // Invalid currency code: fall through.
    }
  }
  return new Intl.NumberFormat(locale, opts).format(value);
}

/** The full value per conversion: "$64", "$64.50". */
export function formatPrice(
  value: number,
  currency: string | undefined,
  locale: string = DEFAULT_LOCALE,
) {
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      }).format(value);
    } catch {
      // Invalid currency code: fall through.
    }
  }
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * ISO date → "Oct 8, 2026"; date-time → "Oct 8, 2026, 9:00 AM" in the
 * viewer's time zone. Anything else is returned as given.
 */
export function formatAsOf(
  iso: string,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1) return iso;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date);
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return iso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

/** One sentence for the figure's aria-label. */
export function describeFunnel(
  steps: Pick<FunnelStepData, "label">[],
  counts: number[],
  scope?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (steps.length < 2 || counts.length < 2) return "Funnel";
  const first = steps[0];
  const last = steps[steps.length - 1];
  const overall = overallConversion(counts);
  const drop = biggestDrop(counts);
  return [
    `Funnel${scope ? ` for ${scope}` : ""}, ${steps.length} steps from ${first.label} (${formatCount(counts[0], locale)}) to ${last.label} (${formatCount(counts[counts.length - 1], locale)}).`,
    overall !== null ? `${formatPct(overall, locale)} convert.` : "",
    drop
      ? `Biggest drop: after ${steps[drop.index - 1].label}, ${formatPct(drop.rate, locale)} leave.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
