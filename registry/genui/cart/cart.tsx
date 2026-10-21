"use client";

import * as React from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number";
import { RadioMark } from "@/components/genui/genui-motion";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import { computeTotals, currencyDigits, lineTotal } from "./cart-totals";
import type {
  CartInput,
  CartItem,
  CartResult,
  ShippingOption,
} from "./cart.schema";
import { IconTip, WhyDisabled } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";

export type CartStatus =
  | "streaming"
  | "ready"
  | "checked_out"
  | "kept_shopping";

type ReadyItem = Partial<CartItem> & {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
};

export type CartProps = Partial<
  Omit<CartInput, "items" | "shipping" | "promo">
> & {
  /** Lines may be partial while the tool call streams. */
  items?: Partial<CartItem>[];
  shipping?: { options?: Partial<ShippingOption>[]; selected?: string };
  promo?: Partial<NonNullable<CartInput["promo"]>>;
  /**
   * Lifecycle, controlled by the host. When omitted, the component tracks the
   * user's decision itself.
   */
  status?: CartStatus;
  /**
   * Called once: checkout (then open your own checkout) or keep_shopping.
   * Never collect payment in chat.
   */
  onResult?: (result: CartResult) => void;
  /**
   * A decision from history (the tool call's stored output). Shows a
   * read-only summary; never calls onResult.
   */
  result?: CartResult;
  className?: string;
};

const DEFAULT_MAX_QUANTITY = 10;

function safeUrl(url?: string) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Image src: http(s), or a same-origin path with a single leading "/". */
function safeImageSrc(url?: string) {
  if (url && /^\/(?![/\\])/.test(url.trim())) return url.trim();
  return safeUrl(url);
}

