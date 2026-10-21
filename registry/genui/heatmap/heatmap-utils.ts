/**
 * Heatmap: pure helpers (no React), so they can be unit-tested in Node.
 *
 * - quantize / quantizeDiverging / levelOf / bucketLabels: the color scale.
 *   Sequential buckets are the Region Map's (equal width, nice bounds, one ink
 *   mixed into the neutral base), so heatmaps and maps read alike.
 * - textTone: dark or light text for a bucket's fill, by contrast.
 * - buildCalendar / activityStats / monthlyTotals: the calendar layout.
 * - buildValueGrid / cohortObserved / cohortFocusColumn: matrix and cohort.
 * - findExtremes / peakPhrase: peaks, ties included.
 * - formatValue, parseHour and friends: labels.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type HeatmapFormat = "number" | "percent" | "currency" | "duration-min";

export type ValueFormat = {
  format?: HeatmapFormat;
  currency?: string;
  /** Appended to full values: "1,240 orders". */
  unit?: string;
  /** Show "+" on positive values (diverging scales around 0). */
  signed?: boolean;
};

// ---------------------------------------------------------------------------
// Formatting

function formatDuration(
  minutes: number,
  style: "compact" | "full",
  signed: boolean,
): string {
  const sign = minutes < 0 ? "−" : signed && minutes > 0 ? "+" : "";
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (style === "compact") {
    if (h === 0) return `${sign}${m}m`;
    return `${sign}${h}h${m ? ` ${m}m` : ""}`;
  }
  if (h === 0) return `${sign}${m} min`;
  return `${sign}${h} hr${m ? ` ${m} min` : ""}`;
}

/** "orders" → "order" for exactly 1. Leaves words ending in "ss" alone. */
function unitFor(value: number, unit: string): string {
  return Math.abs(value) === 1 && /[^s]s$/.test(unit)
    ? unit.slice(0, -1)
    : unit;
}

/**
 * Formats a value. Percent values are percentages (34 means 34%), as in the
 * Chart and Region Map. Compact ("1.2K", "34%", "1h 25m") is for cells and the
 * legend; full ("1,240 orders", "34.2%", "1 hr 25 min") for tooltips and
 * assistive tech. null is "No data".
 */
export function formatValue(
  value: number | null | undefined,
  fmt: ValueFormat,
  style: "compact" | "full" = "full",
  locale: string = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "No data";
  }
  const sign: Intl.NumberFormatOptions = fmt.signed
    ? { signDisplay: "exceptZero" }
    : {};
  let text: string;
  if (fmt.format === "duration-min") {
    text = formatDuration(value, style, Boolean(fmt.signed));
  } else if (fmt.format === "percent") {
    text = new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: style === "compact" ? 0 : 1,
      ...sign,
    }).format(value / 100);
  } else {
    const compact: Intl.NumberFormatOptions =
      style === "compact"
        ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
        : { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 };
    text = "";
    if (fmt.format === "currency" && fmt.currency) {
      try {
        text = new Intl.NumberFormat(locale, {
          style: "currency",
          currency: fmt.currency,
          minimumFractionDigits: 0,
          ...compact,
          ...sign,
        }).format(value);
      } catch {
        // Invalid currency code: fall through to a plain number.
      }
    }
    if (!text) {
      text = new Intl.NumberFormat(locale, { ...compact, ...sign }).format(
        value,
      );
    }
  }
  // A real minus sign, like the duration format.
  if (value < 0) text = text.replace("-", "−");
  return style === "full" && fmt.unit
    ? `${text} ${unitFor(value, fmt.unit)}`
    : text;
}

// ---------------------------------------------------------------------------
// Scale

/** Strips floating-point noise such as 0.30000000000000004. */
const clean = (n: number) => Number(n.toPrecision(12));

/**
 * The smallest of 1, 2, 2.5, 5 × 10ⁿ that is ≥ raw. For whole-number data
 * (counts) the step is a whole number: at least 1, and 3 instead of 2.5.
 */
export function niceStep(raw: number, integer = false): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  if (integer && raw <= 1) return 1;
  const base = 10 ** Math.floor(Math.log10(raw));
  const f = raw / base;
  let nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  if (integer && base === 1 && nice === 2.5) nice = 3;
  return clean(nice * base);
}

const clampSteps = (steps: number | undefined) =>
  Math.min(7, Math.max(3, Math.round(steps ?? 5) || 5));

