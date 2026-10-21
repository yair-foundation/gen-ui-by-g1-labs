import qrcode from "qrcode-generator";
import { DEFAULT_LOCALE } from "@/components/genui/locale";

/**
 * Gift card: pure helpers. Money math runs in integer minor units (cents);
 * dates use Intl only. No React, no DOM: safe to reuse on the server and to
 * unit-test in Node. The QR encoder wraps `qrcode-generator`.
 */

export type GiftCardPattern = "stripes" | "dots" | "grid" | "plain";

/** Patterns cycled through when a design doesn't name one. */
export const DESIGN_PATTERNS: readonly GiftCardPattern[] = [
  "stripes",
  "dots",
  "grid",
];

// ---------------------------------------------------------------------------
// Money

/** Decimal places for a currency, e.g. USD → 2, JPY → 0. */
export function currencyDigits(currency: string | undefined): number {
  if (!currency) return 2;
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Amount in integer minor units. */
export function toMinor(amount: number, digits = 2): number {
  // toFixed first: 1.005 * 100 is 100.49999999999999 in floating point.
  return Math.round(Number((amount * 10 ** digits).toFixed(6)));
}

export function fromMinor(minor: number, digits = 2): number {
  return minor / 10 ** digits;
}

function moneyFormatter(
  currency: string | undefined,
  locale: string = DEFAULT_LOCALE,
) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency });
  } catch {
    const digits = currencyDigits(currency);
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

/** "$37.50". Whole amounts can drop the cents ("$50") with `trimZeroCents`. */
export function formatMoney(
  amount: number,
  currency?: string,
  {
    locale = DEFAULT_LOCALE,
    trimZeroCents,
  }: { locale?: string; trimZeroCents?: boolean } = {},
): string {
  const digits = currencyDigits(currency);
  const whole = toMinor(amount, digits) % 10 ** digits === 0;
  if (trimZeroCents && whole) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
      }).format(amount);
    } catch {
      // Fall through to the full format.
    }
  }
  return moneyFormatter(currency, locale).format(amount);
}

export type MoneyParts = {
  /** Sign, symbol and whole units, e.g. "$37". */
  lead: string;
  /** Decimal separator and fraction, e.g. ".50". Empty for JPY. */
  cents: string;
  /** Anything after the fraction, e.g. " €" in de-DE. */
  trail: string;
  /** The full formatted string. */
  text: string;
};

/** Splits a formatted amount so the cents can be dimmed, for any currency and locale. */
export function splitMoney(
  amount: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): MoneyParts {
  const parts = moneyFormatter(currency, locale).formatToParts(amount);
  const start = parts.findIndex((p) => p.type === "decimal");
  const join = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((p) => p.value)
      .join("");
  if (start < 0) {
    const text = join(0, parts.length);
    return { lead: text, cents: "", trail: "", text };
  }
  let end = start + 1;
  while (end < parts.length && parts[end].type === "fraction") end++;
  return {
    lead: join(0, start),
    cents: join(start, end),
    trail: join(end, parts.length),
    text: join(0, parts.length),
  };
}

