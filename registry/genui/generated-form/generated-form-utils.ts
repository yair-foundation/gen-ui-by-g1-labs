/* Pure helpers for the money, phone, tags and mention field types. */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type MentionOption = { value: string; label: string };

// ---- money ------------------------------------------------------------------

/** Decimal places a currency uses (2 for USD, 0 for JPY), from Intl. */
export function currencyDigits(currency = "USD"): number {
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

/**
 * Reads what the user typed as an amount: "1,234.50", "1234", " 80 ".
 * Returns null when it isn't a plain decimal number. Spaces and commas are
 * dropped as separators; a leading minus is kept.
 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[\s,]/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Whether `n` has more decimal places than the currency allows. */
export function tooPrecise(n: number, digits: number): boolean {
  const scaled = Math.round(n * 10 ** (digits + 2)) / 10 ** (digits + 2);
  return (
    Math.abs(scaled * 10 ** digits - Math.round(scaled * 10 ** digits)) > 1e-6
  );
}

/** "$1,234.50", in the user's locale. Falls back to "1,234.50 EUR". */
export function formatMoney(
  amount: number,
  currency = "USD",
  locale: string = DEFAULT_LOCALE,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
  }
}

// ---- phone ------------------------------------------------------------------

/** Digits only (plus a leading +), for checking length. Spaces, dots, dashes and brackets are allowed. */
export function phoneDigits(input: string): string | null {
  const s = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) return null;
  return (s.startsWith("+") ? "+" : "") + s.replace(/\D/g, "");
}

/** A plausible phone number: 7–15 digits (E.164 allows 15). Not a lookup. */
export function isPlausiblePhone(input: string): boolean {
  const d = phoneDigits(input);
  if (!d) return false;
  const n = d.replace("+", "").length;
  return n >= 7 && n <= 15;
}

// ---- tags -------------------------------------------------------------------

/** Trims, drops empties, and removes repeats (case-insensitive, first spelling wins). */
export function normalizeTags(tags: string[], maxLength = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const tag = t.trim().slice(0, maxLength);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** A comma-separated default ("a, b") as tags. */
export function splitTags(text: string): string[] {
  return normalizeTags(text.split(","));
}

// ---- mentions ---------------------------------------------------------------

const MAX_QUERY = 30;

/**
 * The `@query` being typed at the caret, or null. The @ must start the text or
 * follow whitespace; the query can't contain a line break or run past 30
 * characters (names may contain spaces, so spaces are allowed).
 */
export function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n\r]/.test(query)) return null;
  return { start: at, query };
}

/** Options whose label contains the query, best matches (prefix) first. */
export function matchMentions(
  options: MentionOption[],
  query: string,
  limit = 6,
): MentionOption[] {
  const q = query.trim().toLocaleLowerCase();
  const hit = options.filter((o) => o.label.toLocaleLowerCase().includes(q));
  hit.sort((a, b) => {
    const ap = a.label.toLocaleLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.label.toLocaleLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp;
  });
  return hit.slice(0, limit);
}

/** Replaces the `@query` at `start`..`caret` with "@Label " and says where the caret goes. */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  label: string,
): { text: string; caret: number } {
  const inserted = `@${label} `;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  };
}

/** Ids of the options mentioned in the text, as "@Label", in option order. */
export function extractMentions(
  text: string,
  options: MentionOption[],
): string[] {
  const ids: string[] = [];
  for (const o of options) {
    const re = new RegExp(
      `(^|\\s)@${escapeRegExp(o.label)}(?![\\p{L}\\p{N}])`,
      "iu",
    );
    if (re.test(text) && !ids.includes(o.value)) ids.push(o.value);
  }
  return ids;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