export type SequentialScale = {
  kind: "sequential";
  /** Lower bound of the first bucket. */
  lo: number;
  /** Width of each bucket. */
  step: number;
  /** Number of buckets (3–7). */
  count: number;
  /** count + 1 bounds, from lo to lo + step × count. */
  bounds: number[];
  /** The scale starts at 0, so exact zeros get their own "0" level. */
  zeroBased: boolean;
};

export type DivergingScale = {
  kind: "diverging";
  midpoint: number;
  step: number;
  count: number;
  /** count + 1 bounds, symmetric around the midpoint. */
  bounds: number[];
};

export type Scale = SequentialScale | DivergingScale;

export type ScaleOptions = {
  steps?: number;
  min?: number;
  max?: number;
  diverging?: { midpoint?: number };
};

/**
 * Equal-width buckets on nice bounds that cover every value (the Region Map's
 * rule). Starts at 0 when the data is non-negative and the smallest value is
 * near 0 relative to the largest; otherwise just below the minimum. `min` and
 * `max` override the data's range (values outside fall in the end buckets).
 */
export function quantize(
  values: number[],
  options: ScaleOptions = {},
): SequentialScale | null {
  const finite = values.filter((v) => Number.isFinite(v));
  const hasMin = Number.isFinite(options.min);
  const hasMax = Number.isFinite(options.max);
  if (finite.length === 0 && !(hasMin && hasMax)) return null;
  const count = clampSteps(options.steps);
  const min = hasMin ? (options.min as number) : Math.min(...finite);
  let max = hasMax ? (options.max as number) : Math.max(...finite);
  if (max < min) max = min;
  // Equal values sit in the top bucket, so they read as present, not faint.
  const zeroBased =
    min === 0 || (!hasMin && min >= 0 && (min <= max / 3 || min === max));
  const from = zeroBased ? 0 : min;
  const integer =
    finite.every(Number.isInteger) &&
    Number.isInteger(min) &&
    Number.isInteger(max);
  let step = niceStep(
    (max - from) / count || Math.abs(max) / count || 1,
    integer,
  );
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    lo = zeroBased ? 0 : clean(Math.floor(min / step) * step);
    if (lo + step * count >= max) break;
    step = niceStep(step * 1.01, integer);
  }
  const bounds = Array.from({ length: count + 1 }, (_, i) =>
    clean(lo + i * step),
  );
  return { kind: "sequential", lo, step, count, bounds, zeroBased };
}

/**
 * Buckets symmetric around a midpoint, on a nice step. With an odd count the
 * middle bucket straddles the midpoint (neutral); with an even count the
 * buckets split at the midpoint.
 */
export function quantizeDiverging(
  values: number[],
  options: ScaleOptions & { midpoint: number },
): DivergingScale | null {
  const m = options.midpoint;
  const finite = values.filter((v) => Number.isFinite(v));
  const extra = [options.min, options.max].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (finite.length === 0 && extra.length === 0) return null;
  const count = clampSteps(options.steps);
  const half = count / 2;
  const dev =
    Math.max(0, ...[...finite, ...extra].map((v) => Math.abs(v - m))) ||
    Math.abs(m) ||
    1;
  const step = niceStep(dev / half);
  const bounds = Array.from({ length: count + 1 }, (_, i) =>
    clean(m + (i - half) * step),
  );
  return { kind: "diverging", midpoint: m, step, count, bounds };
}

export function buildScale(
  values: number[],
  options: ScaleOptions = {},
): Scale | null {
  const mid = options.diverging?.midpoint;
  if (typeof mid === "number" && Number.isFinite(mid)) {
    return quantizeDiverging(values, { ...options, midpoint: mid });
  }
  return quantize(values, options);
}

export type Side = "low" | "mid" | "high";

export type Level =
  /** No data. */
  | { kind: "none" }
  /** Exactly 0 on a scale that starts at 0: the neutral base, no ink. */
  | { kind: "zero" }
  | {
      kind: "bucket";
      /** 0 … count − 1, low to high. */
      index: number;
      side: Side;
      /** Share of ink mixed into the base, 0–100. */
      strength: number;
    };

/**
 * Share of the strong color mixed into the neutral base, per sequential
 * bucket: one hue, light to strong, so it reads without color vision.
 */
export function bucketStrength(index: number, count: number): number {
  if (count <= 1) return 100;
  return Math.round(22 + (78 * index) / (count - 1));
}

