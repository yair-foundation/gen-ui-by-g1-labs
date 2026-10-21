/**
 * KPI Card: pure helpers (no React), so they can be unit-tested in Node.
 *
 * - squarify / insetRects: the squarified treemap layout.
 * - mergeSmallTiles: folds tiles too small to read into "Other".
 * - tileDetail: how much text a tile of a given size can hold.
 * - segmentWidths / segmentFractions: the stacked bar, with gaps.
 * - niceTicks / barScale: the bar chart's y axis.
 * - formatValue / rollerParts: locale-aware numbers, and their split for
 *   the sliding-number animation.
 * - formatDelta / describeDelta / deltaDirection: change badges.
 * - contrastRatio / pickTextTone: readable text on a fill.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

export type Rect = {
  /** Index into the input values. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const EPS = 1e-9;

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(row: number[], side: number) {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const a of row) {
    sum += a;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk): rectangles whose AREA is
 * proportional to each value, filling the width × height box exactly, with
 * aspect ratios kept close to 1. Largest first. Values ≤ 0 (or not finite)
 * are skipped. Deterministic.
 */
export function squarify(
  values: number[],
  width: number,
  height: number,
): Rect[] {
  const items = values
    .map((value, index) => ({ value, index }))
    .filter((v) => Number.isFinite(v.value) && v.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index);
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const total = items.reduce((s, v) => s + v.value, 0);
  const scale = (width * height) / total;
  const areas = items.map((v) => v.value * scale);

  const out: Rect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;

  const layoutRow = (start: number, end: number, last: boolean) => {
    const row = areas.slice(start, end);
    const sum = row.reduce((s, a) => s + a, 0);
    if (w >= h) {
      // A column on the left, items stacked top to bottom.
      const colW = last ? w : sum / h;
      let cy = y;
      row.forEach((a, i) => {
        const ih = i === row.length - 1 ? y + h - cy : a / colW;
        out.push({ index: items[start + i].index, x, y: cy, w: colW, h: ih });
        cy += ih;
      });
      x += colW;
      w -= colW;
    } else {
      // A row along the top, items left to right.
      const rowH = last ? h : sum / w;
      let cx = x;
      row.forEach((a, i) => {
        const iw = i === row.length - 1 ? x + w - cx : a / rowH;
        out.push({ index: items[start + i].index, x: cx, y, w: iw, h: rowH });
        cx += iw;
      });
      y += rowH;
      h -= rowH;
    }
  };

  let start = 0;
  let end = 0;
  while (end < areas.length) {
    const side = Math.min(w, h);
    const row = areas.slice(start, end);
    const next = areas.slice(start, end + 1);
    if (row.length === 0 || worst(next, side) <= worst(row, side) + EPS) {
      end++;
    } else {
      layoutRow(start, end, false);
      start = end;
    }
  }
  layoutRow(start, end, true);
  return out;
}

/**
 * Shrinks each rectangle by `gap / 2` on every side that faces another
 * rectangle, so tiles are `gap` apart while the outer edges stay flush with
 * the box.
 */
export function insetRects(
  rects: Rect[],
  gap: number,
  width: number,
  height: number,
): Rect[] {
  const half = gap / 2;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return rects.map((r) => {
    const left = near(r.x, 0) ? 0 : half;
    const top = near(r.y, 0) ? 0 : half;
    const right = near(r.x + r.w, width) ? 0 : half;
    const bottom = near(r.y + r.h, height) ? 0 : half;
    return {
      index: r.index,
      x: r.x + left,
      y: r.y + top,
      w: Math.max(0, r.w - left - right),
      h: Math.max(0, r.h - top - bottom),
    };
  });
}

/** The squarified layout with gaps between tiles. */
export function layoutTiles(
  values: number[],
  width: number,
  height: number,
  gap = 4,
): Rect[] {
  return insetRects(squarify(values, width, height), gap, width, height);
}

export type TileLike = {
  label: string;
  share: number;
  delta?: number;
};

export type MergedTile<T extends TileLike = TileLike> = T & {
  /** The remainder bucket. */
  other?: boolean;
  /** Labels folded into this tile. */
  merged?: string[];
};

