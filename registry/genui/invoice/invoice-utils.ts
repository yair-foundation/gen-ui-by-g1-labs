/**
 * Invoice: pure helpers. Money math runs in integer minor units (cents), so
 * 0.1 + 0.2 is 0.30, not 0.30000000000000004. No React, no DOM: safe to reuse
 * on the server and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type InvoiceKind = "invoice" | "bill" | "receipt";

export type InvoiceState =
  | "draft"
  | "open"
  | "due-soon"
  | "overdue"
  | "paid"
  | "partially-paid"
  | "void"
  | "refunded";

export type InvoiceAction =
  | "pay"
  | "download"
  | "forward"
  | "dispute"
  | "add-to-expenses"
  | "remind";

/** States with money still owed. Pay and remind only make sense here. */
export const PAYABLE_STATES: readonly InvoiceState[] = [
  "open",
  "due-soon",
  "overdue",
  "partially-paid",
];

export function isPayable(state: InvoiceState | undefined): boolean {
  return state !== undefined && PAYABLE_STATES.includes(state);
}

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

/** Sum of amounts, without float drift. */
export function sumMoney(amounts: number[], digits = 2): number {
  let minor = 0;
  for (const a of amounts) {
    if (Number.isFinite(a)) minor += toMinor(a, digits);
  }
  return fromMinor(minor, digits);
}

/**
 * Formats an amount in its currency. `precise` keeps up to 4 decimals, for
 * unit prices such as $0.1238 per kWh.
 */
export function formatMoney(
  amount: number,
  currency?: string,
  options: { precise?: boolean; locale?: string } = {},
): string {
  const { locale = DEFAULT_LOCALE } = options;
  const digits = currencyDigits(currency);
  const fraction = options.precise
    ? {
        minimumFractionDigits: digits,
        maximumFractionDigits: Math.max(digits, 4),
      }
    : {};
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      ...fraction,
    }).format(amount);
  } catch {
    const n = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: options.precise ? Math.max(digits, 4) : digits,
    }).format(amount);
    return currency ? `${n} ${currency}` : n;
  }
}

/**
 * What is still owed: `amountDue` when given, else total minus amountPaid,
 * else the total. Undefined until the total is known.
 */
export function amountOwed(
  input: { total?: number; amountPaid?: number; amountDue?: number },
  digits = 2,
): number | undefined {
  if (typeof input.amountDue === "number") return input.amountDue;
  if (typeof input.total !== "number") return undefined;
  if (typeof input.amountPaid === "number") {
    return fromMinor(
      Math.max(
        0,
        toMinor(input.total, digits) - toMinor(input.amountPaid, digits),
      ),
      digits,
    );
  }
  return input.total;
}

// ---------------------------------------------------------------------------
// Totals reconciliation

export type ReconcileInput = {
  lines: { amount: number }[];
  subtotal?: number;
  discounts?: { amount: number }[];
  /** `included` taxes are already inside the line amounts (VAT-inclusive prices). */
  tax?: { amount: number; included?: boolean }[];
  shipping?: number;
  total: number;
  amountPaid?: number;
  amountDue?: number;
};

export type ReconcileIssue =
  /** The line amounts don't sum to the stated subtotal. */
  | { kind: "subtotal"; expected: number; actual: number }
  /** Subtotal (or lines) − discounts + taxes + shipping ≠ total. */
  | { kind: "total"; expected: number; actual: number }
  /** amountPaid + amountDue ≠ total. */
  | { kind: "balance"; paid: number; due: number; total: number };

export type Reconciliation = {
  ok: boolean;
  /** Sum of the line amounts. */
  linesSum: number;
  /** What the total should be, from the subtotal (or lines) and adjustments. */
  expectedTotal: number;
  /** Whether any discount, added tax or shipping applies. */
  adjusted: boolean;
  issues: ReconcileIssue[];
};

/**
 * Checks that the document adds up, within 0.01. Each check compares adjacent
 * figures, so one bad number produces one issue rather than a cascade.
 */
export function reconcile(input: ReconcileInput, digits = 2): Reconciliation {
  const tolerance = Math.round(0.01 * 10 ** digits);
  const m = (n: number) => toMinor(n, digits);
  const off = (a: number, b: number) => Math.abs(a - b) > tolerance;

  const lines = input.lines.reduce((s, l) => s + m(l.amount), 0);
  const issues: ReconcileIssue[] = [];

  if (typeof input.subtotal === "number" && off(m(input.subtotal), lines)) {
    issues.push({
      kind: "subtotal",
      expected: fromMinor(lines, digits),
      actual: input.subtotal,
    });
  }

  const base = typeof input.subtotal === "number" ? m(input.subtotal) : lines;
  // Discounts are positive numbers shown as negatives; accept either sign.
  const discounts = (input.discounts ?? []).reduce(
    (s, d) => s + Math.abs(m(d.amount)),
    0,
  );
  const taxes = (input.tax ?? [])
    .filter((t) => !t.included)
    .reduce((s, t) => s + m(t.amount), 0);
  const shipping = typeof input.shipping === "number" ? m(input.shipping) : 0;
  const expected = base - discounts + taxes + shipping;

  if (off(m(input.total), expected)) {
    issues.push({
      kind: "total",
      expected: fromMinor(expected, digits),
      actual: input.total,
    });
  }

  if (
    typeof input.amountPaid === "number" &&
    typeof input.amountDue === "number" &&
    off(m(input.amountPaid) + m(input.amountDue), m(input.total))
  ) {
    issues.push({
      kind: "balance",
      paid: input.amountPaid,
      due: input.amountDue,
      total: input.total,
    });
  }

  return {
    ok: issues.length === 0,
    linesSum: fromMinor(lines, digits),
    expectedTotal: fromMinor(expected, digits),
    adjusted: discounts !== 0 || taxes !== 0 || shipping !== 0,
    issues,
  };
}