/** Ink share for a diverging bucket `dist` steps from the middle. */
export function divergingStrength(dist: number, maxDist: number): number {
  if (dist <= 0) return 0;
  if (maxDist <= 1) return 70;
  return Math.round(30 + (70 * (dist - 1)) / (maxDist - 1));
}

/** Sequential bucket index (lower bound inclusive). */
function sequentialIndex(value: number, s: SequentialScale): number {
  const i = Math.floor((value - s.lo) / s.step + 1e-9);
  return Math.min(s.count - 1, Math.max(0, i));
}

/**
 * Where a value sits on the scale. Diverging buckets are measured by distance
 * from the midpoint, inner bound inclusive, so +d and −d always mirror.
 */
export function levelOf(value: number | null | undefined, s: Scale): Level {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { kind: "none" };
  }
  if (s.kind === "sequential") {
    if (s.zeroBased && value === 0) return { kind: "zero" };
    const index = sequentialIndex(value, s);
    return {
      kind: "bucket",
      index,
      side: "high",
      strength: bucketStrength(index, s.count),
    };
  }
  const odd = s.count % 2 === 1;
  const k = Math.floor(s.count / 2);
  const dev = value - s.midpoint;
  const a = Math.abs(dev);
  if (odd) {
    if (a <= s.step / 2 + 1e-9) {
      return { kind: "bucket", index: k, side: "mid", strength: 0 };
    }
    const dist = Math.min(k, Math.ceil((a - s.step / 2) / s.step - 1e-9));
    return {
      kind: "bucket",
      index: dev < 0 ? k - dist : k + dist,
      side: dev < 0 ? "low" : "high",
      strength: divergingStrength(dist, k),
    };
  }
  if (a === 0) return { kind: "bucket", index: -1, side: "mid", strength: 0 };
  const dist = Math.min(k, Math.max(1, Math.ceil(a / s.step - 1e-9)));
  return {
    kind: "bucket",
    index: dev < 0 ? k - dist : k - 1 + dist,
    side: dev < 0 ? "low" : "high",
    strength: divergingStrength(dist, k),
  };
}

/** The level of each bucket index, for the legend. */
export function bucketLevels(s: Scale): Extract<Level, { kind: "bucket" }>[] {
  return Array.from({ length: s.count }, (_, i) => {
    if (s.kind === "sequential") {
      return {
        kind: "bucket" as const,
        index: i,
        side: "high" as const,
        strength: bucketStrength(i, s.count),
      };
    }
    const k = Math.floor(s.count / 2);
    const odd = s.count % 2 === 1;
    if (odd && i === k) {
      return {
        kind: "bucket" as const,
        index: i,
        side: "mid" as const,
        strength: 0,
      };
    }
    const low = i < k;
    const dist = low ? k - i : odd ? i - k : i - k + 1;
    return {
      kind: "bucket" as const,
      index: i,
      side: low ? ("low" as const) : ("high" as const),
      strength: divergingStrength(dist, k),
    };
  });
}

/**
 * "0–250", "1,000–1,250", "$10K–$20K"; " to " when a bound is negative or
 * values are signed.
 * Bounds under 10,000 are written in full so close bounds don't round alike.
 */
export function bucketLabels(
  s: Scale,
  fmt: ValueFormat,
  locale: string = DEFAULT_LOCALE,
): string[] {
  const plain = { ...fmt, unit: undefined };
  const f = (n: number) =>
    formatValue(
      n,
      plain,
      Math.abs(n) < 10_000 && fmt.format !== "duration-min"
        ? "full"
        : "compact",
      locale,
    );
  return s.bounds.slice(0, -1).map((lo, i) => {
    const hi = s.bounds[i + 1];
    return lo < 0 || hi < 0 || fmt.signed
      ? `${f(lo)} to ${f(hi)}`
      : `${f(lo)}–${f(hi)}`;
  });
}

// ---------------------------------------------------------------------------
// Contrast: text tone per bucket

/** WCAG relative luminance of sRGB channels (0–1, gamma-encoded). */
function luminance([r, g, b]: number[]): number {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function hexChannels(hex: string): number[] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? m.slice(1).map((c) => Number.parseInt(c, 16) / 255) : [0, 0, 0];
}