/**
 * Folds the smallest tiles into one "Other" tile until every tile is at least
 * `min` px on both sides at this box size (or one tile is left). An input tile
 * already named like `otherLabel` becomes the bucket. Merged tiles lose their
 * delta, since percentages can't be summed.
 */
export function mergeSmallTiles<T extends TileLike>(
  tiles: T[],
  width: number,
  height: number,
  {
    min = 56,
    gap = 4,
    otherLabel = "Other",
  }: { min?: number; gap?: number; otherLabel?: string } = {},
): MergedTile<T>[] {
  const isOtherLabel = (label: string) =>
    label.trim().toLocaleLowerCase() === otherLabel.toLocaleLowerCase();
  let current: MergedTile<T>[] = tiles
    .filter((t) => Number.isFinite(t.share) && t.share > 0)
    .map((t) => (isOtherLabel(t.label) ? { ...t, other: true } : { ...t }));
  if (width <= 0 || height <= 0) return current;

  for (let guard = 0; guard < tiles.length + 1; guard++) {
    if (current.length <= 1) return current;
    const rects = layoutTiles(
      current.map((t) => t.share),
      width,
      height,
      gap,
    );
    const tooSmall = rects.some((r) => r.w < min - EPS || r.h < min - EPS);
    if (!tooSmall) return current;

    // The smallest regular tiles, smallest last.
    const regular = current
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.other)
      .sort((a, b) => b.t.share - a.t.share || a.i - b.i);
    const otherIndex = current.findIndex((t) => t.other);
    if (regular.length === 0) return current;

    const fold = (bucket: MergedTile<T>, add: MergedTile<T>) =>
      ({
        ...bucket,
        share: bucket.share + add.share,
        delta: undefined,
        merged: [...(bucket.merged ?? []), ...(add.merged ?? [add.label])],
      }) as MergedTile<T>;

    if (otherIndex >= 0) {
      const smallest = regular[regular.length - 1];
      const bucket = fold(current[otherIndex], smallest.t);
      current = current
        .map((t, i) => (i === otherIndex ? bucket : t))
        .filter((_, i) => i !== smallest.i);
    } else {
      if (regular.length < 2) return current;
      const a = regular[regular.length - 1];
      const b = regular[regular.length - 2];
      const bucket = fold(
        {
          label: otherLabel,
          share: 0,
          other: true,
          merged: [],
        } as unknown as MergedTile<T>,
        b.t,
      );
      const full = fold(bucket, a.t);
      current = [...current.filter((_, i) => i !== a.i && i !== b.i), full];
    }
  }
  return current;
}

export type TileDetail = "full" | "medium" | "small";

/** How much a tile can hold: label, value and delta; or less. */
export function tileDetail(w: number, h: number): TileDetail {
  if (w >= 128 && h >= 112) return "full";
  if (w >= 88 && h >= 72) return "medium";
  return "small";
}

// ---------------------------------------------------------------------------
// Stacked segments
// ---------------------------------------------------------------------------

/** Each positive value's share of the total (0 for the rest). */
export function segmentFractions(values: number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((s, v) => s + v, 0);
  return clean.map((v) => (total > 0 ? v / total : 0));
}

/**
 * Pixel widths for a stacked bar `totalWidth` wide with `gap` px between
 * visible segments. Widths are proportional to value, so the gaps come out
 * of the total, not out of the small segments. Zero segments get no width and
 * no gap.
 */
export function segmentWidths(
  values: number[],
  totalWidth: number,
  gap = 3,
): number[] {
  const fractions = segmentFractions(values);
  const visible = fractions.filter((f) => f > 0).length;
  const room = Math.max(0, totalWidth - gap * Math.max(0, visible - 1));
  return fractions.map((f) => f * room);
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

/** 1, 2, 2.5, 5 or 10 × a power of ten, the smallest at or above `raw`. */
function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * Round y-axis ticks from 0 up to at least `max`, about `count` steps.
 * Non-positive or invalid maxima give [0, 1].
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const step = niceStep(max / Math.max(1, count));
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; i <= Math.round(top / step); i++) {
    // Round away float noise (0.1 + 0.2).
    ticks.push(Number((i * step).toPrecision(12)));
  }
  return ticks;
}

