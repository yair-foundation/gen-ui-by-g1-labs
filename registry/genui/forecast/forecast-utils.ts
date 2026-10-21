/**
 * Forecast: pure helpers. No React, no DOM, so they can be unit-tested and
 * reused on the server.
 *
 * - Cleaning streamed points (valid dates and numbers, sorted, deduplicated).
 * - Horizon summary (median and range at the last forecast point) and the
 *   change against the last actual.
 * - Threshold and target crossings, by linear interpolation between points,
 *   for the median and for the 80% band edges (an early/late date range).
 * - Chart rows for Recharts: band edges as [low, high] tuples, which Recharts
 *   draws as range areas (this survives negative values, unlike stacking).
 * - Period and value formatting per granularity and metric format.
 * - A plain-language summary for screen readers.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type Granularity = "day" | "week" | "month" | "quarter" | "year";
export type Direction = "below" | "above";
export type MetricLike = {
  label?: string;
  format?: "currency" | "number" | "percent";
  currency?: string;
  unit?: string;
};

export type HistoryPoint = { t: string; value: number };
export type ForecastPoint = {
  t: string;
  p50: number;
  p10?: number;
  p25?: number;
  p75?: number;
  p90?: number;
};

/** A point with its parsed time (epoch ms) as x. */
export type Actual = HistoryPoint & { x: number };
export type Projected = ForecastPoint & { x: number };

const QUANTILES = ["p10", "p25", "p75", "p90"] as const;

export const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Parses ISO dates; date-only strings are read as local dates, not UTC. */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number);
    const date = new Date(y, m - 1, d);
    // Rejects rollovers such as 2026-02-31.
    return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toTime(value: unknown): number | null {
  return parseDate(value)?.getTime() ?? null;
}

/** Sorted by time; a repeated time keeps its last value. */
function byTime<T extends { x: number }>(points: T[]): T[] {
  const map = new Map<number, T>();
  for (const p of points) map.set(p.x, p);
  return [...map.values()].sort((a, b) => a.x - b.x);
}

/** Valid actuals only (ISO date and finite value), oldest first. */
export function cleanHistory(
  points: Partial<HistoryPoint>[] | undefined,
): Actual[] {
  const out: Actual[] = [];
  for (const p of points ?? []) {
    const x = toTime(p?.t);
    if (x === null || !isNum(p?.value)) continue;
    out.push({ t: p.t as string, value: p.value, x });
  }
  return byTime(out);
}

/**
 * Valid forecast points, oldest first, keeping only finite quantiles. Points
 * at or before `after` (the last actual) are dropped so the forecast starts
 * where the actuals end.
 */
export function cleanForecast(
  points: Partial<ForecastPoint>[] | undefined,
  after?: number,
): Projected[] {
  const out: Projected[] = [];
  for (const p of points ?? []) {
    const x = toTime(p?.t);
    if (x === null || !isNum(p?.p50)) continue;
    if (after !== undefined && x <= after) continue;
    const point: Projected = { t: p.t as string, p50: p.p50, x };
    for (const q of QUANTILES) {
      const v = p[q];
      if (isNum(v)) point[q] = v;
    }
    out.push(point);
  }
  return byTime(out);
}

