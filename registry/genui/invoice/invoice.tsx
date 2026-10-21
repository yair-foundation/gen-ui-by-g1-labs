"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  BellIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FlagIcon,
  ForwardIcon,
  HashIcon,
  ReceiptIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import {
  amountOwed,
  currencyDigits,
  describeIssues,
  documentTitle,
  formatMoney,
  formatPeriod,
  isOverdue,
  isPayable,
  parseDate,
  reconcile,
  relativeDue,
  relativeReturn,
  resolveActions,
  resolveNow,
  sumMoney,
  type InvoiceAction,
  type InvoiceState,
} from "./invoice-utils";
import type {
  InvoiceAdjustment,
  InvoiceInput,
  InvoiceLine,
  InvoiceParty,
  InvoicePayment,
  InvoiceResult,
  InvoiceTax,
} from "./invoice.schema";
import { IconTip, WhyDisabled } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";

export type InvoiceStatus = "streaming" | "ready" | "submitting" | "done";

type ReadyLine = Partial<InvoiceLine> & { description: string; amount: number };

export type InvoiceProps = Partial<
  Omit<
    InvoiceInput,
    | "issuer"
    | "recipient"
    | "lines"
    | "discounts"
    | "tax"
    | "payment"
    | "period"
    | "source"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  issuer?: Partial<InvoiceParty>;
  recipient?: Partial<InvoiceParty>;
  lines?: Partial<InvoiceLine>[];
  discounts?: Partial<InvoiceAdjustment>[];
  tax?: Partial<InvoiceTax>[];
  payment?: Partial<InvoicePayment>;
  period?: { start?: string; end?: string };
  source?: { label?: string; url?: string };
  /**
   * The moment due and return dates are compared with ("Due in 5 days").
   * Defaults to the viewer's clock, read after mount.
   */
  now?: Date | string | number;
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's actions itself.
   */
  status?: InvoiceStatus;
  /**
   * Called once per action. Each action locks after use; the others stay
   * available. "pay" is a handoff: open your own payment flow.
   */
  onResult?: (result: InvoiceResult) => void;
  /**
   * Actions from history (the tool call's stored output, or several). They
   * show as done and never call onResult again.
   */
  result?: InvoiceResult | InvoiceResult[];
  className?: string;
};

const STATE: Record<
  InvoiceState,
  {
    label: string;
    variant: "outline" | "success" | "warning" | "destructive";
    Icon?: typeof CheckIcon;
  }
> = {
  draft: { label: "Draft", variant: "outline" },
  open: { label: "Unpaid", variant: "outline" },
  "due-soon": { label: "Due soon", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive", Icon: CircleAlertIcon },
  paid: { label: "Paid", variant: "success", Icon: CheckIcon },
  "partially-paid": { label: "Partially paid", variant: "warning" },
  void: { label: "Void", variant: "outline" },
  refunded: { label: "Refunded", variant: "outline" },
};

const PAYMENT_METHOD: Record<InvoicePayment["method"], string> = {
  card: "card",
  bank: "bank transfer",
  cash: "cash",
  wallet: "digital wallet",
  other: "other method",
};

/** Icons for actions past the first two, which show as labelled icon buttons. */
const ACTION_ICON: Record<InvoiceAction, typeof CheckIcon> = {
  pay: WalletIcon,
  download: DownloadIcon,
  forward: ForwardIcon,
  dispute: FlagIcon,
  "add-to-expenses": ReceiptIcon,
  remind: BellIcon,
};

const CONFIRMATION: Record<InvoiceAction, string> = {
  pay: "Sent to your payment flow",
  download: "Download requested",
  forward: "Forward requested",
  dispute: "Dispute sent",
  "add-to-expenses": "Added to expenses",
  remind: "Reminder requested",
};

function safeUrl(url?: string) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const dateFormat = (locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

function formatDate(iso: string | undefined, locale: string) {
  const d = parseDate(iso);
  return d ? dateFormat(locale).format(d) : null;
}

/**
 * The current time, read once after mount (so server and client render the
 * same markup). Skipped when the host passes `now`.
 */
function useMountedNow(active: boolean) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (active) setNow(Date.now());
  }, [active]);
  return now;
}

function DateText({ iso }: { iso?: string }) {
  const locale = useGenUILocale();
  const text = formatDate(iso, locale);
  if (!text) return null;
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}