/** One plain sentence per issue, for the warning under the totals. */
export function describeIssues(
  rec: Reconciliation,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string[] {
  const money = (n: number) => formatMoney(n, currency, { locale });
  return rec.issues.map((issue) => {
    if (issue.kind === "subtotal") {
      return `Totals don't add up: lines sum to ${money(issue.expected)}, but the subtotal is ${money(issue.actual)}.`;
    }
    if (issue.kind === "total") {
      return rec.adjusted
        ? `Totals don't add up: lines and adjustments come to ${money(issue.expected)}, but the total is ${money(issue.actual)}.`
        : `Totals don't add up: lines sum to ${money(issue.expected)}, but the total is ${money(issue.actual)}.`;
    }
    return `Totals don't add up: ${money(issue.paid)} paid plus ${money(issue.due)} due isn't the total of ${money(issue.total)}.`;
  });
}

// ---------------------------------------------------------------------------
// Dates

const DAY_MS = 86_400_000;

/**
 * Parses an ISO date. A date-only string ("2026-10-13") is a calendar date in
 * the viewer's time zone, not UTC midnight, so it never shows as the day before.
 */
export function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? null : d;
  }
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
export function resolveNow(
  now: Date | string | number | undefined,
): number | null {
  if (now === undefined) return null;
  if (typeof now === "string") return parseDate(now)?.getTime() ?? null;
  const t = new Date(now).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Whole calendar days from `from` to `to` in local time (DST-safe). */
export function calendarDaysBetween(
  from: Date | number,
  to: Date | number,
): number {
  const a = new Date(from);
  const b = new Date(to);
  const a0 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((b0 - a0) / DAY_MS);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "Due in 5 days", "Due today", "Overdue by 3 days". Null when nothing is
 * owed, the date is unknown, or `now` isn't known yet (before mount).
 */
export function relativeDue(
  dueAt: string | undefined,
  now: number | null,
  state: InvoiceState | undefined,
): { text: string; overdue: boolean } | null {
  if (now === null || !isPayable(state)) return null;
  const due = parseDate(dueAt);
  if (!due) return null;
  const days = calendarDaysBetween(now, due);
  if (days > 1) return { text: `Due in ${days} days`, overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  if (days === 0) return { text: "Due today", overdue: false };
  return { text: `Overdue by ${plural(-days, "day")}`, overdue: true };
}

/** "16 days left to return", "Last day to return", "Return window closed". */
export function relativeReturn(
  returnBy: string | undefined,
  now: number | null,
): string | null {
  if (now === null) return null;
  const date = parseDate(returnBy);
  if (!date) return null;
  const days = calendarDaysBetween(now, date);
  if (days > 0) return `${plural(days, "day")} left to return`;
  if (days === 0) return "Last day to return";
  return "Return window closed";
}

/** Overdue by state, or by a passed due date while money is still owed. */
export function isOverdue(
  state: InvoiceState | undefined,
  dueAt: string | undefined,
  now: number | null,
): boolean {
  if (state === "overdue") return true;
  return relativeDue(dueAt, now, state)?.overdue ?? false;
}

// ---------------------------------------------------------------------------
// Titles and actions

const KIND_LABEL: Record<InvoiceKind, string> = {
  invoice: "Invoice",
  bill: "Bill",
  receipt: "Receipt",
};

/** "Invoice #1042", "Bill HP-26-0917", or just "Receipt". */
export function documentTitle(kind: InvoiceKind, number?: string): string {
  const label = KIND_LABEL[kind];
  const n = number?.trim().replace(/^#\s*/, "");
  if (!n) return label;
  return /^\d+$/.test(n) ? `${label} #${n}` : `${label} ${n}`;
}

export type ActionContext = {
  /** For invoices: 'sent' when the user issued it, 'received' from a vendor. */
  direction?: "sent" | "received";
  /** From `isOverdue`. */
  overdue?: boolean;
};

/**
 * Defaults when the agent passes no actions. The first is the primary button.
 * - bill: pay (while owed), download
 * - invoice the user sent: remind (when overdue), download
 * - invoice the user received: pay (while owed), download
 * - receipt: download, add to expenses
 */
export function defaultActions(
  kind: InvoiceKind,
  state: InvoiceState,
  ctx: ActionContext = {},
): InvoiceAction[] {
  const payable = isPayable(state);
  switch (kind) {
    case "bill":
      return payable ? ["pay", "download"] : ["download"];
    case "invoice":
      if (ctx.direction === "sent" && payable && ctx.overdue) {
        return ["remind", "download"];
      }
      if (ctx.direction === "received" && payable) return ["pay", "download"];
      return ["download"];
    case "receipt":
      return ["download", "add-to-expenses"];
  }
}

/**
 * The buttons to show: the agent's list (or the defaults), de-duplicated, with
 * pay and remind dropped when nothing is owed.
 */
export function resolveActions(
  actions: readonly InvoiceAction[] | undefined,
  kind: InvoiceKind,
  state: InvoiceState,
  ctx: ActionContext = {},
): InvoiceAction[] {
  const list =
    actions && actions.length > 0 ? actions : defaultActions(kind, state, ctx);
  const payable = isPayable(state);
  return [...new Set(list)].filter(
    (a) => payable || (a !== "pay" && a !== "remind"),
  );
}