/** The currency's narrow symbol, e.g. "$" for USD, "€" for EUR. */
export function currencySymbol(
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

// ---------------------------------------------------------------------------
// Amount entry

export type AmountIssue = "empty" | "invalid" | "precision" | "min" | "max";

export type AmountParse =
  | { ok: true; minor: number }
  | { ok: false; issue: "empty" | "invalid" | "precision" };

/**
 * A typed amount ("40", "40.5", "40,50", "$40") in minor units. No grouping
 * separators; at most the currency's decimal places.
 */
export function parseAmount(text: string, digits = 2): AmountParse {
  const v = text.replace(/[\s$€£¥]/g, "");
  if (v === "") return { ok: false, issue: "empty" };
  const m = /^(\d{1,7})(?:[.,](\d*))?$/.exec(v);
  if (!m) return { ok: false, issue: "invalid" };
  const fraction = (m[2] ?? "").replace(/0+$/, "");
  if (fraction.length > digits) return { ok: false, issue: "precision" };
  const minor =
    Number(m[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  return { ok: true, minor };
}

/** "min" below the range (or zero), "max" above it, else null. Bounds are major units. */
export function checkRange(
  minor: number,
  range: { min?: number; max?: number } | undefined,
  digits = 2,
): "min" | "max" | null {
  if (minor <= 0) return "min";
  if (typeof range?.min === "number" && minor < toMinor(range.min, digits)) {
    return "min";
  }
  if (typeof range?.max === "number" && minor > toMinor(range.max, digits)) {
    return "max";
  }
  return null;
}

/** Parses and range-checks a typed amount in one step. */
export function validateAmount(
  text: string,
  range: { min?: number; max?: number } | undefined,
  digits = 2,
): { ok: true; minor: number } | { ok: false; issue: AmountIssue } {
  const parsed = parseAmount(text, digits);
  if (!parsed.ok) return parsed;
  const issue = checkRange(parsed.minor, range, digits);
  return issue ? { ok: false, issue } : parsed;
}

/** The message for an amount issue. */
export function amountIssueText(
  issue: AmountIssue,
  range: { min?: number; max?: number } | undefined,
  currency: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  const money = (n: number) =>
    formatMoney(n, currency, { trimZeroCents: true, locale });
  const digits = currencyDigits(currency);
  switch (issue) {
    case "empty":
      return "Enter an amount.";
    case "invalid":
      return digits === 0
        ? "Enter a whole number, like 40."
        : "Enter an amount in numbers, like 40 or 40.50.";
    case "precision":
      return digits === 0
        ? "Use a whole amount."
        : `Use at most ${digits} decimal places.`;
    case "min":
      return typeof range?.min === "number"
        ? `The minimum is ${money(range.min)}.`
        : "Enter an amount above zero.";
    case "max":
      return typeof range?.max === "number"
        ? `The maximum is ${money(range.max)}.`
        : "That amount is too high.";
  }
}

// ---------------------------------------------------------------------------
// Card number and expiry

/** "•••• 4821". Anything but exactly 4 digits shows dots only. */
export function maskedNumber(last4: string | undefined): string {
  return typeof last4 === "string" && /^\d{4}$/.test(last4)
    ? `•••• ${last4}`
    : "••••";
}

/** "ending in 4821", for screen readers. */
export function spokenNumber(last4: string | undefined): string {
  return typeof last4 === "string" && /^\d{4}$/.test(last4)
    ? `ending in ${last4}`
    : "number hidden";
}

/** The calendar date of an instant, as 'YYYY-MM-DD', in a timezone (default: the viewer's). */
export function dayKeyIn(t: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * "Expires Dec 31, 2027", "Expires today" or "Expired Mar 1, 2026". A plain
 * date expires at the end of that day. Without `now` (before mount) it never
 * says expired. Null when unparseable.
 */
export function expiryText(
  expiresAt: string | undefined,
  now: number | null,
  {
    locale = DEFAULT_LOCALE,
    timeZone,
  }: { locale?: string; timeZone?: string } = {},
): { text: string; expired: boolean } | null {
  if (!expiresAt) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt);
  const t = Date.parse(dateOnly ? `${expiresAt}T00:00:00Z` : expiresAt);
  if (Number.isNaN(t)) return null;
  const day = dateOnly ? expiresAt : dayKeyIn(t, timeZone);
  const label = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : timeZone,
  }).format(t);
  if (now === null) return { text: `Expires ${label}`, expired: false };
  const today = dayKeyIn(now, timeZone);
  const expired = dateOnly ? today > day : now >= t;
  if (expired) return { text: `Expired ${label}`, expired: true };
  if (today === day) return { text: "Expires today", expired: false };
  return { text: `Expires ${label}`, expired: false };
}

// ---------------------------------------------------------------------------
// Sending

/** Counts by code point, so an emoji counts once. */
export function messageLength(text: string): number {
  return [...text].length;
}

/** Cuts a message to `max` code points. */
export function clampMessage(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/** "42/250", with what's left and whether to warn (20 or fewer left). */
export function messageCounter(text: string, max: number) {
  const count = messageLength(text);
  const remaining = max - count;
  return {
    count,
    remaining,
    over: remaining < 0,
    near: remaining <= 20,
    label: `${count}/${max}`,
  };
}

/** A practical email check: one @, a dot in the domain, no spaces, sane lengths. */
export function isValidEmail(email: string | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  if (e.length > 254) return false;
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(e);
  if (!m) return false;
  const [, local, domain] = m;
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".")) {
    return false;
  }
  if (local.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (
    !labels.every((l) =>
      /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(l),
    )
  ) {
    return false;
  }
  return (labels[labels.length - 1] ?? "").length >= 2;
}

/** "Paper Lantern Books" → "PL". */
export function initialsOf(name: string | undefined): string {
  if (!name) return "";
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? "")
    .join("");
}

/** "Delivers now" or "Delivers Fri, Oct 23". Null for an invalid date. */
export function deliveryText(
  deliverAt: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!deliverAt || deliverAt === "now") return "Delivers now";
  const day = deliverAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return `Delivers ${new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(t)}`;
}

/** The pattern for a design: its own, else cycled by position. */
export function patternFor(
  design: { pattern?: GiftCardPattern } | undefined,
  index: number,
): GiftCardPattern {
  return (
    design?.pattern ??
    DESIGN_PATTERNS[
      ((index % DESIGN_PATTERNS.length) + DESIGN_PATTERNS.length) %
        DESIGN_PATTERNS.length
    ] ??
    "plain"
  );
}

// ---------------------------------------------------------------------------
// QR code

/** Quiet zone around the code, in modules (the standard minimum). */
export const QUIET_ZONE = 4;

export type QrMatrix = boolean[][];

/**
 * The issuer's payload as a QR module matrix (UTF-8, byte mode, level M, the
 * smallest version that fits), or null when it doesn't fit. The library reads
 * bytes through its global `stringToBytes`, so it's swapped for UTF-8 bytes
 * during `addData` only and restored right after.
 */
export function encodeQr(text: string): QrMatrix | null {
  if (!text) return null;
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > 2331) return null;
  const qr = qrcode(0, "M");
  const previous = qrcode.stringToBytes;
  qrcode.stringToBytes = () => bytes;
  try {
    qr.addData(text, "Byte");
  } finally {
    qrcode.stringToBytes = previous;
  }
  try {
    qr.make();
  } catch {
    return null;
  }
  const count = qr.getModuleCount();
  const modules: QrMatrix = [];
  for (let r = 0; r < count; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
    modules.push(row);
  }
  return modules;
}

/**
 * One SVG path for all dark modules, one rectangle per horizontal run, offset
 * by the quiet zone. Use with `viewBox="0 0 n+2m n+2m"`.
 */
export function matrixToPath(modules: QrMatrix, margin = QUIET_ZONE): string {
  const out: string[] = [];
  modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      out.push(
        `M${start + margin} ${r + margin}h${c - start}v1h-${c - start}z`,
      );
    }
  });
  return out.join("");
}