/** A bar's height as a fraction of the axis top, clamped to 0–1. */
export function barScale(value: number, top: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(top) || top <= 0) return 0;
  return Math.min(1, Math.max(0, value / top));
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export type ValueFormat = {
  format?: "currency" | "number" | "percent";
  currency?: string;
  locale?: string;
  /** Short axis labels: "$16K". */
  compact?: boolean;
};

function numberOptions(opts: ValueFormat): Intl.NumberFormatOptions {
  const compact: Intl.NumberFormatOptions = opts.compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : {};
  if (opts.format === "currency" && opts.currency) {
    return { style: "currency", currency: opts.currency, ...compact };
  }
  if (opts.format === "percent") {
    return {
      style: "percent",
      maximumFractionDigits: opts.compact ? 0 : 1,
    };
  }
  return opts.compact ? compact : { maximumFractionDigits: 2 };
}

function formatter(opts: ValueFormat): Intl.NumberFormat {
  const { locale = DEFAULT_LOCALE } = opts;
  try {
    return new Intl.NumberFormat(locale, numberOptions(opts));
  } catch {
    // Invalid currency code or locale: plain numbers.
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    } catch {
      return new Intl.NumberFormat(DEFAULT_LOCALE, {
        maximumFractionDigits: 2,
      });
    }
  }
}

/** Percent values are in percent units: 12.5 → "12.5%". */
function scaled(value: number, opts: ValueFormat) {
  return opts.format === "percent" ? value / 100 : value;
}

/**
 * Locale-aware value text. Currency keeps its minor units ("$16,000.00"),
 * percent values are in percent units (56 → "56%").
 */
export function formatValue(value: number, opts: ValueFormat = {}): string {
  if (!Number.isFinite(value)) return "–";
  return formatter(opts).format(scaled(value, opts));
}

export type RollerParts = {
  prefix: string;
  suffix: string;
  /** The absolute value, rounded to `decimals`. */
  number: number;
  decimals: number;
  decimalSeparator: string;
  thousandSeparator?: string;
};

/**
 * Splits a formatted value into text around a plain digit run, for the
 * sliding-number animation (which groups by threes). Returns null whenever
 * that wouldn't reproduce Intl's text exactly (negative values, compact
 * notation, other grouping rules), and the caller shows static text.
 */
export function rollerParts(
  value: number,
  opts: ValueFormat = {},
): RollerParts | null {
  if (!Number.isFinite(value) || value < 0 || opts.compact) return null;
  const fmt = formatter(opts);
  const parts = fmt.formatToParts(scaled(value, opts));
  const numeric = new Set(["integer", "group", "decimal", "fraction"]);
  const first = parts.findIndex((p) => numeric.has(p.type));
  let last = -1;
  parts.forEach((p, i) => {
    if (numeric.has(p.type)) last = i;
  });
  if (first < 0) return null;
  const middle = parts.slice(first, last + 1);
  if (middle.some((p) => !numeric.has(p.type))) return null;

  const fraction = middle.find((p) => p.type === "fraction")?.value ?? "";

  // Grouping must be plain threes, used from 4 digits up.
  const groupSym = fmt
    .formatToParts(scaled(1234567, opts))
    .find((p) => p.type === "group")?.value;
  const has4 = fmt
    .formatToParts(scaled(1234, opts))
    .some((p) => p.type === "group");
  if (groupSym !== undefined && !has4) return null;
  const ints = middle.filter((p) => p.type === "integer").map((p) => p.value);
  if (ints.slice(1).some((g) => g.length !== 3)) return null;
  if (groupSym !== undefined && ints[0].length > 3) return null;
  // Only Western digits roll.
  if (!/^[0-9]*$/.test(ints.join("") + fraction)) return null;

  const decimalSeparator =
    fmt.formatToParts(scaled(1.5, opts)).find((p) => p.type === "decimal")
      ?.value ?? ".";
  const number = Number(`${ints.join("")}${fraction ? `.${fraction}` : ""}`);

  return {
    prefix: parts
      .slice(0, first)
      .map((p) => p.value)
      .join(""),
    suffix: parts
      .slice(last + 1)
      .map((p) => p.value)
      .join(""),
    number,
    decimals: fraction.length,
    decimalSeparator,
    thousandSeparator: groupSym,
  };
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

export type DeltaDirection = "up" | "down" | "flat";

export function deltaDirection(delta: number): DeltaDirection {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) return "flat";
  return delta > 0 ? "up" : "down";
}