/** sRGB channel of a neutral `oklch(L 0 0)` (linear gray = L³). */
function oklchGray(lightness: number): number {
  const lin = lightness ** 3;
  return lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055;
}

const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The tokens the cells draw with, mirrored from global.css: the ink for each
 * side (`--heatmap-high`, `--heatmap-low`), the neutral base (`--muted`) and
 * the two text colors. The chart scale is neutral oklch in both themes.
 * `--muted` is translucent, so `base` is its colour as painted on the card.
 */
export const HEATMAP_TOKENS = {
  light: {
    ink: { high: 0.269, low: 0.556 },
    base: "#dcdcdc",
    /** text-card */
    lightText: "#eaeaea",
    /** text-foreground */
    darkText: "#121212",
  },
  dark: {
    ink: { high: 0.87, low: 0.556 },
    base: "#272727",
    /** text-foreground */
    lightText: "#f2f2f2",
    /** text-background */
    darkText: "#0e0e0e",
  },
} as const;

/** Luminance of `color-mix(in srgb, ink strength%, base)`. */
export function mixedLuminance(
  theme: "light" | "dark",
  strength: number,
  side: Side = "high",
): number {
  const t = HEATMAP_TOKENS[theme];
  const ink = oklchGray(side === "low" ? t.ink.low : t.ink.high);
  const p = Math.min(100, Math.max(0, strength)) / 100;
  return luminance(hexChannels(t.base).map((b) => p * ink + (1 - p) * b));
}

/** Whichever text color reads better on a bucket's fill. */
export function textTone(
  theme: "light" | "dark",
  strength: number,
  side: Side = "high",
): "light" | "dark" {
  const t = HEATMAP_TOKENS[theme];
  const fill = mixedLuminance(theme, strength, side);
  return contrast(fill, luminance(hexChannels(t.lightText))) >=
    contrast(fill, luminance(hexChannels(t.darkText)))
    ? "light"
    : "dark";
}

// ---------------------------------------------------------------------------
// Dates and the calendar

const DAY_MS = 86_400_000;

/** "2026-03-02" → days since 1970-01-01 (UTC), or null when invalid. */
export function dayNumber(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d);
  const date = new Date(t);
  // Rejects rollovers such as 2026-02-31.
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return Math.round(t / DAY_MS);
}