/** A band's edges, ordered low to high; null unless both are present. */
export function band(
  p: Partial<ForecastPoint>,
  level: 80 | 50,
): [number, number] | null {
  const lo = level === 80 ? p.p10 : p.p25;
  const hi = level === 80 ? p.p90 : p.p75;
  if (!isNum(lo) || !isNum(hi)) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

export type Horizon = {
  x: number;
  t: string;
  p50: number;
  /** The widest range available at the horizon: 80%, else 50%. */
  range: [number, number] | null;
  level: 80 | 50 | null;
};

/** Median and range at the last forecast point. */
export function horizonSummary(forecast: Projected[]): Horizon | null {
  const last = forecast[forecast.length - 1];
  if (!last) return null;
  const outer = band(last, 80);
  const inner = band(last, 50);
  return {
    x: last.x,
    t: last.t,
    p50: last.p50,
    range: outer ?? inner,
    level: outer ? 80 : inner ? 50 : null,
  };
}

export type Change = {
  from: number;
  to: number;
  diff: number;
  /**
   * Null when a percentage would be meaningless: the last actual is 0, or the
   * median ends on the other side of zero (cash going negative).
   */
  percent: number | null;
  fromT: string;
};

/** Median at the horizon against the last actual. */
export function changeVsLast(
  history: Actual[],
  forecast: Projected[],
): Change | null {
  const last = history[history.length - 1];
  const end = forecast[forecast.length - 1];
  if (!last || !end) return null;
  const diff = end.p50 - last.value;
  return {
    from: last.value,
    to: end.p50,
    diff,
    percent:
      last.value === 0 || Math.sign(end.p50) * Math.sign(last.value) < 0
        ? null
        : (diff / Math.abs(last.value)) * 100,
    fromT: last.t,
  };
}

export type XY = { x: number; v: number };
export type Crossing = {
  x: number;
  /** The first point already met the condition: nothing was crossed. */
  atStart: boolean;
};

/**
 * When a series first goes below (or above) a value, interpolating linearly
 * between the two points around the crossing. Lines are drawn linearly too,
 * so the marker sits on the line.
 */
export function findCrossing(
  points: XY[],
  value: number,
  direction: Direction,
): Crossing | null {
  const meets = (v: number) =>
    direction === "below" ? v <= value : v >= value;
  if (points.length === 0) return null;
  if (meets(points[0].v)) return { x: points[0].x, atStart: true };
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (!meets(b.v)) continue;
    const a = points[i - 1];
    // a doesn't meet the condition and b does, so a.v !== b.v.
    const f = (value - a.v) / (b.v - a.v);
    return { x: a.x + f * (b.x - a.x), atStart: false };
  }
  return null;
}

export type CrossingRange = {
  median: Crossing | null;
  /** The band edge that crosses first (p10 going down, p90 going up). */
  early: Crossing | null;
  /** The band edge that crosses last. */
  late: Crossing | null;
  hasBands: boolean;
};

/**
 * Crossings for the median and the 80% band edges. Each series starts at the
 * last actual, so a crossing between the last actual and the first forecast
 * point is found too.
 */
export function crossingRange(
  anchor: Actual | undefined,
  forecast: Projected[],
  value: number,
  direction: Direction,
): CrossingRange {
  const series = (key: "p50" | "p10" | "p90"): XY[] => [
    ...(anchor ? [{ x: anchor.x, v: anchor.value }] : []),
    ...forecast.flatMap((p) => {
      const v = p[key];
      return isNum(v) ? [{ x: p.x, v }] : [];
    }),
  ];
  const hasBands = forecast.some((p) => band(p, 80) !== null);
  const [earlyKey, lateKey] =
    direction === "below"
      ? (["p10", "p90"] as const)
      : (["p90", "p10"] as const);
  return {
    median: findCrossing(series("p50"), value, direction),
    early: hasBands ? findCrossing(series(earlyKey), value, direction) : null,
    late: hasBands ? findCrossing(series(lateKey), value, direction) : null,
    hasBands,
  };
}

/** A goal is reached going up when it's above the last actual, else going down. */
export function targetDirection(target: number, last?: number): Direction {
  return last === undefined || last <= target ? "above" : "below";
}

export type Row = {
  x: number;
  t: string;
  kind: "history" | "anchor" | "forecast";
  actual: number | null;
  p50: number | null;
  /** p10–p90 */
  outer: [number, number] | null;
  /** p25–p75 */
  inner: [number, number] | null;
  /** One value per scenario, by position. */
  scenarios: (number | null)[];
};

/**
 * One row per period for the chart. The last actual (the anchor) also carries
 * the median, zero-width bands and every scenario, so the forecast lines and
 * bands fan out from it instead of starting in mid-air.
 */
