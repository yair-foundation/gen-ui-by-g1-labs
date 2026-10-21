"use client"

import * as React from "react"
import {
  CheckIcon,
  CoffeeIcon,
  HashIcon,
  type LucideIcon,
  MinusIcon,
  PackageIcon,
  PaletteIcon,
  PlusIcon,
  RulerIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  StarIcon,
  TagIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  currencyDigits,
  isValueAvailable,
  priceFor,
  resolveVariant,
  type Selection,
} from "./product-options-variants"
import type {
  OptionGroup,
  OptionValue,
  Product,
  ProductOptionsInput,
  ProductOptionsResult,
  ProductVariant,
} from "./product-options.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type ProductOptionsStatus = "streaming" | "ready" | "added" | "cancelled"

type PartialGroup = Partial<Omit<OptionGroup, "values">> & {
  values?: Partial<OptionValue>[]
}
type ReadyGroup = { id: string; label: string; values: OptionValue[] }

export type ProductOptionsProps = Partial<
  Omit<ProductOptionsInput, "product" | "options" | "variants">
> & {
  /** Fields may be partial while the tool call streams. */
  product?: Partial<Product>
  options?: PartialGroup[]
  variants?: Partial<ProductVariant>[]
  /**
   * Lifecycle, controlled by the host. When omitted, the component tracks the
   * user's decision itself.
   */
  status?: ProductOptionsStatus
  /** Called once: add_to_cart with the chosen options, or cancel. */
  onResult?: (result: ProductOptionsResult) => void
  /**
   * A decision from history (the tool call's stored output). Shows the chosen
   * options and the outcome; never calls onResult.
   */
  result?: ProductOptionsResult
  className?: string
}

/** An icon for an option group, guessed from its id or label. */
function groupIcon(group: ReadyGroup): LucideIcon {
  const key = `${group.id} ${group.label}`.toLowerCase()
  if (/colou?r|shade|finish/.test(key)) return PaletteIcon
  if (/grind|roast|brew/.test(key)) return CoffeeIcon
  if (/bag|pack|weight|volume|amount/.test(key)) return PackageIcon
  if (/size|fit|length|width/.test(key)) return RulerIcon
  return SlidersHorizontalIcon
}

/** A section label with its icon. */
function SectionLabel({
  icon: Icon,
  id,
  children,
}: {
  icon: LucideIcon
  id?: string
  children: React.ReactNode
}) {
  return (
    <span id={id} className={cn(genuiType.label, "flex items-center gap-1.5")}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </span>
  )
}

const DEFAULT_MAX_QUANTITY = 10
const LOW_STOCK = 5

function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** Image src: http(s), or a same-origin path with a single leading "/". */
function safeImageSrc(url?: string) {
  if (url && /^\/(?![/\\])/.test(url.trim())) return url.trim()
  return safeUrl(url)
}