export function dayKey(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export const weekdayOf = (n: number) => (((n + 4) % 7) + 7) % 7;

export type CalendarGrid = {
  /** Number of week columns. */
  weeks: number;
  /** Weekday per row (0 = Sunday), starting at weekStart. */
  weekdays: number[];
  /** [row][week]: the date key, or null outside the range. */
  cells: (string | null)[][];
  /** Month labels: the week column where each month starts. */
  months: { column: number; month: number; year: number }[];
};

/**
 * Weeks × weekdays for a date range, GitHub-style: 7 rows starting at
 * weekStart, one column per week. Months are labelled at the column holding
 * their 1st; column 0 is labelled with the range's first month when it holds
 * no 1st, and that label is dropped when the next one is under 3 columns away.
 */
export function buildCalendar(
  start: string,
  end: string,
  weekStart: 0 | 1 = 0,
): CalendarGrid | null {
  const s = dayNumber(start);
  const e = dayNumber(end);
  if (s === null || e === null || e < s) return null;
  const offset = (weekdayOf(s) - weekStart + 7) % 7;
  const gridStart = s - offset;
  const weeks = Math.floor((e - gridStart) / 7) + 1;
  const cells = Array.from({ length: 7 }, (_, r) =>
    Array.from({ length: weeks }, (_, c) => {
      const d = gridStart + c * 7 + r;
      return d < s || d > e ? null : dayKey(d);
    }),
  );
  const months: CalendarGrid["months"] = [];
  for (let c = 0; c < weeks; c++) {
    const inRange = cells.map((row) => row[c]).filter((d): d is string => !!d);
    const first =
      inRange.find((d) => d.endsWith("-01")) ??
      (c === 0 ? inRange[0] : undefined);
    if (!first) continue;
    months.push({
      column: c,
      month: Number(first.slice(5, 7)) - 1,
      year: Number(first.slice(0, 4)),
    });
  }
  if (months.length > 1 && months[1].column - months[0].column < 3) {
    months.shift();
  }
  return {
    weeks,
    weekdays: Array.from({ length: 7 }, (_, r) => (weekStart + r) % 7),
    cells,
    months,
  };
}

export type ActivityStats = {
  /** Days with a value above 0. */
  activeDays: number;
  /** Longest run of consecutive active days. */
  longest: number;
  longestStart?: string;
  longestEnd?: string;
};

/** Active days and the longest streak (consecutive days with a value > 0). */
export function activityStats(
  days: { date: string; value: number | null }[],
): ActivityStats {
  const active = [
    ...new Set(
      days
        .filter((d) => typeof d.value === "number" && d.value > 0)
        .map((d) => dayNumber(d.date))
        .filter((n): n is number => n !== null),
    ),
  ].sort((a, b) => a - b);
  let longest = 0;
  let longestStart: number | undefined;
  let runStart = 0;
  for (let i = 0; i < active.length; i++) {
    if (i === 0 || active[i] !== active[i - 1] + 1) runStart = active[i];
    const run = active[i] - runStart + 1;
    if (run > longest) {
      longest = run;
      longestStart = runStart;
    }
  }
  return {
    activeDays: active.length,
    longest,
    longestStart: longestStart === undefined ? undefined : dayKey(longestStart),
    longestEnd:
      longestStart === undefined
        ? undefined
        : dayKey(longestStart + longest - 1),
  };
}

/** Totals per month ("2026-03"), in date order. */
export function monthlyTotals(
  days: { date: string; value: number | null }[],
): { month: string; total: number; days: number; active: number }[] {
  const by = new Map<
    string,
    { month: string; total: number; days: number; active: number }
  >();
  for (const d of [...days].sort((a, b) =>
    a.date.localeCompare(b.date, DEFAULT_LOCALE),
  )) {
    const month = d.date.slice(0, 7);
    const entry = by.get(month) ?? { month, total: 0, days: 0, active: 0 };
    if (typeof d.value === "number" && Number.isFinite(d.value)) {
      entry.total = clean(entry.total + d.value);
      entry.days += 1;
      if (d.value > 0) entry.active += 1;
    }
    by.set(month, entry);
  }
  return [...by.values()];
}

// ---------------------------------------------------------------------------
// Matrix and cohort

/**
 * A cell's row or column: a 0-based index, or a label from the list (exact,
 * then case-insensitive). -1 when it isn't there.
 */
export function resolveIndex(
  key: number | string | undefined,
  labels: readonly string[],
): number {
  if (typeof key === "number") {
    return Number.isInteger(key) && key >= 0 && key < labels.length ? key : -1;
  }
  if (typeof key !== "string") return -1;
  const exact = labels.indexOf(key);
  if (exact >= 0) return exact;
  const norm = key.trim().toLowerCase();
  return labels.findIndex((l) => l.trim().toLowerCase() === norm);
}

/** Value per [row][column]: undefined where no cell was sent. First wins. */
export type ValueGrid = (number | null | undefined)[][];

export function buildValueGrid(
  rowCount: number,
  columnCount: number,
  cells: { row: number; column: number; value: number | null }[],
): ValueGrid {
  const grid: ValueGrid = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => undefined),
  );
  for (const c of cells) {
    if (c.row < 0 || c.row >= rowCount || c.column < 0) continue;
    if (c.column >= columnCount) continue;
    if (grid[c.row][c.column] !== undefined) continue;
    grid[c.row][c.column] =
      typeof c.value === "number" && Number.isFinite(c.value) ? c.value : null;
  }
  return grid;
}

/**
 * Periods observed so far for cohort row r (rows oldest first): the newest
 * cohort has 1, each older one a period more, up to the column count. Used to
 * draw the triangle's placeholders while values stream.
 */
export function cohortObserved(
  row: number,
  rowCount: number,
  columnCount: number,
): number {
  return Math.min(columnCount, Math.max(1, rowCount - row));
}

/**
 * The column a cohort summary should quote: the furthest period that at
 * least half the cohorts (and at least 2) have reached, skipping period 0
 * when there's anything else. Mean of the observed values.
 */
export function cohortFocusColumn(
  grid: ValueGrid,
): { column: number; average: number; count: number } | null {
  const rows = grid.length;
  if (rows === 0) return null;
  const columns = Math.max(0, ...grid.map((r) => r.length));
  const need = Math.max(Math.min(2, rows), Math.ceil(rows / 2));
  let fallback: { column: number; average: number; count: number } | null =
    null;
  for (let c = columns - 1; c >= 0; c--) {
    const vals = grid
      .map((r) => r[c])
      .filter((v): v is number => typeof v === "number");
    if (vals.length === 0) continue;
    const result = {
      column: c,
      average: clean(vals.reduce((a, b) => a + b, 0) / vals.length),
      count: vals.length,
    };
    if (vals.length >= need && c > 0) return result;
    if (!fallback || c === 0) fallback = result;
  }
  return fallback;
}