function SummaryRow({
  label,
  children,
  strong,
  muted,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        strong && "font-semibold",
        muted && genuiType.meta,
      )}
    >
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** A party in the details: name, then address lines, tax ID and email. */
function PartyText({ party }: { party?: Partial<InvoiceParty> }) {
  if (!party?.name) return null;
  return (
    <>
      <span className="block">{party.name}</span>
      {party.address && (
        <span className="block whitespace-pre-line text-muted-foreground">
          {party.address}
        </span>
      )}
      {party.taxId && (
        <span className="block text-muted-foreground">
          Tax ID {party.taxId}
        </span>
      )}
      {party.email && (
        <span className="block break-all text-muted-foreground">
          {party.email}
        </span>
      )}
    </>
  );
}

/** A deduction shown as a negative amount, read as "minus". */
function Negative({ text }: { text: string }) {
  return (
    <>
      <span aria-hidden>−{text}</span>
      <span className="sr-only">minus {text}</span>
    </>
  );
}

export function Invoice({
  kind,
  number,
  direction,
  issuer,
  recipient,
  issuedAt,
  dueAt,
  paidAt,
  state,
  currency,
  lines = [],
  subtotal,
  discounts,
  tax,
  shipping,
  total,
  amountPaid,
  amountDue,
  payment,
  returnBy,
  period,
  source,
  actions,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: InvoiceProps) {
  const locale = useGenUILocale();
  const [done, setDone] = React.useState<Map<InvoiceAction, InvoiceResult>>(
    () =>
      new Map(
        (result === undefined
          ? []
          : Array.isArray(result)
            ? result
            : [result]
        ).map((r) => [r.action, r]),
      ),
  );
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const detailsId = React.useId();
  const [disputing, setDisputing] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const disputeButton = React.useRef<HTMLButtonElement>(null);
  const refocusDispute = React.useRef(false);

  // A host-provided "ready" (or nothing) yields to the user's actions.
  const status: InvoiceStatus =
    done.size > 0 && (statusProp === undefined || statusProp === "ready")
      ? "done"
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const busy = streaming || status === "submitting";

  const fixedNow = resolveNow(nowProp);
  const mountedNow = useMountedNow(fixedNow === null);
  const now = fixedNow ?? mountedNow;

  const digits = currencyDigits(currency);
  const money = (n: number) => formatMoney(n, currency, { locale });

  const ready = lines.filter(
    (l): l is ReadyLine =>
      typeof l.description === "string" && typeof l.amount === "number",
  );
  const readyDiscounts = (discounts ?? []).filter(
    (d): d is InvoiceAdjustment =>
      typeof d.label === "string" && typeof d.amount === "number",
  );
  const readyTax = (tax ?? []).filter(
    (t): t is InvoiceTax =>
      typeof t.label === "string" && typeof t.amount === "number",
  );
  const hasTotal = typeof total === "number";
  const showQty = ready.some(
    (l) => typeof l.quantity === "number" || typeof l.unitPrice === "number",
  );

  const reconciliation =
    !streaming && hasTotal && ready.length > 0
      ? reconcile(
          {
            lines: ready,
            subtotal,
            discounts: readyDiscounts,
            tax: readyTax,
            shipping,
            total,
            amountPaid,
            amountDue,
          },
          digits,
        )
      : null;
  const warnings = reconciliation
    ? describeIssues(reconciliation, currency, locale)
    : [];

  const owed = amountOwed({ total, amountPaid, amountDue }, digits);
  const payable = isPayable(state);
  const overdue = isOverdue(state, dueAt, now);
  const due = relativeDue(dueAt, now, state);
  const returnText = relativeReturn(returnBy, now);
  const title = kind ? documentTitle(kind, number) : "";
  const name = title || "Invoice";
  const subtitle =
    direction === "sent" && recipient?.name
      ? `Billed to ${recipient.name}`
      : issuer?.name;

  const buttons =
    kind && state
      ? resolveActions(actions, kind, state, { direction, overdue })
      : [];

  const shownSubtotal =
    typeof subtotal === "number"
      ? subtotal
      : readyDiscounts.length > 0 ||
          readyTax.length > 0 ||
          typeof shipping === "number"
        ? sumMoney(
            ready.map((l) => l.amount),
            digits,
          )
        : undefined;
  // Amount due only adds information when something was paid or it differs.
  const showBalance =
    typeof amountPaid === "number" ||
    (typeof amountDue === "number" && amountDue !== total);

  const last4 =
    payment?.last4 && /^\d{4}$/.test(payment.last4) ? payment.last4 : null;
  const paymentText = payment?.method
    ? `${
        state === "paid" || state === "refunded"
          ? "Paid by"
          : state === "partially-paid" ||
              (typeof amountPaid === "number" && amountPaid > 0)
            ? "Partly paid by"
            : "Payment method:"
      } ${PAYMENT_METHOD[payment.method]}${last4 ? ` ending ${last4}` : ""}`
    : null;

  const href = safeUrl(source?.url);

  // Secondary facts, collapsed by default: parties, issue date, reference.
  const showIssued = kind !== "receipt" && !!formatDate(issuedAt, locale);
  const reference = payment?.reference;
  const hasDetails = Boolean(
    issuer?.name || recipient?.name || showIssued || reference,
  );

  // The focal figure: what's owed while something is, otherwise the total.
  const showOwed = payable && owed !== undefined;
  const heroAmount = showOwed ? owed : total;
  const showDue =
    kind !== "receipt" && !!dueAt && (!state || payable || state === "draft");
  // Everything else about dates fits on one quiet line.
  const factLine = [
    kind === "receipt" && issuedAt
      ? `Purchased ${formatDate(issuedAt, locale)}`
      : null,
    paidAt && !(kind === "receipt" && paidAt === issuedAt)
      ? `Paid ${formatDate(paidAt, locale)}`
      : null,
    kind === "bill" && period?.start && period.end
      ? formatPeriod(period.start, period.end, locale)
      : null,
  ].filter(Boolean);

  // Return focus to "Dispute" when the reason box closes without sending.
  React.useEffect(() => {
    if (!disputing && refocusDispute.current) {
      refocusDispute.current = false;
      disputeButton.current?.focus();
    }
  }, [disputing]);

  const fire = (r: InvoiceResult) => {
    if (busy || done.has(r.action)) return;
    setDone((prev) => new Map(prev).set(r.action, r));
    onResult?.(r);
  };
  const cancelDispute = () => {
    refocusDispute.current = true;
    setDisputing(false);
  };
  const sendDispute = () => {
    const text = reason.trim();
    if (!text) return;
    setDisputing(false);
    fire({ action: "dispute", reason: text });
  };

  const actionLabel = (a: InvoiceAction) => {
    switch (a) {
      case "pay":
        return owed !== undefined ? `Pay ${money(owed)}` : "Pay";
      case "download":
        return "Download";
      case "forward":
        return "Forward";
      case "dispute":
        return "Dispute";
      case "add-to-expenses":
        return "Add to expenses";
      case "remind":
        return kind === "invoice" && direction === "sent"
          ? "Send reminder"
          : "Remind me";
    }
  };

  const StateIcon = state ? STATE[state].Icon : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="invoice"
        data-status={status}
        data-kind={kind}
        aria-busy={busy}
        aria-label={
          title
            ? `${title}${issuer?.name ? `, ${issuer.name}` : ""}`
            : "Invoice"
        }
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <SurfaceTitle>{title}</SurfaceTitle>
            {/* "Due soon" is already said by the due line. */}
            {state && !(state === "due-soon" && due) && (
              <Badge variant={STATE[state].variant}>
                {StateIcon && (
                  <StateIcon aria-hidden data-icon="inline-start" />
                )}
                {STATE[state].label}
              </Badge>
            )}
          </div>
          {subtitle ? (
            <p className={genuiType.meta}>{subtitle}</p>
          ) : (
            streaming && <Skeleton className="h-4 w-32" />
          )}
        </SurfaceHeader>

        <AutoHeight>
          {/* The answer: what's owed (or what it cost), and by when. */}
          <dl className="flex flex-col gap-1 border-t border-border px-3 py-3">
            <dt className={genuiType.label}>
              {showOwed ? "Amount due" : "Total"}
            </dt>
            <dd className={genuiType.stat}>
              {heroAmount !== undefined ? (
                money(heroAmount)
              ) : (
                <Skeleton className="h-8 w-36" />
              )}
            </dd>
            {showDue && (
              <dd
                className={cn(
                  genuiType.body,
                  "flex items-center gap-1.5 pt-1",
                  due?.overdue && "font-medium text-destructive",
                )}
              >
                {due?.overdue && (
                  <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
                )}
                <span>
                  Due <DateText iso={dueAt} />
                  {due && ` · ${due.text.replace(/^Due /, "")}`}
                </span>
              </dd>
            )}
            {kind === "receipt" && returnBy && (
              <dd className={cn(genuiType.body, "pt-1")}>
                Return by <DateText iso={returnBy} />
                {returnText && ` · ${returnText}`}
              </dd>
            )}
            {factLine.length > 0 && (
              <dd className={genuiType.meta} suppressHydrationWarning>
                {factLine.join(" · ")}
              </dd>
            )}
          </dl>

          {/* Line items */}
          <div className="border-t border-border py-2.5">
            <table className={cn(genuiType.body, "w-full")}>
              <caption className="sr-only">Line items</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Description</th>
                  {showQty && <th scope="col">Quantity and unit price</th>}
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ready.map((line, i) => {
                  const qty = quantityText(line, currency, locale);
                  return (
                    <motion.tr
                      // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id and only append while streaming
                      key={i}
                      data-slot="invoice-line"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className="align-top"
                    >
                      <td className="py-1.5 pl-5">
                        <div className="flex min-w-0 flex-col">
                          <span className="break-words">
                            {line.description}
                          </span>
                          {line.note && (
                            <span className={cn(genuiType.meta, "break-words")}>
                              {line.note}
                            </span>
                          )}
                          {qty && (
                            <span
                              className={cn(
                                genuiType.meta,
                                "tabular-nums sm:hidden",
                              )}
                            >
                              {qty}
                            </span>
                          )}
                        </div>
                      </td>
                      {showQty && (
                        <td className="hidden py-1.5 pl-4 text-right whitespace-nowrap tabular-nums text-muted-foreground sm:table-cell">
                          {qty}
                        </td>
                      )}
                      <td className="py-1.5 pr-5 pl-4 text-right whitespace-nowrap tabular-nums">
                        {money(line.amount)}
                      </td>
                    </motion.tr>
                  );
                })}
                {streaming && (
                  <tr aria-hidden>
                    <td className="py-1.5 pl-5">
                      <Skeleton className="h-4 w-40 max-w-full" />
                    </td>
                    {showQty && <td className="hidden sm:table-cell" />}
                    <td className="py-1.5 pr-5">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
            <dl className={cn(genuiType.body, "flex flex-col gap-1")}>
              {shownSubtotal !== undefined && (
                <SummaryRow label="Subtotal">{money(shownSubtotal)}</SummaryRow>
              )}
              {readyDiscounts.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
                <SummaryRow key={i} label={d.label}>
                  <Negative text={money(Math.abs(d.amount))} />
                </SummaryRow>
              ))}
              {readyTax.map((t, i) =>
                t.included ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
                  <SummaryRow key={i} label={`Includes ${t.label}`} muted>
                    {money(t.amount)}
                  </SummaryRow>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
                  <SummaryRow key={i} label={t.label}>
                    {money(t.amount)}
                  </SummaryRow>
                ),
              )}
              {typeof shipping === "number" && (
                <SummaryRow label="Shipping">
                  {shipping === 0 ? "Free" : money(shipping)}
                </SummaryRow>
              )}
              <SummaryRow label="Total" strong>
                {hasTotal ? money(total) : <Skeleton className="h-4 w-20" />}
              </SummaryRow>
              {showBalance && typeof amountPaid === "number" && (
                <SummaryRow label="Amount paid">
                  <Negative text={money(amountPaid)} />
                </SummaryRow>
              )}
              {showBalance && owed !== undefined && (
                <SummaryRow label="Amount due" strong>
                  {money(owed)}
                </SummaryRow>
              )}
            </dl>
            {warnings.map((w) => (
              <p
                key={w}
                data-slot="invoice-warning"
                className="flex items-start gap-1.5 text-[13px]"
              >
                <AlertTriangleIcon
                  aria-hidden
                  className="mt-px size-3.5 shrink-0 text-muted-foreground"
                />
                {w}
              </p>
            ))}
            {paymentText && <p className={genuiType.meta}>{paymentText}</p>}
            {hasDetails && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={detailsOpen}
                  aria-controls={detailsId}
                  onClick={() => setDetailsOpen((o) => !o)}
                  className={cn(
                    genuiType.meta,
                    "inline-flex min-h-6 items-center gap-1 self-start rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                  )}
                >
                  Details
                  <ChevronDownIcon
                    aria-hidden
                    className={cn(
                      "size-3.5 shrink-0 transition-transform",
                      detailsOpen && "rotate-180",
                    )}
                  />
                </button>
                <dl
                  id={detailsId}
                  data-slot="invoice-details"
                  hidden={!detailsOpen}
                  className={cn(
                    genuiType.body,
                    "grid-cols-[auto_1fr] gap-x-4 gap-y-2",
                    detailsOpen ? "grid" : "hidden",
                  )}
                >
                  {issuer?.name && (
                    <>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <BuildingIcon
                          aria-hidden
                          className="size-3.5 shrink-0"
                        />
                        From
                      </dt>
                      <dd className="min-w-0 break-words">
                        <PartyText party={issuer} />
                      </dd>
                    </>
                  )}
                  {recipient?.name && (
                    <>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <UserIcon aria-hidden className="size-3.5 shrink-0" />
                        To
                      </dt>
                      <dd className="min-w-0 break-words">
                        <PartyText party={recipient} />
                      </dd>
                    </>
                  )}
                  {showIssued && (
                    <>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <CalendarIcon
                          aria-hidden
                          className="size-3.5 shrink-0"
                        />
                        Issued
                      </dt>
                      <dd>
                        <DateText iso={issuedAt} />
                      </dd>
                    </>
                  )}
                  {reference && (
                    <>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <HashIcon aria-hidden className="size-3.5 shrink-0" />
                        Reference
                      </dt>
                      <dd className="min-w-0 break-all tabular-nums">
                        {reference}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            )}
          </div>
        </AutoHeight>

        <SurfaceFooter className="flex-col items-stretch gap-3">
          <div
            aria-live="polite"
            className={cn("flex flex-col gap-1", done.size === 0 && "sr-only")}
          >
            {[...done.values()].map((r) => (
              <p
                key={r.action}
                className="flex items-start gap-1.5 text-[13px]"
              >
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {CONFIRMATION[r.action]}
                  {r.action === "dispute" && (
                    <span className="text-muted-foreground">
                      : “{r.reason}”
                    </span>
                  )}
                </span>
              </p>
            ))}
          </div>

          {disputing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                autoFocus
                aria-label={`Reason for disputing ${name}`}
                placeholder="What's wrong with it?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    sendDispute();
                  }
                  if (e.key === "Escape") cancelDispute();
                }}
                className="min-h-20"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={cancelDispute}>
                  Cancel
                </Button>
                <WhyDisabled
                  when={!reason.trim() && !busy}
                  reason="Write a reason first"
                >
                  <Button
                    size="sm"
                    onClick={sendDispute}
                    disabled={!reason.trim() || busy}
                  >
                    Send dispute
                  </Button>
                </WhyDisabled>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className={cn(genuiType.meta, "min-w-0")}>
                {streaming ? (
                  <ShimmeringText
                    text={`Loading ${kind ?? "document"}…`}
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                ) : status === "submitting" ? (
                  "Sending…"
                ) : source?.label ? (
                  <>
                    <span className="sr-only">Source: </span>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-6 items-center gap-1 rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {source.label}
                        <ExternalLinkIcon aria-hidden className="size-3" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      source.label
                    )}
                  </>
                ) : null}
              </p>
              {buttons.length > 0 && (
                <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                  {buttons.map((a, i) => {
                    const used = done.has(a);
                    // Primary plus one secondary as text; the rest as icons.
                    if (i >= 2) {
                      const Icon = used ? CheckIcon : ACTION_ICON[a];
                      return (
                        <IconTip key={a} label={actionLabel(a)}>
                          <Button
                            ref={a === "dispute" ? disputeButton : undefined}
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${actionLabel(a)}, ${name}${used ? " (done)" : ""}`}
                            disabled={busy || used}
                            onClick={() =>
                              a === "dispute"
                                ? setDisputing(true)
                                : fire({ action: a })
                            }
                          >
                            <Icon aria-hidden />
                          </Button>
                        </IconTip>
                      );
                    }
                    return (
                      <WhyDisabled
                        key={a}
                        when={used}
                        reason="Already done"
                        className="flex-1 sm:flex-none"
                      >
                        <Button
                          ref={a === "dispute" ? disputeButton : undefined}
                          size="sm"
                          variant={
                            used ? "secondary" : i === 0 ? "default" : "outline"
                          }
                          disabled={busy || used}
                          onClick={() =>
                            a === "dispute"
                              ? setDisputing(true)
                              : fire({ action: a })
                          }
                          className="flex-1 sm:flex-none"
                        >
                          {used && <CheckIcon aria-hidden />}
                          {actionLabel(a)}
                          <span className="sr-only">
                            , {name}
                            {used ? " (done)" : ""}
                          </span>
                        </Button>
                      </WhyDisabled>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  );
}

/** "642 × $0.1238", "Qty 5" or "$12.00 each". Null when neither is given. */
function quantityText(
  line: ReadyLine,
  currency: string | undefined,
  locale: string,
) {
  const qty =
    typeof line.quantity === "number"
      ? new Intl.NumberFormat(locale).format(line.quantity)
      : null;
  const unit =
    typeof line.unitPrice === "number"
      ? formatMoney(line.unitPrice, currency, { precise: true, locale })
      : null;
  if (qty && unit) return `${qty} × ${unit}`;
  if (qty) return `Qty ${qty}`;
  if (unit) return `${unit} each`;
  return null;
}