/** "+2.6%", "−1.2%" (a real minus sign) or "0%". Deltas are in percent units. */
export function formatDelta(
  delta: number,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(delta)) return "–";
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
      signDisplay: "exceptZero",
    }).format(delta / 100);
  } catch {
    text = `${delta > 0 ? "+" : ""}${delta}%`;
  }
  return text.replace(/-/g, "−");
}

/** The spoken form: "Up 2.6% vs last week". */
export function describeDelta(
  delta: number,
  locale: string = DEFAULT_LOCALE,
  label?: string,
): string {
  const dir = deltaDirection(delta);
  const amount = formatDelta(Math.abs(delta), locale).replace(/^\+/, "");
  const head =
    dir === "flat" ? "No change" : `${dir === "up" ? "Up" : "Down"} ${amount}`;
  return label ? `${head} ${label}` : head;
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/** WCAG relative luminance of a "#rrggbb" color. */
export function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((c) => {
    const v = Number.parseInt(c, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relative luminance of a neutral `oklch(L 0 0)` (linear gray = L³). */
export function oklchGrayLuminance(lightness: number): number {
  return lightness ** 3;
}

export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever text color reads better on the fill. */
export function pickTextTone(
  fill: number,
  lightText: number,
  darkText: number,
): "light" | "dark" {
  return contrastRatio(fill, lightText) >= contrastRatio(fill, darkText)
    ? "light"
    : "dark";
}

/**
 * Luminance of the theme tokens the treemap draws with, mirrored from
 * global.css (the chart scale is neutral oklch in both themes). `--muted` is
 * translucent, so `muted` is its colour as painted on the card.
 */
const CHART_L = [0.87, 0.556, 0.439, 0.371, 0.269];
export const THEME_LUMINANCE = {
  light: {
    chart: CHART_L.map(oklchGrayLuminance),
    /** --muted (black at 6%) painted on the white card */
    muted: hexLuminance("#f0f0f0"),
    /** text-card (#ffffff) */
    lightText: hexLuminance("#ffffff"),
    /** text-foreground (#3d3d3d) */
    darkText: hexLuminance("#3d3d3d"),
  },
  dark: {
    chart: CHART_L.map(oklchGrayLuminance),
    /** --muted (white at 6%) painted on the #2a2a2a card */
    muted: hexLuminance("#373737"),
    /** text-foreground (#d8d8d8) */
    lightText: hexLuminance("#d8d8d8"),
    /** text-background (#1a1a1a) */
    darkText: hexLuminance("#1a1a1a"),
  },
} as const;

export type FillToken =
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "muted";

/**
 * Treemap fills by rank, per theme. Same scale as the other visuals (darkest
 * first on light cards, lightest first on dark), minus the steps where no
 * text color reaches 4.5:1 (mid gray on dark cards). The rest are muted.
 */
export const TREEMAP_FILLS: { light: FillToken; dark: FillToken }[] = [
  { light: "chart-5", dark: "chart-1" },
  { light: "chart-3", dark: "chart-3" },
  { light: "chart-2", dark: "chart-4" },
  { light: "chart-1", dark: "muted" },
];
export const TREEMAP_OTHER_FILL: { light: FillToken; dark: FillToken } = {
  light: "muted",
  dark: "muted",
};

export function tokenLuminance(
  theme: "light" | "dark",
  token: FillToken,
): number {
  const t = THEME_LUMINANCE[theme];
  if (token === "muted") return t.muted;
  return t.chart[Number(token.slice(-1)) - 1];
}

/** The text tone for a fill token in a theme, by contrast. */
export function textToneFor(
  theme: "light" | "dark",
  token: FillToken,
): "light" | "dark" {
  const t = THEME_LUMINANCE[theme];
  return pickTextTone(tokenLuminance(theme, token), t.lightText, t.darkText);
}