function moneyFormat(currency: string | undefined, locale: string) {
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency })
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatMoney(
  amount: number,
  currency: string | undefined,
  locale: string,
) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount)
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)}${currency ? ` ${currency}` : ""}`
  }
}

/** "+$9.50" or "−$2.00" for a price delta. */
function formatDelta(
  delta: number,
  currency: string | undefined,
  locale: string,
) {
  return `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta), currency, locale)}`
}

function joinAnd(words: string[]) {
  if (words.length <= 1) return words.join("")
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

/** A money amount whose digits roll when it changes. */
function AnimatedMoney({
  amount,
  currency,
}: {
  amount: number
  currency?: string
}) {
  const locale = useGenUILocale()
  const parts = moneyFormat(currency, locale).formatToParts(amount)
  const isNum = (t: string) =>
    t === "integer" || t === "group" || t === "decimal" || t === "fraction"
  const first = parts.findIndex((p) => isNum(p.type))
  const last =
    parts.length - 1 - [...parts].reverse().findIndex((p) => isNum(p.type))
  const text = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join("")
  const fraction = parts.find((p) => p.type === "fraction")?.value.length ?? 0

  return (
    <span className="tabular-nums">
      <span className="sr-only">{formatMoney(amount, currency, locale)}</span>
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
  )
}

function ProductImage({ product }: { product: Partial<Product> }) {
  const src = safeImageSrc(product.image?.url)
  const [failed, setFailed] = React.useState<string | null>(null)
  const className = "size-32 shrink-0 rounded-[14px]"

  if (!product.name) return <Skeleton className={className} />
  if (!src || failed === src) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex items-center justify-center border border-border bg-transparent text-[32px] leading-none font-medium text-muted-foreground select-none",
          className,
        )}
      >
        {product.name.trim().charAt(0).toUpperCase()}
      </div>
    )
  }
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={product.image?.alt ?? ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn("bg-muted object-cover", className)}
    />
  )
}

function Rating({ rating }: { rating: NonNullable<Product["rating"]> }) {
  const locale = useGenUILocale()
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rating.value)
  const count =
    typeof rating.count === "number"
      ? new Intl.NumberFormat(locale).format(rating.count)
      : null
  return (
    <span
      className={cn(genuiType.meta, "flex items-center gap-1 tabular-nums")}
    >
      <span aria-hidden className="flex items-center gap-1">
        <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
        <span className="font-medium text-foreground">{value}</span>
        {count !== null && ` (${count})`}
      </span>
      <span className="sr-only">
        {`Rated ${value} out of 5`}
        {count !== null &&
          ` from ${count} ${rating.count === 1 ? "review" : "reviews"}`}
      </span>
    </span>
  )
}

function OptionGroupControl({
  group,
  name,
  selected,
  disabled,
  currency,
  isAvailable,
  onSelect,
}: {
  group: ReadyGroup
  name: string
  selected: string | undefined
  disabled: boolean
  currency?: string
  isAvailable: (value: string) => boolean
  onSelect: (value: string) => void
}) {
  const locale = useGenUILocale()
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="border-t border-border px-3 py-3"
    >
      <fieldset
        disabled={disabled}
        className="m-0 flex min-w-0 items-start gap-3 border-0 p-0"
      >
        <legend className="sr-only">{group.label}</legend>
        {/* The label sits beside its options, centred on the first row. */}
        <span aria-hidden className="flex h-8 w-24 shrink-0 items-center">
          <SectionLabel icon={groupIcon(group)}>{group.label}</SectionLabel>
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {group.values.map((v) => {
            const available = isAvailable(v.value)
            const checked = v.value === selected
            return (
              <label
                key={v.value}
                className={cn(
                  "inline-flex min-h-8 min-w-11 items-center justify-center gap-1.5 rounded-full border border-border bg-transparent px-3.5 py-1.5 text-[13px] leading-5 transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  !disabled && available && "cursor-pointer hover:bg-accent",
                  checked && "ring-2 ring-choice ring-inset dark:bg-accent",
                  !available &&
                    "cursor-not-allowed border-transparent bg-transparent text-muted-foreground/45 dark:border-transparent",
                  disabled && !checked && "opacity-60",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={v.value}
                  checked={checked}
                  disabled={!available}
                  onChange={() => onSelect(v.value)}
                  className="sr-only"
                />
                {v.swatch && (
                  <span
                    aria-hidden
                    style={{ backgroundColor: v.swatch }}
                    className={cn(
                      "size-3.5 shrink-0 rounded-full ring-1 ring-foreground/20 ring-inset",
                      !available && "opacity-45",
                    )}
                  />
                )}
                {v.label}
                {typeof v.priceDelta === "number" && v.priceDelta !== 0 && (
                  <span className="text-[13px] leading-4 tabular-nums text-muted-foreground">
                    {formatDelta(v.priceDelta, currency, locale)}
                  </span>
                )}
                {!available && <span className="sr-only">, out of stock</span>}
              </label>
            )
          })}
        </div>
      </fieldset>
    </motion.div>
  )
}

function GroupSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col gap-2 border-t border-border px-3 py-3"
    >
      <Skeleton className="h-4 w-20" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-12 rounded-full" />
        <Skeleton className="h-8 w-12 rounded-full" />
        <Skeleton className="h-8 w-12 rounded-full" />
      </div>
    </div>
  )
}

export function ProductOptions({
  product = {},
  options = [],
  variants,
  quantity,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: ProductOptionsProps) {
  const locale = useGenUILocale()
  const [picked, setPicked] = React.useState<Selection>(() =>
    result?.action === "add_to_cart" ? result.options : {},
  )
  const [qty, setQty] = React.useState<number | undefined>(() =>
    result?.action === "add_to_cart" ? result.quantity : undefined,
  )
  const [decision, setDecision] = React.useState<"added" | "cancelled" | null>(
    () =>
      result ? (result.action === "add_to_cart" ? "added" : "cancelled") : null,
  )
  const [touched, setTouched] = React.useState(false)
  const uid = React.useId()
  const quantityId = `${uid}-quantity`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: ProductOptionsStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status === "added" || status === "cancelled"

  const groups = options
    .filter(
      (g): g is PartialGroup & { id: string; label: string } =>
        typeof g.id === "string" && typeof g.label === "string",
    )
    .map((g): ReadyGroup => ({
      id: g.id,
      label: g.label,
      values: (g.values ?? []).filter(
        (v): v is OptionValue =>
          typeof v.value === "string" && typeof v.label === "string",
      ),
    }))
  // Partial variants would disable values that are only still streaming.
  const readyVariants = streaming
    ? undefined
    : variants?.filter(
        (v): v is ProductVariant =>
          typeof v.id === "string" &&
          typeof v.available === "boolean" &&
          typeof v.options === "object" &&
          v.options !== null,
      )

  // A group with a single in-stock value is chosen for the user.
  const selection: Selection = {}
  for (const g of groups) {
    if (picked[g.id] !== undefined) selection[g.id] = picked[g.id]
    else if (g.values.length === 1 && g.values[0].available !== false) {
      selection[g.id] = g.values[0].value
    }
  }

  const state = resolveVariant(groups, readyVariants, selection)
  const stock = state.kind === "available" ? state.stock : undefined
  const lowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK

  const qMin = Math.max(1, quantity?.min ?? 1)
  const qMax = Math.max(
    qMin,
    Math.min(
      Math.max(qMin, quantity?.max ?? DEFAULT_MAX_QUANTITY),
      stock ?? Number.POSITIVE_INFINITY,
    ),
  )
  const count = locked
    ? (qty ?? qMin)
    : Math.min(qMax, Math.max(qMin, qty ?? quantity?.default ?? qMin))

  const currency = product.price?.currency
  const digits = currencyDigits(currency)
  const hasPrice =
    typeof product.price?.amount === "number" && typeof currency === "string"
  const price = hasPrice
    ? priceFor(product.price?.amount ?? 0, groups, selection, count, digits)
    : null
  // The was-price for the whole line, so it reads against the total beside it.
  const compareAt =
    hasPrice &&
    typeof product.compareAt?.amount === "number" &&
    product.compareAt.amount > (product.price?.amount ?? 0)
      ? priceFor(product.compareAt.amount, groups, selection, count, digits)
          .total
      : null

  const canAdd =
    !locked &&
    !streaming &&
    typeof product.id === "string" &&
    groups.length > 0 &&
    state.kind === "available"

  const select = (groupId: string, value: string) => {
    if (locked || streaming) return
    setPicked((prev) => ({ ...prev, [groupId]: value }))
    setTouched(true)
  }
  const nudge = (dir: 1 | -1) => {
    setQty(Math.min(qMax, Math.max(qMin, count + dir)))
    setTouched(true)
  }

  const add = () => {
    if (!canAdd || typeof product.id !== "string") return
    setDecision("added")
    onResult?.({
      action: "add_to_cart",
      productId: product.id,
      ...(state.kind === "available" && state.variant
        ? { variantId: state.variant.id }
        : {}),
      options: Object.fromEntries(groups.map((g) => [g.id, selection[g.id]])),
      quantity: count,
    })
  }
  const cancel = () => {
    if (locked || streaming) return
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  const missing =
    state.kind === "incomplete"
      ? groups
          .filter((g) => state.missing.includes(g.id))
          .map((g) => g.label.toLowerCase())
      : []
  const hint =
    state.kind === "incomplete"
      ? `Choose ${joinAnd(missing)}`
      : state.kind === "unavailable"
        ? "Out of stock"
        : null

  const announcement =
    touched && price
      ? `Total ${formatMoney(price.total, currency, locale)}${lowStock ? `. Only ${stock} left` : ""}`
      : ""

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="product-options"
        data-status={status}
        aria-busy={streaming}
        aria-label={product.name ?? "Product options"}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-4 pb-3">
          <ProductImage product={product} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SurfaceTitle className="text-[16px] leading-snug">
              {product.name}
            </SurfaceTitle>
            {product.rating && typeof product.rating.value === "number" && (
              <Rating rating={product.rating} />
            )}
            {compareAt !== null && price && (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[13px] font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
                <TagIcon aria-hidden className="size-3.5" />
                Save {formatMoney(compareAt - price.total, currency, locale)}
              </span>
            )}
          </div>
        </SurfaceHeader>

        <AutoHeight>
          {status === "added" ? (
            // The decision, read-only: what went into the cart.
            <dl className="flex flex-col divide-y divide-border border-t border-border px-3 text-[13px] leading-5">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-4 py-2.5"
                >
                  <dt className="text-muted-foreground">{g.label}</dt>
                  <dd className="font-medium">
                    {g.values.find((v) => v.value === selection[g.id])?.label ??
                      selection[g.id]}
                  </dd>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-4 py-2.5">
                <dt className="text-muted-foreground">Quantity</dt>
                <dd className="font-medium tabular-nums">{count}</dd>
              </div>
            </dl>
          ) : (
            <div className="flex flex-col">
              {groups.map((g) => (
                <OptionGroupControl
                  key={g.id}
                  group={g}
                  name={`${uid}-${g.id}`}
                  selected={selection[g.id]}
                  disabled={locked || streaming}
                  currency={currency}
                  isAvailable={(value) =>
                    isValueAvailable(
                      groups,
                      readyVariants,
                      selection,
                      g.id,
                      value,
                    )
                  }
                  onSelect={(value) => select(g.id, value)}
                />
              ))}
              {streaming && <GroupSkeleton />}

              {!streaming && groups.length > 0 && (
                <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-3">
                  <div className="flex flex-col">
                    <SectionLabel icon={HashIcon} id={quantityId}>
                      Quantity
                    </SectionLabel>
                    {lowStock && (
                      <span
                        className={cn(
                          genuiType.meta,
                          "flex items-center gap-1 text-orange-700 dark:text-orange-400",
                        )}
                      >
                        <TriangleAlertIcon aria-hidden className="size-3.5" />
                        Only {stock} left
                      </span>
                    )}
                  </div>
                  <fieldset
                    aria-labelledby={quantityId}
                    className="m-0 flex min-w-0 items-center gap-1 border-0 p-0"
                  >
                    <WhyDisabled
                      when={locked || count <= qMin}
                      reason="Minimum reached"
                    >
                      <IconTip label="Decrease quantity">
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label="Decrease quantity"
                          disabled={locked || count <= qMin}
                          onClick={() => nudge(-1)}
                        >
                          <MinusIcon />
                        </Button>
                      </IconTip>
                    </WhyDisabled>
                    <span
                      aria-live="polite"
                      className="flex min-w-10 justify-center text-[24px] leading-none font-normal tracking-tight tabular-nums"
                    >
                      <span className="sr-only">{count}</span>
                      <span aria-hidden>
                        <SlidingNumber number={count} initiallyStable />
                      </span>
                    </span>
                    <WhyDisabled
                      when={locked || count >= qMax}
                      reason="Maximum reached"
                    >
                      <IconTip label="Increase quantity">
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label="Increase quantity"
                          disabled={locked || count >= qMax}
                          onClick={() => nudge(1)}
                        >
                          <PlusIcon />
                        </Button>
                      </IconTip>
                    </WhyDisabled>
                  </fieldset>
                </div>
              )}
            </div>
          )}

          {price && !streaming && status !== "cancelled" && (
            // The one price on the card: the line total, with the deal under it.
            <div className="flex items-end justify-between gap-4 border-t border-border px-3 py-3">
              <div className="flex flex-col gap-1">
                <SectionLabel icon={ShoppingBagIcon}>Total</SectionLabel>
                {count > 1 && (
                  <span className={cn(genuiType.meta, "tabular-nums")}>
                    {count} × {formatMoney(price.unit, currency, locale)}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                {compareAt !== null && (
                  <span
                    className={cn(
                      genuiType.meta,
                      "tabular-nums line-through decoration-muted-foreground/60",
                    )}
                  >
                    <span className="sr-only">Was </span>
                    {formatMoney(compareAt, currency, locale)}
                  </span>
                )}
                <span className={genuiType.stat}>
                  <AnimatedMoney amount={price.total} currency={currency} />
                </span>
              </div>
            </div>
          )}
          {streaming && (
            <div
              aria-hidden
              className="flex justify-end border-t border-border px-3 py-3"
            >
              <Skeleton className="h-8 w-28" />
            </div>
          )}
        </AutoHeight>

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <SurfaceFooter aria-live="polite">
          {streaming ? (
            <ShimmeringText
              text="Loading options…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px] leading-4"
            />
          ) : status === "added" ? (
            <p className="flex items-center gap-1.5 text-[13px] leading-5">
              <CheckIcon aria-hidden className="size-4" />
              Added to cart
            </p>
          ) : status === "cancelled" ? (
            <p className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <XIcon aria-hidden className="size-4" />
              Cancelled
            </p>
          ) : (
            <>
              {hint && groups.length > 0 && (
                <p className={genuiType.meta}>{hint}</p>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={cancel}>
                  Cancel
                </Button>
                <WhyDisabled when={!canAdd} reason="Choose your options first">
                  <Button size="sm" disabled={!canAdd} onClick={add}>
                    <ShoppingBagIcon aria-hidden />
                    {submitLabel ?? "Add to cart"}
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