export function buildRows(
  history: Actual[],
  forecast: Projected[],
  scenarios: Actual[][] = [],
): Row[] {
  const anchor = history[history.length - 1];
  const hasOuter = forecast.some((p) => band(p, 80) !== null);
  const hasInner = forecast.some((p) => band(p, 50) !== null);
  const empty = () => scenarios.map(() => null as number | null);
  const map = new Map<number, Row>();

  for (const h of history) {
    const isAnchor = h === anchor;
    map.set(h.x, {
      x: h.x,
      t: h.t,
      kind: isAnchor ? "anchor" : "history",
      actual: h.value,
      p50: isAnchor ? h.value : null,
      outer: isAnchor && hasOuter ? [h.value, h.value] : null,
      inner: isAnchor && hasInner ? [h.value, h.value] : null,
      scenarios: isAnchor ? scenarios.map(() => h.value) : empty(),
    });
  }
  for (const p of forecast) {
    if (anchor && p.x <= anchor.x) continue;
    map.set(p.x, {
      x: p.x,
      t: p.t,
      kind: "forecast",
      actual: null,
      p50: p.p50,
      outer: band(p, 80),
      inner: band(p, 50),
      scenarios: empty(),
    });
  }
  scenarios.forEach((points, i) => {
    for (const p of points) {
      if (anchor && p.x <= anchor.x) continue;
      let row = map.get(p.x);
      if (!row) {
        row = {
          x: p.x,
          t: p.t,
          kind: "forecast",
          actual: null,
          p50: null,
          outer: null,
          inner: null,
          scenarios: empty(),
        };
        map.set(p.x, row);
      }
      row.scenarios[i] = p.value;
    }
  });
  return [...map.values()].sort((a, b) => a.x - b.x);
}

/**
 * Y domain over everything that can be drawn (actuals, bands, scenarios) plus
 * reference values, so toggling scenarios never rescales the chart.
 */
export function yDomain(
  rows: Row[],
  extras: number[] = [],
  pad = 0.08,
): [number, number] | null {
  const values: number[] = [...extras.filter(isNum)];
  for (const r of rows) {
    if (isNum(r.actual)) values.push(r.actual);
    if (isNum(r.p50)) values.push(r.p50);
    if (r.outer) values.push(...r.outer);
    if (r.inner) values.push(...r.inner);
    for (const s of r.scenarios) if (isNum(s)) values.push(s);
  }
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.1 || 1;
  return [min - span * pad, max + span * pad];
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

function toDate(t: string | number): Date | null {
  if (typeof t === "number") return Number.isFinite(t) ? new Date(t) : null;
  return parseDate(t);
}

const shortYear = (d: Date) => `’${String(d.getFullYear()).slice(-2)}`;

/**
 * A period label. "tick" is for the axis ("Mar ’27", "Q1 ’27"); "long" is for
 * text and tooltips ("Mar 2027", "Q1 2027", "week of Dec 21, 2026").
 */
export function formatPeriod(
  t: string | number,
  granularity: Granularity,
  style: "tick" | "long",
  locale: string = DEFAULT_LOCALE,
): string {
  const date = toDate(t);
  if (!date) return String(t);
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, o).format(date);
  switch (granularity) {
    case "day":
      return style === "tick"
        ? fmt({ month: "short", day: "numeric" })
        : fmt({ month: "short", day: "numeric", year: "numeric" });
    case "week":
      return style === "tick"
        ? fmt({ month: "short", day: "numeric" })
        : `week of ${fmt({ month: "short", day: "numeric", year: "numeric" })}`;
    case "month":
      return style === "tick"
        ? `${fmt({ month: "short" })} ${shortYear(date)}`
        : fmt({ month: "short", year: "numeric" });
    case "quarter": {
      const q = Math.floor(date.getMonth() / 3) + 1;
      return style === "tick"
        ? `Q${q} ${shortYear(date)}`
        : `Q${q} ${date.getFullYear()}`;
    }
    case "year":
      return String(date.getFullYear());
  }
}

/** The period with its preposition: "in Mar 2027", "on Dec 24, 2026". */
export function periodPhrase(
  t: string | number,
  granularity: Granularity,
  locale: string = DEFAULT_LOCALE,
): string {
  const long = formatPeriod(t, granularity, "long", locale);
  if (granularity === "day") return `on ${long}`;
  if (granularity === "week") return `in the ${long}`;
  return `in ${long}`;
}

/**
 * An interpolated crossing date, at the precision the data supports. Weekly
 * data gets a day ("Dec 17, 2026"); "week of" would suggest a period start.
 */
export function crossingDate(
  x: number,
  granularity: Granularity,
  locale: string = DEFAULT_LOCALE,
): string {
  return formatPeriod(
    x,
    granularity === "week" ? "day" : granularity,
    "long",
    locale,
  );
}

