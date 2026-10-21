/**
 * Insight Card: pure helpers (no React), so they can be unit-tested in Node.
 *
 * - packCircles: greedy circle packing for the bubbles visual.
 * - buildMonthGrid / weekdayOrder: the dot-calendar grid.
 * - formatRelativeDay: "Yesterday", "3 days ago", or a short date.
 * - parseBold: **bold** segments in the insight sentence.
 * - formatAmount: locale-aware numbers and currency.
 * - streakLength / streakDayStates / streakDayPhrases: the streak visual.
 * - sequenceCounts / sequencePhrases: the sequence visual.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

// ---------------------------------------------------------------------------
// Circle packing
// ---------------------------------------------------------------------------

export type PackedCircle = {
  /** Index into the input values. */
  index: number;
  x: number;
  y: number;
  r: number;
};

type Circle = { index: number; x: number; y: number; r: number };

const EPS = 1e-6;

function overlapsAny(c: Circle, placed: Circle[], gap: number) {
  for (const p of placed) {
    const min = c.r + p.r + gap;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    if (dx * dx + dy * dy < min * min - EPS) return true;
  }
  return false;
}

/** The (up to two) centres at distance da from a and db from b. */
function tangentPoints(
  a: Circle,
  b: Circle,
  da: number,
  db: number,
): { x: number; y: number }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || d > da + db + EPS || d < Math.abs(da - db) - EPS) return [];
  const along = (da * da - db * db + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, da * da - along * along));
  const mx = a.x + (along * dx) / d;
  const my = a.y + (along * dy) / d;
  const ox = (-dy * h) / d;
  const oy = (dx * h) / d;
  return [
    { x: mx + ox, y: my + oy },
    { x: mx - ox, y: my - oy },
  ];
}

/**
 * Packs circles whose AREA is proportional to each value, then scales the
 * group to fit a width × height box (centred).
 *
 * Largest first: each next circle is placed tangent to two placed circles, at
 * the candidate closest to the area-weighted centroid that overlaps nothing.
 * `gap` is the space between circles in output pixels. Values ≤ 0 (or not
 * finite) are skipped. Deterministic; the second circle goes to the right.
 */