function moneyFormat(locale: string, currency?: string) {
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency });
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(amount: number, locale: string, currency?: string) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)}${currency ? ` ${currency}` : ""}`;
  }
}

/** A money amount whose digits roll when it changes. */
function AnimatedMoney({
  amount,
  currency,
}: {
  amount: number;
  currency?: string;
}) {
  const locale = useGenUILocale();
  const parts = moneyFormat(locale, currency).formatToParts(amount);
  const isNum = (t: string) =>
    t === "integer" || t === "group" || t === "decimal" || t === "fraction";
  const first = parts.findIndex((p) => isNum(p.type));
  const last =
    parts.length - 1 - [...parts].reverse().findIndex((p) => isNum(p.type));
  const text = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join("");
  const fraction = parts.find((p) => p.type === "fraction")?.value.length ?? 0;

  return (
    <span className="tabular-nums">
      <span className="sr-only">{formatMoney(amount, locale, currency)}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {text(parts.slice(0, first))}
        <SlidingNumber
          number={Math.abs(amount)}
          decimalPlaces={fraction}
          decimalSeparator={
            parts.find((p) => p.type === "decimal")?.value ?? "."
          }
          thousandSeparator={parts.find((p) => p.type === "group")?.value}
          initiallyStable
        />
        {text(parts.slice(last + 1))}
      </span>
    </span>
  );
}

/** A discount shown as a negative amount, read as "minus". */
function Negative({ amount, currency }: { amount: number; currency?: string }) {
  const locale = useGenUILocale();
  const text = formatMoney(amount, locale, currency);
  return (
    <span className="tabular-nums">
      <span aria-hidden>−{text}</span>
      <span className="sr-only">minus {text}</span>
    </span>
  );
}

function ItemImage({ item }: { item: ReadyItem }) {
  const src = safeImageSrc(item.image?.url);
  const [failed, setFailed] = React.useState<string | null>(null);
  const className = "size-14 shrink-0 rounded-lg";

  // No placeholder tile: without a real image the row is just text.
  if (!src || failed === src) return null;
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={item.image?.alt ?? ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn("bg-transparent object-cover", className)}
    />
  );
}

function SummaryRow({
  label,
  children,
  strong,
  note,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  strong?: boolean;
  /** A caption beside the figure on the same baseline; wraps below only when it must. */
  note?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        strong && "pt-2",
      )}
    >
      <dt className={cn(strong ? "font-medium" : "text-muted-foreground")}>
        {label}
      </dt>
      {/* The total is the answer to "ready to check out?", so it leads. */}
      <dd
        className={cn(
          "text-right tabular-nums",
          strong && genuiType.stat,
          note && "flex flex-wrap items-baseline justify-end gap-x-3",
        )}
      >
        {note && (
          <span className={cn(genuiType.meta, "font-sans")}>{note}</span>
        )}
        {children}
      </dd>
    </div>
  );
}

function ItemSkeleton() {
  return (
    <li aria-hidden className="flex gap-3 py-1">
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </li>
  );
}

export function Cart({
  title,
  currency,
  items = [],
  shipping,
  promo,
  taxNote,
  checkoutLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: CartProps) {
  const locale = useGenUILocale();
  const checkedOut = result?.action === "checkout" ? result : null;
  const [quantities, setQuantities] = React.useState<Record<string, number>>(
    () =>
      checkedOut
        ? Object.fromEntries(checkedOut.items.map((i) => [i.id, i.quantity]))
        : {},
  );
  // Restored checkouts list only the lines that were kept.
  const [removed, setRemoved] = React.useState<Set<string>>(() =>
    checkedOut
      ? new Set(
          items
            .map((i) => i.id)
            .filter(
              (id): id is string =>
                typeof id === "string" &&
                !checkedOut.items.some((k) => k.id === id),
            ),
        )
      : new Set(),
  );
  const [shippingId, setShippingId] = React.useState<string | undefined>(
    checkedOut?.shippingId,
  );
  const [decision, setDecision] = React.useState<
    "checked_out" | "kept_shopping" | null
  >(() =>
    result
      ? result.action === "checkout"
        ? "checked_out"
        : "kept_shopping"
      : null,
  );
  const [lastRemoved, setLastRemoved] = React.useState<string | null>(null);
  const [shippingOpen, setShippingOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const undoRef = React.useRef<HTMLButtonElement>(null);
  const uid = React.useId();

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: CartStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const locked = status === "checked_out" || status === "kept_shopping";

  const digits = currencyDigits(currency);
  const money = (amount: number) => formatMoney(amount, locale, currency);

  const ready = items.filter(
    (i): i is ReadyItem =>
      typeof i.id === "string" &&
      typeof i.name === "string" &&
      typeof i.unitPrice === "number" &&
      typeof i.quantity === "number",
  );
  const visible = ready.filter((i) => !removed.has(i.id));
  const maxOf = (i: ReadyItem) =>
    Math.max(1, i.maxQuantity ?? Math.max(DEFAULT_MAX_QUANTITY, i.quantity));
  const qtyOf = (i: ReadyItem) => {
    const q = quantities[i.id] ?? i.quantity;
    return locked ? q : Math.min(maxOf(i), Math.max(1, q));
  };

  const shippingOptions = (shipping?.options ?? []).filter(
    (o): o is ShippingOption =>
      typeof o.id === "string" &&
      typeof o.label === "string" &&
      typeof o.price === "number",
  );
  const selectedShipping =
    shippingOptions.find((o) => o.id === (shippingId ?? shipping?.selected)) ??
    shippingOptions[0];

  const totals = computeTotals(
    visible.map((i) => ({ unitPrice: i.unitPrice, quantity: qtyOf(i) })),
    selectedShipping?.price ?? 0,
    typeof promo?.amount === "number" ? promo.amount : 0,
    digits,
  );
  const empty = !streaming && visible.length === 0;

  // Keyboard focus would be lost with the removed row; put it on Undo.
  React.useEffect(() => {
    if (lastRemoved) undoRef.current?.focus();
  }, [lastRemoved]);

  const setQuantity = (item: ReadyItem, next: number) => {
    if (locked || streaming) return;
    const q = Math.min(maxOf(item), Math.max(1, next));
    setQuantities((prev) => ({ ...prev, [item.id]: q }));
    setLastRemoved(null);
    setMessage(`${item.name}: quantity ${q}.`);
  };
  const remove = (item: ReadyItem) => {
    if (locked || streaming) return;
    setRemoved((prev) => new Set(prev).add(item.id));
    setLastRemoved(item.id);
    setMessage(`Removed ${item.name}.`);
  };
  const undo = () => {
    const item = ready.find((i) => i.id === lastRemoved);
    if (!item) return;
    setRemoved((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    setLastRemoved(null);
    setMessage(`Restored ${item.name}.`);
  };
  const chooseShipping = (option: ShippingOption) => {
    if (locked || streaming) return;
    setShippingId(option.id);
    setShippingOpen(false);
    setLastRemoved(null);
    setMessage(`${option.label} shipping.`);
  };

  const checkout = () => {
    if (locked || streaming || visible.length === 0) return;
    setDecision("checked_out");
    onResult?.({
      action: "checkout",
      items: visible.map((i) => ({ id: i.id, quantity: qtyOf(i) })),
      ...(selectedShipping ? { shippingId: selectedShipping.id } : {}),
      total: totals.total,
    });
  };
  const keepShopping = () => {
    if (locked || streaming) return;
    setDecision("kept_shopping");
    onResult?.({ action: "keep_shopping" });
  };

  const removedItem = lastRemoved
    ? ready.find((i) => i.id === lastRemoved)
    : undefined;
  const showPromo =
    typeof promo?.code === "string" &&
    typeof promo.amount === "number" &&
    totals.discount > 0;
  const announcement = message
    ? `${message} ${empty ? "Your cart is empty." : `Total ${money(totals.total)}.`}`
    : "";

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="cart"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Your cart"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>
            {title ?? (streaming && ready.length === 0 ? "" : "Your cart")}
          </SurfaceTitle>
        </SurfaceHeader>

        <AutoHeight>
          {status === "checked_out" ? (
            // Read-only: what was sent to checkout.
            <>
              <ul
                className={cn(
                  genuiType.body,
                  "flex flex-col gap-1.5 border-t border-border px-3 py-3",
                )}
              >
                {visible.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="min-w-0">
                      <span className="tabular-nums text-muted-foreground">
                        {qtyOf(item)} ×{" "}
                      </span>
                      {item.name}
                      {item.variant && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {item.variant}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {money(
                        lineTotal(
                          { unitPrice: item.unitPrice, quantity: qtyOf(item) },
                          digits,
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <dl
                className={cn(
                  genuiType.body,
                  "flex flex-col gap-1 border-t border-border px-3 py-3",
                )}
              >
                {selectedShipping && (
                  <SummaryRow label={`Shipping · ${selectedShipping.label}`}>
                    {selectedShipping.price === 0
                      ? "Free"
                      : money(selectedShipping.price)}
                  </SummaryRow>
                )}
                {showPromo && (
                  <SummaryRow label={`Discount (${promo?.code})`}>
                    <Negative amount={totals.discount} currency={currency} />
                  </SummaryRow>
                )}
                <SummaryRow label="Total" strong>
                  {money(checkedOut ? checkedOut.total : totals.total)}
                </SummaryRow>
              </dl>
            </>
          ) : (
            <>
              <div className="border-t border-border">
                <ul
                  aria-label="Items"
                  className="flex flex-col gap-3 px-3 py-3"
                >
                  {visible.map((item) => {
                    const q = qtyOf(item);
                    return (
                      <motion.li
                        key={item.id}
                        data-slot="cart-item"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={genuiMotion.fade}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2"
                      >
                        <ItemImage item={item} />
                        <div className="flex min-w-0 flex-[1_1_10rem] flex-col">
                          <span className={cn(genuiType.title, "leading-snug")}>
                            {item.name}
                          </span>
                          {/* One quiet line: variant, plus unit price once it differs from the line. */}
                          {(item.variant || q > 1) && (
                            <span
                              className={cn(genuiType.meta, "tabular-nums")}
                            >
                              {[
                                item.variant,
                                q > 1 ? `${money(item.unitPrice)} each` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
                        <fieldset
                          aria-label={`Quantity of ${item.name}`}
                          className="m-0 flex shrink-0 items-center gap-1.5 border-0 p-0"
                        >
                          <WhyDisabled
                            reason={
                              !(locked || streaming) &&
                              q <= 1 &&
                              "Minimum quantity"
                            }
                          >
                            <IconTip
                              label={`Decrease quantity of ${item.name}`}
                            >
                              <Button
                                size="icon-sm"
                                variant="secondary"
                                aria-label={`Decrease quantity of ${item.name}`}
                                disabled={locked || streaming || q <= 1}
                                onClick={() => setQuantity(item, q - 1)}
                              >
                                <MinusIcon />
                              </Button>
                            </IconTip>
                          </WhyDisabled>
                          <span
                            className={cn(
                              "inline-flex min-w-8 justify-center font-figure text-[24px] leading-none font-normal tabular-nums",
                            )}
                          >
                            <span className="sr-only">{q}</span>
                            <SlidingNumber
                              aria-hidden
                              number={q}
                              initiallyStable
                            />
                          </span>
                          <WhyDisabled
                            reason={
                              !(locked || streaming) &&
                              q >= maxOf(item) &&
                              "Maximum quantity"
                            }
                          >
                            <IconTip
                              label={`Increase quantity of ${item.name}`}
                            >
                              <Button
                                size="icon-sm"
                                variant="secondary"
                                aria-label={`Increase quantity of ${item.name}`}
                                disabled={
                                  locked || streaming || q >= maxOf(item)
                                }
                                onClick={() => setQuantity(item, q + 1)}
                              >
                                <PlusIcon />
                              </Button>
                            </IconTip>
                          </WhyDisabled>
                        </fieldset>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              genuiType.body,
                              "min-w-16 text-right font-medium tabular-nums",
                            )}
                          >
                            <span className="sr-only">Line total </span>
                            <AnimatedMoney
                              amount={lineTotal(
                                { unitPrice: item.unitPrice, quantity: q },
                                digits,
                              )}
                              currency={currency}
                            />
                          </span>
                          <IconTip label={`Remove ${item.name}`}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Remove ${item.name}`}
                              disabled={locked || streaming}
                              onClick={() => remove(item)}
                            >
                              <Trash2Icon />
                            </Button>
                          </IconTip>
                        </div>
                      </motion.li>
                    );
                  })}
                  {streaming && <ItemSkeleton />}
                </ul>
              </div>

              {removedItem && !locked && (
                <div
                  className={cn(
                    genuiType.body,
                    "flex items-center justify-between gap-3 border-t border-border px-3 py-3 text-muted-foreground",
                  )}
                >
                  <span className="min-w-0 truncate">
                    Removed {removedItem.name}
                  </span>
                  <Button
                    ref={undoRef}
                    size="sm"
                    variant="secondary"
                    aria-label={`Undo removing ${removedItem.name}`}
                    onClick={undo}
                  >
                    Undo
                  </Button>
                </div>
              )}

              {empty ? (
                <p
                  className={cn(
                    genuiType.body,
                    "border-t border-border px-3 py-6 text-center text-muted-foreground",
                  )}
                >
                  Cart is empty
                </p>
              ) : (
                <>
                  {shippingOptions.length > 0 && selectedShipping && (
                    <fieldset
                      disabled={locked || streaming}
                      className="m-0 flex min-w-0 flex-col gap-2 border-0 border-t border-border px-3 py-3"
                    >
                      <legend className="sr-only">Shipping</legend>
                      {/* Collapsed: the chosen method on one row. Expanded: every method. */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                          <span className={genuiType.label}>Shipping</span>
                          <span className={cn(genuiType.body, "truncate")}>
                            {selectedShipping.label}
                            {selectedShipping.eta && (
                              <span className="text-muted-foreground">
                                {" "}
                                · {selectedShipping.eta}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className={cn(genuiType.body, "tabular-nums")}>
                            {selectedShipping.price === 0
                              ? "Free"
                              : money(selectedShipping.price)}
                          </span>
                          {shippingOptions.length > 1 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-expanded={shippingOpen}
                              aria-controls={`${uid}-shipping-options`}
                              disabled={locked || streaming}
                              onClick={() => setShippingOpen((o) => !o)}
                              className="hover:bg-muted dark:hover:bg-white/10"
                            >
                              Change
                              <ChevronDownIcon
                                aria-hidden
                                className={cn(
                                  "transition-transform",
                                  shippingOpen && "rotate-180",
                                )}
                              />
                            </Button>
                          )}
                        </div>
                      </div>
                      {shippingOpen && shippingOptions.length > 1 && (
                        <div
                          id={`${uid}-shipping-options`}
                          className="flex flex-col gap-2"
                        >
                          {shippingOptions.map((o) => {
                            const checked = o.id === selectedShipping.id;
                            return (
                              <label
                                key={o.id}
                                className={cn(
                                  "flex items-center gap-3 rounded-[10px] border border-border px-3 py-2 transition-colors",
                                  !locked &&
                                    !streaming &&
                                    "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
                                  checked &&
                                    "border-choice ring-2 ring-choice ring-inset hover:bg-transparent dark:hover:bg-transparent",
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`${uid}-shipping`}
                                  value={o.id}
                                  checked={checked}
                                  onChange={() => chooseShipping(o)}
                                  className="peer sr-only"
                                />
                                <RadioMark
                                  checked={checked}
                                  className="peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-60"
                                />
                                <span className="flex min-w-0 flex-1 flex-col">
                                  <span className={genuiType.body}>
                                    {o.label}
                                  </span>
                                  {o.eta && (
                                    <span className={genuiType.meta}>
                                      {o.eta}
                                    </span>
                                  )}
                                </span>
                                <span
                                  className={cn(
                                    genuiType.body,
                                    "shrink-0 tabular-nums",
                                  )}
                                >
                                  {o.price === 0 ? "Free" : money(o.price)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </fieldset>
                  )}

                  {visible.length > 0 && (
                    <div className="border-t border-border px-3 py-3">
                      <dl className={cn(genuiType.body, "flex flex-col gap-1")}>
                        <SummaryRow label="Subtotal">
                          <AnimatedMoney
                            amount={totals.subtotal}
                            currency={currency}
                          />
                        </SummaryRow>
                        {showPromo && (
                          <SummaryRow label={`Discount (${promo?.code})`}>
                            <Negative
                              amount={totals.discount}
                              currency={currency}
                            />
                          </SummaryRow>
                        )}
                        <SummaryRow label="Total" strong note={taxNote}>
                          <AnimatedMoney
                            amount={totals.total}
                            currency={currency}
                          />
                        </SummaryRow>
                      </dl>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </AutoHeight>

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <SurfaceFooter aria-live="polite">
          {streaming ? (
            <ShimmeringText
              text="Loading cart…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px]"
            />
          ) : status === "checked_out" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4" />
              Sent to checkout
            </p>
          ) : status === "kept_shopping" ? (
            <p className={cn(genuiType.body, "text-muted-foreground")}>
              Kept shopping. Nothing sent.
            </p>
          ) : (
            <div className="flex w-full items-center justify-between gap-2">
              <Button size="sm" variant="secondary" onClick={keepShopping}>
                Keep shopping
              </Button>
              <WhyDisabled reason={empty && "Add an item first"}>
                <Button size="sm" disabled={empty} onClick={checkout}>
                  {checkoutLabel ?? "Continue to checkout"}
                </Button>
              </WhyDisabled>
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  );
}