/**
 * A value in the metric's format. "axis" is compact without the unit;
 * "compact" shortens large numbers ("$1.18M") and adds the unit; "full" is
 * exact to a sensible precision, with the unit.
 */
export function formatValue(
  value: number | null | undefined,
  metric: MetricLike | undefined,
  style: "axis" | "compact" | "full",
  locale: string = DEFAULT_LOCALE,
): string {
  if (!isNum(value)) return "—";
  const abs = Math.abs(value);
  const format = metric?.format ?? "number";
  if (format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: style === "axis" ? 0 : 1,
    }).format(value / 100);
  }
  const digits: Intl.NumberFormatOptions =
    style === "axis"
      ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : style === "compact" && abs >= 10_000
        ? { notation: "compact", maximumSignificantDigits: 3 }
        : {
            minimumFractionDigits: 0,
            maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 1 : 2,
          };
  let text: string | null = null;
  if (format === "currency" && metric?.currency) {
    try {
      text = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: metric.currency,
        ...digits,
      }).format(value);
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  text ??= new Intl.NumberFormat(locale, digits).format(value);
  return style !== "axis" && metric?.unit ? `${text} ${metric.unit}` : text;
}

/** "+12%", "-3.4%"; percent metrics change in points ("+1.2 pts"). */
export function formatChange(
  change: Change,
  metric: MetricLike | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  const signed = (n: number, max: number) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: max,
      signDisplay: "exceptZero",
    }).format(Math.abs(n) < 1e-9 ? 0 : n);
  if (metric?.format === "percent") return `${signed(change.diff, 1)} pts`;
  if (change.percent !== null) {
    return `${signed(change.percent, Math.abs(change.percent) < 10 ? 1 : 0)}%`;
  }
  const sign = change.diff > 0 ? "+" : "";
  return `${sign}${formatValue(change.diff, metric, "compact", locale)}`;
}

/** The range in words: "likely between $1.05M and $1.31M". */
export function rangeText(
  horizon: Horizon,
  metric: MetricLike | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!horizon.range) return null;
  const [lo, hi] = horizon.range;
  const span = formatRange(lo, hi, metric, "compact", " and ", locale);
  return horizon.level === 80
    ? `likely between ${span}`
    : `the middle 50% between ${span}`;
}

/** Two values with the unit once: "1,356 and 2,289 tickets". */
export function formatRange(
  lo: number,
  hi: number,
  metric: MetricLike | undefined,
  style: "compact" | "full",
  separator: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const bare = metric ? { ...metric, unit: undefined } : metric;
  return `${formatValue(lo, bare, style, locale)}${separator}${formatValue(hi, metric, style, locale)}`;
}

export type CrossingCopy = {
  /** Where to put the marker, when the median crosses within the horizon. */
  markerX: number | null;
  /** Marker text: "Runway ends ~Aug 2027". */
  marker: string | null;
  /** One or two sentences, including the early/late range from the bands. */
  detail: string;
};

/**
 * Text for a threshold ("crosses") or a target ("reaches"). The horizon end
 * bounds every "not by" statement.
 */