export function packCircles(
  values: number[],
  width: number,
  height: number,
  gap = 4,
): PackedCircle[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .filter((v) => Number.isFinite(v.value) && v.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index);
  if (order.length === 0 || width <= 0 || height <= 0) return [];

  // Unit radii: r = sqrt(value), normalised so the largest is 1.
  const maxSqrt = Math.sqrt(order[0].value);
  const radii = order.map((o) => Math.sqrt(o.value) / maxSqrt);
  // Layout-space gap; corrected after scaling (see below).
  const unitGap = 0.06;

  const placed: Circle[] = [];
  let cx = 0;
  let cy = 0;
  let mass = 0;

  order.forEach((o, i) => {
    const r = radii[i];
    let best: Circle | null = null;

    if (i === 0) {
      best = { index: o.index, x: 0, y: 0, r };
    } else if (i === 1) {
      best = { index: o.index, x: placed[0].r + r + unitGap, y: 0, r };
    } else {
      let bestDist = Number.POSITIVE_INFINITY;
      const consider = (x: number, y: number) => {
        const c = { index: o.index, x, y, r };
        const dist = (x - cx) ** 2 + (y - cy) ** 2;
        if (dist < bestDist - EPS && !overlapsAny(c, placed, unitGap)) {
          best = c;
          bestDist = dist;
        }
      };
      for (let a = 0; a < placed.length; a++) {
        for (let b = a + 1; b < placed.length; b++) {
          const pa = placed[a];
          const pb = placed[b];
          for (const p of tangentPoints(
            pa,
            pb,
            pa.r + r + unitGap,
            pb.r + r + unitGap,
          )) {
            consider(p.x, p.y);
          }
        }
      }
      // Fallback (never expected): walk around each circle.
      if (!best) {
        for (const p of placed) {
          for (let k = 0; k < 36; k++) {
            const t = (k / 36) * Math.PI * 2;
            const d = p.r + r + unitGap;
            consider(p.x + Math.cos(t) * d, p.y + Math.sin(t) * d);
          }
        }
      }
    }

    const c = best as Circle | null;
    if (!c) return;
    placed.push(c);
    const m = c.r * c.r;
    cx = (cx * mass + c.x * m) / (mass + m);
    cy = (cy * mass + c.y * m) / (mass + m);
    mass += m;
  });

  // Fit the bounding box into the target box.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of placed) {
    minX = Math.min(minX, c.x - c.r);
    minY = Math.min(minY, c.y - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;

  // Shrink each radius so the visible gap is `gap` px, never below half size.
  const shrink = Math.max(0, (gap - unitGap * scale) / 2);

  return placed.map((c) => ({
    index: c.index,
    x: offsetX + (c.x - minX) * scale,
    y: offsetY + (c.y - minY) * scale,
    r: Math.max(c.r * scale * 0.5, c.r * scale - shrink),
  }));
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type MonthGrid = {
  year: number;
  /** 0-based month. */
  month: number;
  daysInMonth: number;
  /** Empty cells before day 1 in the first week row. */
  leading: number;
  /** Day numbers in grid order, `null` for leading/trailing blanks. Length is a multiple of 7. */
  cells: (number | null)[];
};

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Parses "YYYY-MM"; null when malformed. */
export function parseMonth(
  value: string,
): { year: number; month: number } | null {
  const m = MONTH_RE.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1 };
}

/** Weekdays (0 = Sunday) in column order for a week start. */
export function weekdayOrder(weekStart: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7);
}

/** The month as 7-column rows, starting on `weekStart` (0 = Sunday, 1 = Monday). */
export function buildMonthGrid(
  monthValue: string,
  weekStart: 0 | 1,
): MonthGrid | null {
  const parsed = parseMonth(monthValue);
  if (!parsed) return null;
  const { year, month } = parsed;
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = (first - weekStart + 7) % 7;
  const cells: (number | null)[] = Array.from({ length: leading }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return { year, month, daysInMonth, leading, cells };
}

/** "YYYY-MM-DD" → { year, month (0-based), day }; null when malformed or rolled over. */
export function parseDay(
  value: string,
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Local "YYYY-MM-DD" for a Date. */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Relative timestamp
// ---------------------------------------------------------------------------

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function capitalize(text: string, locale: string = DEFAULT_LOCALE) {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/**
 * Today / Yesterday / "3 days ago" for the last week, then a short date
 * ("Jan 30", with the year when it differs). Future times get a short date.
 * Returns null for unparseable input.
 */
export function formatRelativeDay(
  iso: string,
  now: Date,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.round(
    (startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) /
      86_400_000,
  );
  try {
    if (days >= 0 && days < 7) {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      return capitalize(rtf.format(-days, "day"), locale);
    }
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
    }).format(date);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bold parser
// ---------------------------------------------------------------------------

export type TextSegment = { text: string; bold: boolean };

/**
 * Splits "**bold**" segments out of plain text. Nothing else is interpreted.
 * An unclosed "**" stays literal, unless `partial` (still streaming), where
 * the rest is shown bold so the markers never flash.
 */
export function parseBold(text: string, partial = false): TextSegment[] {
  const out: TextSegment[] = [];
  let i = 0;
  let bold = false;
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ text: buffer, bold });
    buffer = "";
  };
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      if (!bold) {
        const close = text.indexOf("**", i + 2);
        if (close === -1) {
          if (partial) {
            flush();
            bold = true;
            i += 2;
            continue;
          }
          buffer += text.slice(i);
          break;
        }
      }
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    buffer += text[i];
    i++;
  }
  flush();
  return out.filter((s) => s.text.length > 0);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export type AmountFormat = {
  format?: "currency" | "number";
  currency?: string;
  locale?: string;
};