export type GridPoint = { row: number; column: number; value: number };

/** All cells tied for the highest (or lowest) value, in row-major order. */
export function findExtremes(
  grid: ValueGrid,
  kind: "max" | "min" = "max",
): GridPoint[] {
  let best: number | null = null;
  let out: GridPoint[] = [];
  grid.forEach((row, r) => {
    row.forEach((v, c) => {
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      const better = best === null || (kind === "max" ? v > best : v < best);
      if (better) {
        best = v;
        out = [{ row: r, column: c, value: v }];
      } else if (v === best) {
        out.push({ row: r, column: c, value: v });
      }
    });
  });
  return out;
}

/**
 * "Fri 7–8 PM · 1,240 orders", with ties: "(tied with Sat 7–8 PM)" or
 * "(tied with 2 others)".
 */
export function peakPhrase(names: string[], valueText: string): string {
  if (names.length === 0) return "";
  const tie =
    names.length === 2
      ? ` (tied with ${names[1]})`
      : names.length > 2
        ? ` (tied with ${names.length - 1} others)`
        : "";
  return `${names[0]} · ${valueText}${tie}`;
}

const plural = (n: number, one: string, many: string, locale: string) =>
  `${new Intl.NumberFormat(locale).format(n)} ${n === 1 ? one : many}`;

/** "312 days active · longest streak 21 days". */
export function calendarSummary(
  stats: ActivityStats,
  locale: string = DEFAULT_LOCALE,
): string {
  if (stats.activeDays === 0) return "No active days";
  return `${plural(stats.activeDays, "day", "days", locale)} active · longest streak ${plural(stats.longest, "day", "days", locale)}`;
}

// ---------------------------------------------------------------------------
// Labels

/**
 * An hour label as 0–23: "7 PM", "7pm", "7p", "19:00". Bare numbers only
 * count when the caller knows the columns are hours (see hourColumns).
 */
export function parseHour(label: string, allowBare = false): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p|a\.m\.|p\.m\.)?$/i.exec(
    label.trim(),
  );
  if (!m) return null;
  const h = Number(m[1]);
  if (m[2] !== undefined && m[2] !== "00") return null;
  const suffix = m[3]?.toLowerCase();
  if (suffix) {
    if (h < 1 || h > 12) return null;
    return (h % 12) + (suffix.startsWith("p") ? 12 : 0);
  }
  if (m[2] === undefined && !allowBare) return null;
  return h <= 23 ? h : null;
}

/**
 * True when the columns are hours: every label reads as an hour ("7 PM",
 * "19:00"), or they're exactly the 24 bare numbers 0–23 in order.
 */
export function hourColumns(columns: readonly string[]): boolean {
  if (columns.length < 2) return false;
  if (columns.every((c) => parseHour(c) !== null)) return true;
  return (
    columns.length === 24 && columns.every((c, i) => parseHour(c, true) === i)
  );
}

export function hourOf(label: string): number | null {
  return parseHour(label, true);
}

/** "12a", "9a", "12p", "7p". */
export function compactHour(h: number): string {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

/** "12 AM", "7 PM". */
export function fullHour(h: number): string {
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n} ${h < 12 ? "AM" : "PM"}`;
}

/** "7–8 PM", "11 AM–12 PM", "11 PM–12 AM". */
export function hourRange(h: number): string {
  const next = (h + 1) % 24;
  const n = (x: number) => (x % 12 === 0 ? 12 : x % 12);
  const ampm = (x: number) => (x < 12 ? "AM" : "PM");
  return ampm(h) === ampm(next)
    ? `${n(h)}–${n(next)} ${ampm(h)}`
    : `${fullHour(h)}–${fullHour(next)}`;
}

const WEEKDAYS: Record<string, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

/** "Fri" → "Friday", for assistive tech. Anything else is unchanged. */
export function expandWeekday(label: string): string {
  return WEEKDAYS[label.trim().toLowerCase().replace(/\.$/, "")] ?? label;
}