export function crossingCopy(options: {
  kind: "threshold" | "target";
  label: string;
  value: number;
  direction: Direction;
  range: CrossingRange;
  metric: MetricLike | undefined;
  granularity: Granularity;
  horizonX: number;
  by?: string;
  locale?: string;
}): CrossingCopy {
  const {
    kind,
    label,
    direction,
    range,
    granularity: g,
    locale = DEFAULT_LOCALE,
  } = options;
  const valueText = formatValue(
    options.value,
    options.metric,
    "compact",
    locale,
  );
  const date = (c: Crossing) => crossingDate(c.x, g, locale);
  const horizon = formatPeriod(options.horizonX, g, "long", locale);
  const byX = toTime(options.by);
  const byText =
    byX === null
      ? null
      : formatPeriod(byX, g === "week" ? "day" : g, "long", locale);
  const verb = kind === "threshold" ? "crosses" : "reaches";
  const firstEdge =
    direction === "below"
      ? "low end of the 80% range"
      : "high end of the 80% range";

  const bands = (): string => {
    const { early, late, hasBands } = range;
    if (!hasBands || !early) return "";
    if (late && !late.atStart) {
      const a = date(early);
      const b = date(late);
      return a === b
        ? ` Across the 80% range, also around ${a}.`
        : ` Across the 80% range: between ${a} and ${b}.`;
    }
    return ` Across the 80% range: as early as ${date(early)}, or after ${horizon}.`;
  };

  const named = label.includes(valueText) ? label : `${label} (${valueText})`;
  const m = range.median;
  if (m?.atStart) {
    const where =
      kind === "target"
        ? `Already at ${named}`
        : `Already ${direction === "below" ? "at or below" : "at or above"} ${valueText} (${label})`;
    return {
      markerX: null,
      marker: null,
      detail: `${where} at the last actual.`,
    };
  }

  if (m) {
    const when = date(m);
    let detail = `The median ${verb} ${valueText} around ${when}`;
    if (kind === "target" && byX !== null && byText) {
      detail +=
        m.x <= byX
          ? `, before the ${byText} deadline.`
          : `, after the ${byText} deadline.`;
    } else {
      detail += ".";
    }
    return {
      markerX: m.x,
      marker: `${label} ~${when}`,
      detail: detail + bands(),
    };
  }

  const early = range.early && !range.early.atStart ? range.early : null;
  let detail =
    kind === "threshold"
      ? `The median stays ${direction === "below" ? "above" : "below"} ${valueText} through ${horizon}.`
      : `The median doesn't reach ${named} by ${horizon}${byText && byText !== horizon ? `; the deadline is ${byText}` : ""}.`;
  if (early) {
    detail += ` The ${firstEdge} ${verb} it around ${date(early)}.`;
  } else if (range.hasBands) {
    detail +=
      kind === "threshold"
        ? " So does the whole 80% range."
        : ` Even the ${firstEdge} falls short.`;
  }
  return { markerX: null, marker: null, detail };
}

/** What a row says, for the tooltip's screen-reader twin and the live region. */
export function rowText(
  row: Row,
  options: {
    metric: MetricLike | undefined;
    granularity: Granularity;
    scenarioLabels?: string[];
    showScenarios?: boolean;
    locale?: string;
  },
): string {
  const {
    metric,
    granularity,
    scenarioLabels = [],
    locale = DEFAULT_LOCALE,
  } = options;
  const v = (n: number) => formatValue(n, metric, "full", locale);
  const parts: string[] = [];
  if (isNum(row.actual)) parts.push(`actual ${v(row.actual)}`);
  if (row.kind === "forecast") {
    if (options.showScenarios) {
      row.scenarios.forEach((s, i) => {
        if (isNum(s))
          parts.push(`${scenarioLabels[i] ?? `Scenario ${i + 1}`} ${v(s)}`);
      });
    } else if (isNum(row.p50)) {
      parts.push(`median forecast ${v(row.p50)}`);
      const r = (b: [number, number]) =>
        formatRange(b[0], b[1], metric, "full", " to ", locale);
      if (row.outer) parts.push(`80% range ${r(row.outer)}`);
      if (row.inner) parts.push(`50% range ${r(row.inner)}`);
    }
  }
  const when = formatPeriod(row.t, granularity, "long", locale);
  return parts.length ? `${when}: ${parts.join(", ")}` : `${when}: no data`;
}

/** The whole forecast in a few sentences, for screen readers. */
export function summaryText(options: {
  metric: MetricLike | undefined;
  granularity: Granularity;
  history: Actual[];
  forecast: Projected[];
  details?: string[];
  locale?: string;
}): string {
  const {
    metric,
    granularity: g,
    history,
    forecast,
    locale = DEFAULT_LOCALE,
  } = options;
  const horizon = horizonSummary(forecast);
  if (!horizon) return "";
  const label = metric?.label ?? "The metric";
  const parts = [
    `${label} forecast: ${formatValue(horizon.p50, metric, "compact", locale)} ${periodPhrase(horizon.t, g, locale)} (median)`,
  ];
  const range = rangeText(horizon, metric, locale);
  if (range) parts[0] += `, ${range}`;
  parts[0] += ".";
  const change = changeVsLast(history, forecast);
  if (change) {
    parts.push(
      `That's ${formatChange(change, metric, locale)} from the last actual, ${formatValue(change.from, metric, "compact", locale)} ${periodPhrase(change.fromT, g, locale)}.`,
    );
  }
  return [...parts, ...(options.details ?? [])].join(" ");
}