/** Locale-aware; whole amounts drop the decimals ("₪210", not "₪210.00"). */
export function formatAmount(value: number, opts: AmountFormat = {}): string {
  const { locale = DEFAULT_LOCALE } = opts;
  const whole = Number.isInteger(value);
  const digits: Intl.NumberFormatOptions = whole
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : {};
  if (opts.format === "currency" && opts.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: opts.currency,
        ...digits,
      }).format(value);
    } catch {
      // Invalid currency or locale: fall through.
    }
  }
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

export type StreakDayState = "done" | "missed" | "upcoming";

/**
 * Consecutive done days ending at the last done day (0 when none are done).
 * Undone days after it (today, upcoming) don't break the streak.
 */
export function streakLength(days: { done: boolean }[]): number {
  let i = days.length - 1;
  while (i >= 0 && !days[i].done) i--;
  let count = 0;
  for (; i >= 0 && days[i].done; i--) count++;
  return count;
}

/**
 * Done, missed (an undone day before the last done day) or upcoming (an
 * undone day after it: today or later, not done yet).
 */
export function streakDayStates(days: { done: boolean }[]): StreakDayState[] {
  let last = days.length - 1;
  while (last >= 0 && !days[last].done) last--;
  return days.map((d, i) =>
    d.done ? "done" : i < last ? "missed" : "upcoming",
  );
}

/** Weekday of a "YYYY-MM-DD" day ("M", "Monday"); "" when malformed. */
export function weekdayName(
  key: string,
  locale: string = DEFAULT_LOCALE,
  style: "narrow" | "long" = "long",
): string {
  const parsed = parseDay(key);
  if (!parsed) return "";
  return new Intl.DateTimeFormat(locale, {
    weekday: style,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month, parsed.day)));
}

/** "8 days", "1 day", with the number in `locale`. */
export function formatDayCount(
  count: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = formatAmount(count, { locale });
  return `${n} ${count === 1 ? "day" : "days"}`;
}

const STATE_WORDS: Record<StreakDayState, string> = {
  done: "done",
  missed: "not done",
  upcoming: "not yet",
};

/**
 * One phrase per day for screen readers: "Monday done", "Friday not yet".
 * Over a week, weekdays repeat, so the date is added ("Monday, October 5 done").
 */
export function streakDayPhrases(
  days: { date: string; done: boolean }[],
  locale: string = DEFAULT_LOCALE,
): string[] {
  const states = streakDayStates(days);
  const withDate = days.length > 7;
  return days.map((d, i) => {
    const parsed = parseDay(d.date);
    let name = d.date;
    if (parsed) {
      name = new Intl.DateTimeFormat(locale, {
        weekday: "long",
        ...(withDate && { month: "long", day: "numeric" }),
        timeZone: "UTC",
      }).format(new Date(Date.UTC(parsed.year, parsed.month, parsed.day)));
    }
    return `${name} ${STATE_WORDS[states[i]]}`;
  });
}

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

/** Done and remaining steps. */
export function sequenceCounts(items: { done: boolean }[]): {
  done: number;
  remaining: number;
} {
  const done = items.filter((i) => i.done).length;
  return { done, remaining: items.length - done };
}

/**
 * One phrase per done step, then what's left, for screen readers:
 * "Breakfast done", "Lunch done", "2 to go". "All done" when nothing is left.
 * `remainingLabel` replaces the count phrase when given.
 */
export function sequencePhrases(
  items: { label: string; done: boolean }[],
  remainingLabel?: string,
): string[] {
  const phrases = items.filter((i) => i.done).map((i) => `${i.label} done`);
  const { remaining } = sequenceCounts(items);
  if (remaining === 0) phrases.push("All done");
  else phrases.push(remainingLabel?.trim() || `${remaining} to go`);
  return phrases;
}
