"use client"

import * as React from "react"
import { Menu } from "@base-ui/react/menu"
import { CheckIcon, EllipsisIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/genui/date-picker"
import {
  FormField,
  FormFieldGroup,
  formDateClass,
  formInputClass,
  formPrimaryClass,
  formTextareaClass,
} from "@/components/genui/form-field"
import { Textarea } from "@/components/ui/textarea"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { RadioMark } from "@/components/genui/genui-motion"

import {
  type AmountIssue,
  amountIssueText,
  clampMessage,
  currencyDigits,
  currencySymbol,
  dayKeyIn,
  deliveryText,
  encodeQr,
  expiryText,
  formatMoney,
  fromMinor,
  type GiftCardPattern,
  initialsOf,
  isValidEmail,
  maskedNumber,
  matrixToPath,
  messageCounter,
  patternFor,
  QUIET_ZONE,
  spokenNumber,
  splitMoney,
  toMinor,
  validateAmount,
} from "./gift-card-utils"
import type {
  GiftCardBrand,
  GiftCardCard,
  GiftCardDesign,
  GiftCardInput,
  GiftCardResult,
  GiftCardSend,
} from "./gift-card.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type GiftCardStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "done"
  | "sent"
  | "dismissed"

type BalanceAction = "add-to-wallet" | "refresh"
type SendResult = Extract<GiftCardResult, { action: "send" }>
type SendDecision = Extract<GiftCardResult, { action: "send" | "dismiss" }>

type PartialCard = Partial<Omit<GiftCardCard, "code" | "pin">> & {
  code?: { format?: "qr"; value?: string }
  pin?: { masked?: true }
}

type PartialSend = Partial<
  Omit<GiftCardSend, "amounts" | "designs" | "recipient" | "custom">
> & {
  amounts?: number[]
  designs?: Partial<GiftCardDesign>[]
  recipient?: { name?: string; email?: string }
  custom?: { min?: number; max?: number }
}

export type GiftCardProps = Partial<
  Omit<GiftCardInput, "brand" | "card" | "send">
> & {
  /** Everything may be partial while the tool call streams. */
  brand?: Partial<GiftCardBrand>
  card?: PartialCard
  send?: PartialSend
  /**
   * The moment expiry ("Expires today") and the earliest delivery date are
   * measured from. Defaults to the viewer's clock, read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's decision itself.
   */
  status?: GiftCardStatus
  /**
   * Balance mode: called once per action (add-to-wallet, refresh). Send mode:
   * called once with send or dismiss. Send is a handoff to your payment flow.
   */
  onResult?: (result: GiftCardResult) => void
  /** Results from history (one or several). Renders the finished state; never calls onResult. */
  result?: GiftCardResult | GiftCardResult[]
  className?: string
}

type ViewProps = Omit<GiftCardProps, "mode">

const BALANCE_DONE: Record<BalanceAction, string> = {
  "add-to-wallet": "Opening your wallet…",
  refresh: "Checking the balance again…",
}

const toArray = (r: GiftCardResult | GiftCardResult[] | undefined) =>
  r === undefined ? [] : Array.isArray(r) ? r : [r]

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
function resolveNow(now: Date | string | number | undefined): number | null {
  if (now === undefined) return null
  const t = typeof now === "string" ? Date.parse(now) : new Date(now).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * The current time: the host's `now`, or the viewer's clock read once after
 * mount (so server and client render the same markup).
 */
function useNow(fixed: number | null) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (fixed === null) setNow(Date.now())
  }, [fixed])
  return fixed ?? now
}

/**
 * An amount whose digits roll when it changes (the card preview), with its
 * currency symbol. Cents only when there are any, like `formatMoney`'s
 * `trimZeroCents`. Screen readers get the plain text.
 */
function AmountRoll({
  amount,
  currency,
  className,
}: {
  amount: number
  currency?: string
  className?: string
}) {
  const locale = useGenUILocale()
  const digits = currencyDigits(currency)
  const decimals = toMinor(amount, digits) % 10 ** digits === 0 ? 0 : digits
  let parts: Intl.NumberFormatPart[] = []
  try {
    parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).formatToParts(amount)
  } catch {
    // Unknown currency code while streaming.
  }
  const text = formatMoney(amount, currency, { trimZeroCents: true, locale })
  const first = parts.findIndex((p) => p.type === "integer")
  const last = parts.findLastIndex((p) =>
    ["integer", "group", "decimal", "fraction"].includes(p.type),
  )
  if (first < 0) return <span className={className}>{text}</span>
  const join = (from: Intl.NumberFormatPart[]) =>
    from.map((p) => p.value).join("")
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {join(parts.slice(0, first))}
        <SlidingNumber
          number={amount}
          decimalPlaces={decimals}
          thousandSeparator={
            parts.find((p) => p.type === "group")?.value ?? ","
          }
          decimalSeparator={
            parts.find((p) => p.type === "decimal")?.value ?? "."
          }
          initiallyStable
        />
        {join(parts.slice(last + 1))}
      </span>
    </span>
  )
}

/** An amount with dimmed cents. Screen readers get the plain text. */
function Money({
  amount,
  currency,
  className,
}: {
  amount: number
  currency?: string
  className?: string
}) {
  const locale = useGenUILocale()
  const parts = splitMoney(amount, currency, locale)
  return (
    <span className={cn("tabular-nums", className)}>
      <span className="sr-only">{parts.text}</span>
      <span aria-hidden>
        {parts.lead}
        {parts.cents && (
          <span className="text-muted-foreground">{parts.cents}</span>
        )}
        {parts.trail}
      </span>
    </span>
  )
}

/** A neutral pattern drawn with thin lines in the border color. Decorative. */
/** Design artwork: http(s), or a same-origin path with a single leading slash. */
const safeArt = (src?: string) =>
  src && (/^https?:\/\//i.test(src) || /^\/(?!\/)/.test(src)) ? src : undefined

/** Type set straight on artwork: white with a soft shadow, over a scrim, so it reads on any picture. */
const ON_ART = "text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.55)]"

/** A design's artwork, covering its box; nothing when it has none or it fails to load. */
function ArtFill({ src }: { src: string }) {
  const [failed, setFailed] = React.useState(false)
  if (failed) return null
  return (
    // biome-ignore lint/performance/noImgElement: store-provided artwork; next/image would need every host configured
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="pointer-events-none absolute inset-0 size-full object-cover"
    />
  )
}

function PatternFill({ pattern }: { pattern: GiftCardPattern }) {
  const raw = React.useId()
  const id = `gc-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`
  if (pattern === "plain") return null
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full text-border"
    >
      <defs>
        {pattern === "stripes" ? (
          <pattern
            id={id}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="8"
              stroke="currentColor"
              strokeWidth="2"
            />
          </pattern>
        ) : pattern === "dots" ? (
          <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="5" cy="5" r="1.5" fill="currentColor" />
          </pattern>
        ) : (
          <pattern id={id} width="12" height="12" patternUnits="userSpaceOnUse">
            <path
              d="M12 0H0V12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </pattern>
        )}
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/** The card itself: neutral, card-shaped, brand initials and name on top. */
function CardTile({
  initials,
  name,
  pattern = "plain",
  art,
  children,
  className,
}: {
  initials: string
  name?: string
  pattern?: GiftCardPattern
  /** The design's artwork; replaces the pattern. */
  art?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[1.586/1] w-full max-w-72 flex-col justify-between overflow-hidden rounded-[10px] border border-border bg-background p-3",
        className,
      )}
    >
      {art ? (
        <>
          <ArtFill src={art} />
          {/* Darkens the top and bottom edges where the type sits. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/45 via-transparent to-black/55"
          />
        </>
      ) : (
        <PatternFill pattern={pattern} />
      )}
      <div className="relative flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold",
            art
              ? cn("border-white/60 bg-transparent", ON_ART)
              : "border-border bg-transparent",
          )}
        >
          {initials}
        </span>
        {name ? (
          <span
            className={cn(
              "min-w-0 truncate text-[13px] font-medium",
              art ? ON_ART : "rounded-sm bg-background",
            )}
          >
            {name}
          </span>
        ) : (
          <Skeleton className="h-4 w-28" />
        )}
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Balance mode

function BalanceView({
  brand,
  card,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: ViewProps) {
  const locale = useGenUILocale()
  const [done, setDone] = React.useState<Set<BalanceAction>>(
    () =>
      new Set(
        toArray(result)
          .map((r) => r.action)
          .filter(
            (a): a is BalanceAction => a === "add-to-wallet" || a === "refresh",
          ),
      ),
  )
  const [showCode, setShowCode] = React.useState(false)
  const uid = React.useId()

  // A host-provided "ready" (or nothing) yields to the user's actions.
  const status: GiftCardStatus =
    done.size > 0 && (statusProp === undefined || statusProp === "ready")
      ? "done"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const now = useNow(resolveNow(nowProp))

  const codeValue = !streaming ? card?.code?.value : undefined
  const modules = React.useMemo(
    () => (codeValue ? encodeQr(codeValue) : null),
    [codeValue],
  )
  const path = React.useMemo(
    () => (modules ? matrixToPath(modules) : ""),
    [modules],
  )
  const dim = modules ? modules.length + QUIET_ZONE * 2 : 0

  const storeCredit = card?.kind === "store-credit"
  const kindLabel = storeCredit ? "Store credit" : "Gift card"
  const expiry = expiryText(card?.expiresAt, now, { locale })
  const hasBalance =
    typeof card?.balance === "number" && typeof card.currency === "string"
  const context = `${brand?.name ?? "store"} ${kindLabel.toLowerCase()}`
  const hasCode = !!card?.code && !streaming
  const lastDone = [...done].at(-1)

  const fire = (action: BalanceAction) => {
    if (busy || done.has(action)) return
    setDone((prev) => new Set(prev).add(action))
    onResult?.({ action })
  }

  const actions: { id: BalanceAction; label: string }[] = [
    { id: "add-to-wallet", label: "Add to wallet" },
    { id: "refresh", label: "Check balance again" },
  ]
  // The code toggle leads when there is one; the rest go in "More".
  const visible = hasCode ? actions.slice(0, 1) : actions
  const overflow = hasCode ? actions.slice(1) : []

  return (
    <Surface
      data-slot="gift-card"
      data-status={status}
      data-mode="balance"
      aria-busy={busy}
      aria-label={
        brand?.name ? `${brand.name} ${kindLabel.toLowerCase()}` : kindLabel
      }
      className={className}
    >
      <SurfaceHeader className="pb-3">
        <SurfaceTitle>{brand?.name}</SurfaceTitle>
        <p className={cn(genuiType.meta, "text-muted-foreground")}>
          {kindLabel}
          {card?.last4 && (
            <>
              <span aria-hidden>{` · ${maskedNumber(card.last4)}`}</span>
              <span className="sr-only">{`, card ${spokenNumber(card.last4)}`}</span>
            </>
          )}
        </p>
      </SurfaceHeader>

      <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
        {hasBalance ? (
          <p className="font-figure lining-nums text-[44px] leading-none font-normal tracking-tighter tabular-nums">
            <span className="sr-only">Balance </span>
            <Money amount={card?.balance ?? 0} currency={card?.currency} />
          </p>
        ) : (
          <Skeleton className="h-10 w-40" />
        )}
        {(expiry || card?.pin?.masked) && (
          <p className={genuiType.meta} suppressHydrationWarning>
            {expiry && (
              <span
                className={cn(expiry.expired && "font-medium text-destructive")}
              >
                {expiry.text}
              </span>
            )}
            {expiry && card?.pin?.masked && " · "}
            {card?.pin?.masked && "PIN on the back"}
          </p>
        )}

        {hasCode && (
          <div id={`${uid}-code`} hidden={!showCode}>
            {showCode &&
              (modules ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex justify-center pt-3"
                >
                  <div
                    // Always black on white, in dark mode too: scanners need the contrast.
                    className="w-56 max-w-full overflow-hidden rounded-lg bg-white ring-1 ring-foreground/10"
                  >
                    <svg
                      role="img"
                      aria-label={`Code for the cashier to scan, ${context} ${spokenNumber(card?.last4)}`}
                      viewBox={`0 0 ${dim} ${dim}`}
                      shapeRendering="crispEdges"
                      className="block h-auto w-full"
                    >
                      <rect width={dim} height={dim} fill="#fff" />
                      <path fill="#000" d={path} />
                    </svg>
                  </div>
                </motion.div>
              ) : (
                <p className={cn(genuiType.meta, "pt-3")}>
                  Code can't be shown here
                  <span className="sr-only">
                    . Open the card in the store's app.
                  </span>
                </p>
              ))}
          </div>
        )}
      </div>

      <SurfaceFooter className="justify-between">
        <p aria-live="polite" className={cn(genuiType.meta, "min-w-0")}>
          {streaming ? (
            <ShimmeringText
              text="Loading card…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
            />
          ) : status === "submitting" ? (
            "Sending…"
          ) : lastDone ? (
            <span className="text-foreground">{BALANCE_DONE[lastDone]}</span>
          ) : null}
        </p>
        {!streaming && (
          <div className="flex items-center gap-2">
            {hasCode && (
              <Button
                size="sm"
                aria-expanded={showCode}
                aria-controls={`${uid}-code`}
                onClick={() => setShowCode((v) => !v)}
              >
                {showCode ? "Hide code" : "Show to cashier"}
              </Button>
            )}
            {visible.map((a, i) => {
              const used = done.has(a.id)
              return (
                <WhyDisabled
                  key={a.id}
                  when={busy || used}
                  reason={used ? "Already done" : "Sending…"}
                >
                  <Button
                    size="sm"
                    variant={
                      used
                        ? "secondary"
                        : !hasCode && i === 0
                          ? "default"
                          : "outline"
                    }
                    disabled={busy || used}
                    onClick={() => fire(a.id)}
                  >
                    {used && <CheckIcon aria-hidden />}
                    {a.label}
                    <span className="sr-only">
                      {`, ${context}${used ? " (done)" : ""}`}
                    </span>
                  </Button>
                </WhyDisabled>
              )
            })}
            {overflow.length > 0 && (
              <Menu.Root>
                <Menu.Trigger
                  disabled={busy}
                  aria-label={`More actions for ${context}`}
                  render={<Button size="icon-sm" variant="ghost" />}
                >
                  <EllipsisIcon aria-hidden />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner
                    sideOffset={4}
                    align="end"
                    className="isolate z-50 outline-none"
                  >
                    <Menu.Popup className="min-w-44 origin-(--transform-origin) rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10 outline-none">
                      {overflow.map((a) => {
                        const used = done.has(a.id)
                        return (
                          <Menu.Item
                            key={a.id}
                            disabled={used}
                            onClick={() => fire(a.id)}
                            className="flex min-h-9 cursor-default items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                          >
                            {a.label}
                            {used && (
                              <>
                                <CheckIcon
                                  aria-hidden
                                  className="ml-auto size-3.5"
                                />
                                <span className="sr-only"> (done)</span>
                              </>
                            )}
                          </Menu.Item>
                        )
                      })}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            )}
          </div>
        )}
      </SurfaceFooter>
    </Surface>
  )
}

// ---------------------------------------------------------------------------
// Send mode

type AmountChoice =
  | { kind: "preset"; minor: number }
  | { kind: "custom"; text: string }
type Field = "amount" | "name" | "email" | "date"

const chipClass =
  "inline-flex h-8 min-w-14 cursor-pointer items-center justify-center rounded-full border border-border bg-transparent px-3.5 text-[13px] font-medium tabular-nums transition-colors hover:bg-accent dark:hover:bg-white/5 has-[input:checked]:ring-2 has-[input:checked]:ring-choice has-[input:checked]:ring-inset has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/50 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:disabled]:hover:bg-muted dark:has-[input:disabled]:hover:bg-transparent"

function SendView({
  brand,
  send = {},
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: ViewProps) {
  const locale = useGenUILocale()
  const restored =
    toArray(result).find(
      (r): r is SendDecision => r.action === "send" || r.action === "dismiss",
    ) ?? null
  const restoredSend = restored?.action === "send" ? restored : null

  const [decision, setDecision] = React.useState<SendDecision | null>(restored)
  const [choiceDraft, setChoice] = React.useState<AmountChoice | null>(null)
  const [designDraft, setDesign] = React.useState<string | null>(null)
  const [nameDraft, setName] = React.useState<string | null>(null)
  const [emailDraft, setEmail] = React.useState<string | null>(null)
  const [messageDraft, setMessage] = React.useState<string | null>(null)
  const [modeDraft, setMode] = React.useState<"now" | "schedule" | null>(null)
  const [dateDraft, setDate] = React.useState<string | null>(null)
  const [touched, setTouched] = React.useState<Set<Field>>(() => new Set())
  const [attempted, setAttempted] = React.useState(false)
  const uid = React.useId()
  const refs = {
    amount: React.useRef<HTMLInputElement>(null),
    name: React.useRef<HTMLInputElement>(null),
    email: React.useRef<HTMLInputElement>(null),
  }

  const local: GiftCardStatus | null = decision
    ? decision.action === "send"
      ? "sent"
      : "dismissed"
    : null
  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: GiftCardStatus =
    local && (statusProp === undefined || statusProp === "ready")
      ? local
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const locked = status === "sent" || status === "dismissed"
  const now = useNow(resolveNow(nowProp))
  const today = now === null ? undefined : dayKeyIn(now)

  const currency = send.currency
  const digits = currencyDigits(currency)
  const money = (n: number) =>
    formatMoney(n, currency, { trimZeroCents: true, locale })
  const presets = (send.amounts ?? []).filter(
    (n): n is number => typeof n === "number" && n > 0,
  )
  const custom =
    typeof send.custom?.min === "number" && typeof send.custom.max === "number"
      ? { min: send.custom.min, max: send.custom.max }
      : null
  const designs = (send.designs ?? []).filter(
    (d): d is GiftCardDesign =>
      typeof d.id === "string" && typeof d.label === "string",
  )
  const messageMax = send.messageMax ?? 250

  // Values: the user's edit, else the restored result, else the agent's prefill.
  const initialAmount = restoredSend?.amount ?? send.amount
  const choice: AmountChoice | null =
    choiceDraft ??
    (typeof initialAmount === "number"
      ? presets.some(
          (p) => toMinor(p, digits) === toMinor(initialAmount, digits),
        )
        ? { kind: "preset", minor: toMinor(initialAmount, digits) }
        : custom
          ? { kind: "custom", text: String(initialAmount) }
          : null
      : null)
  const wantedDesign = designDraft ?? restoredSend?.designId ?? send.designId
  const design =
    designs.find((d) => d.id === wantedDesign) ?? designs[0] ?? undefined
  const designIndex = design ? designs.indexOf(design) : 0
  const artSrc = safeArt(design?.image)
  const onArt = artSrc !== undefined
  const name =
    nameDraft ?? restoredSend?.recipient.name ?? send.recipient?.name ?? ""
  const email =
    emailDraft ?? restoredSend?.recipient.email ?? send.recipient?.email ?? ""
  const message = clampMessage(
    messageDraft ?? restoredSend?.message ?? send.message ?? "",
    messageMax,
  )
  const initialDeliver = restoredSend?.deliverAt ?? send.deliverAt ?? "now"
  const mode = modeDraft ?? (initialDeliver === "now" ? "now" : "schedule")
  const date =
    dateDraft ?? (initialDeliver === "now" ? "" : initialDeliver.slice(0, 10))

  // Validation
  const amountCheck:
    | { ok: true; minor: number }
    | { ok: false; issue: AmountIssue | "none" } =
    choice === null
      ? { ok: false, issue: "none" }
      : choice.kind === "preset"
        ? { ok: true, minor: choice.minor }
        : validateAmount(choice.text, custom ?? undefined, digits)
  const amount = amountCheck.ok ? fromMinor(amountCheck.minor, digits) : null
  const nameOk = name.trim().length > 0
  const emailOk = isValidEmail(email)
  const dateOk =
    mode === "now" ||
    (/^\d{4}-\d{2}-\d{2}$/.test(date) && (today === undefined || date >= today))
  const counter = messageCounter(message, messageMax)
  const valid = amountCheck.ok && nameOk && emailOk && dateOk && !counter.over

  const show = (f: Field) => attempted || touched.has(f)
  const touch = (f: Field) =>
    setTouched((prev) => (prev.has(f) ? prev : new Set(prev).add(f)))

  const amountError = amountCheck.ok
    ? null
    : amountCheck.issue === "none"
      ? attempted
        ? custom
          ? "Choose or enter an amount."
          : "Choose an amount."
        : null
      : show("amount")
        ? amountIssueText(amountCheck.issue, custom ?? undefined, currency, locale)
        : null
  const nameError =
    !nameOk && show("name") ? "Enter the recipient's name." : null
  const emailError =
    !emailOk && show("email")
      ? email.trim()
        ? "Enter a valid email, like dana@example.com."
        : "Enter the recipient's email."
      : null
  const dateError =
    !dateOk && show("date") ? "Pick a delivery date from today on." : null

  const deliverAt = mode === "now" ? "now" : date
  const delivery = deliveryText(deliverAt || undefined, locale)
  const disabled = locked || busy

  const submit = () => {
    if (disabled || !currency) return
    if (!valid || !amountCheck.ok) {
      setAttempted(true)
      const first: Field | null = !amountCheck.ok
        ? "amount"
        : !nameOk
          ? "name"
          : !emailOk
            ? "email"
            : !dateOk
              ? "date"
              : null
      if (first === "date") document.getElementById(`${uid}-date`)?.focus()
      else if (first) refs[first].current?.focus()
      return
    }
    const r: SendResult = {
      action: "send",
      amount: fromMinor(amountCheck.minor, digits),
      currency,
      ...(design ? { designId: design.id } : {}),
      recipient: { name: name.trim(), email: email.trim() },
      message: message.trim(),
      deliverAt,
    }
    setDecision(r)
    onResult?.(r)
  }
  const dismiss = () => {
    if (disabled) return
    const r: SendDecision = { action: "dismiss" }
    setDecision(r)
    onResult?.(r)
  }

  const initials = brand?.initials || initialsOf(brand?.name)
  const symbol = currency ? currencySymbol(currency, locale) : ""
  const customText = choice?.kind === "custom" ? choice.text : ""

  return (
    <Surface
      data-slot="gift-card"
      data-status={status}
      data-mode="send"
      aria-busy={busy}
      aria-label={
        brand?.name ? `Send a ${brand.name} gift card` : "Send a gift card"
      }
      className={cn("@container", className)}
    >
      <SurfaceHeader className="pb-3">
        <SurfaceTitle>
          {brand?.name ? `Send a ${brand.name} gift card` : undefined}
        </SurfaceTitle>
      </SurfaceHeader>

      <fieldset
        disabled={disabled}
        className="m-0 flex min-w-0 flex-col border-0 p-0"
      >
        <legend className="sr-only">Gift card details</legend>

        {/* The card as it will look sits beside the amount and design on wide cards */}
        <div className="grid gap-4 border-t border-border px-3 py-3 @lg:grid-cols-[16rem_minmax(0,1fr)] @lg:gap-6">
          <div className="@lg:self-start">
            <CardTile
              initials={initials}
              name={brand?.name}
              pattern={design ? patternFor(design, designIndex) : "plain"}
              art={artSrc}
            >
              <div className="flex items-end justify-between gap-2">
                {amount !== null ? (
                  <AmountRoll
                    amount={amount}
                    currency={currency}
                    className={cn(
                      genuiType.stat,
                      "leading-none",
                      onArt ? ON_ART : "rounded-sm bg-background",
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      genuiType.stat,
                      "leading-none",
                      onArt ? ON_ART : "rounded-sm bg-background",
                    )}
                  >
                    –
                  </span>
                )}
                {name.trim() && (
                  <span
                    className={cn(
                      "min-w-0 truncate text-[13px] leading-4",
                      onArt ? ON_ART : "rounded-sm bg-background",
                    )}
                  >
                    {`For ${name.trim()}`}
                  </span>
                )}
              </div>
            </CardTile>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {/* Amount */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <fieldset
                  className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
                  aria-describedby={
                    amountError ? `${uid}-amount-error` : undefined
                  }
                >
                  <legend className={cn(genuiType.label, "mb-2")}>
                    Amount
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {presets.map((v, i) => {
                      const minor = toMinor(v, digits)
                      return (
                        <label key={v} className={chipClass}>
                          <input
                            ref={i === 0 && !custom ? refs.amount : undefined}
                            type="radio"
                            name={`${uid}-amount`}
                            value={String(v)}
                            checked={
                              choice?.kind === "preset" &&
                              choice.minor === minor
                            }
                            onChange={() =>
                              setChoice({ kind: "preset", minor })
                            }
                            className="sr-only"
                          />
                          {money(v)}
                        </label>
                      )
                    })}
                    {streaming && presets.length === 0 && (
                      <>
                        <Skeleton className="h-8 w-14 rounded-full" />
                        <Skeleton className="h-8 w-14 rounded-full" />
                        <Skeleton className="h-8 w-14 rounded-full" />
                      </>
                    )}
                  </div>
                </fieldset>
                {custom && (
                  <FormField
                    htmlFor={`${uid}-custom`}
                    label={`Other (${money(custom.min)}–${money(custom.max)})`}
                    filled={customText !== ""}
                    className="basis-full"
                  >
                    <div className="relative">
                      {/* The currency symbol shows once the label has floated up. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute bottom-[9px] left-4 text-[15px] leading-5 text-muted-foreground opacity-0 transition-opacity group-focus-within/ff:opacity-100 group-data-[up]/ff:opacity-100"
                      >
                        {symbol}
                      </span>
                      <Input
                        ref={refs.amount}
                        id={`${uid}-custom`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={customText}
                        aria-invalid={
                          choice?.kind === "custom" && !!amountError
                        }
                        aria-describedby={
                          amountError ? `${uid}-amount-error` : undefined
                        }
                        onChange={(e) =>
                          setChoice({ kind: "custom", text: e.target.value })
                        }
                        onBlur={() =>
                          choice?.kind === "custom" && touch("amount")
                        }
                        className={cn(
                          formInputClass,
                          symbol.length > 1 ? "pl-14" : "pl-8",
                        )}
                      />
                    </div>
                  </FormField>
                )}
              </div>
              {amountError && (
                <p
                  id={`${uid}-amount-error`}
                  className="text-[13px] leading-4 text-destructive"
                >
                  {amountError}
                </p>
              )}
            </div>

            {/* Design */}
            {designs.length > 0 && (
              <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                <legend className="sr-only">Design</legend>
                <span aria-hidden className={genuiType.label}>
                  Design
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {designs.map((d, i) => (
                    <motion.label
                      key={d.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className="flex cursor-pointer flex-col rounded-lg border border-border bg-transparent p-1.5 transition-colors hover:bg-accent dark:hover:bg-white/5 has-[input:checked]:ring-2 has-[input:checked]:ring-choice dark:has-[input:checked]:bg-accent has-[input:disabled]:cursor-not-allowed has-[input:disabled]:hover:bg-muted has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/50"
                    >
                      <input
                        type="radio"
                        name={`${uid}-design`}
                        value={d.id}
                        checked={design?.id === d.id}
                        onChange={() => setDesign(d.id)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className="relative h-10 overflow-hidden rounded-lg bg-background"
                      >
                        {safeArt(d.image) ? (
                          <ArtFill src={safeArt(d.image) as string} />
                        ) : (
                          <PatternFill pattern={patternFor(d, i)} />
                        )}
                      </span>
                      <span className="sr-only">{d.label}</span>
                    </motion.label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </div>

        {/* Recipient and message: one form field per row. */}
        <FormFieldGroup className="border-t border-border px-3 py-3">
          <FormField
            htmlFor={`${uid}-name`}
            label="Recipient's name"
            filled={name !== ""}
            error={nameError}
            errorId={`${uid}-name-error`}
          >
            <Input
              ref={refs.name}
              id={`${uid}-name`}
              autoComplete="off"
              maxLength={60}
              value={name}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? `${uid}-name-error` : undefined}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => touch("name")}
              className={formInputClass}
            />
          </FormField>
          <FormField
            htmlFor={`${uid}-email`}
            label="Recipient's email"
            filled={email !== ""}
            error={emailError}
            errorId={`${uid}-email-error`}
          >
            <Input
              ref={refs.email}
              id={`${uid}-email`}
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? `${uid}-email-error` : undefined}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => touch("email")}
              className={formInputClass}
            />
          </FormField>
          <FormField htmlFor={`${uid}-message`} label="Message (optional)" pinned>
            <Textarea
              id={`${uid}-message`}
              rows={2}
              value={message}
              aria-describedby={`${uid}-counter`}
              onChange={(e) =>
                setMessage(clampMessage(e.target.value, messageMax))
              }
              className={formTextareaClass}
            />
            {/* The counter sits in the box's top right, level with the label. */}
            <span
              id={`${uid}-counter`}
              className={cn(
                "pointer-events-none absolute top-2 right-4 text-[12px] leading-4 tabular-nums text-muted-foreground",
                counter.near && "text-foreground",
              )}
            >
              <span aria-hidden>{counter.label}</span>
              <span className="sr-only">{`${counter.count} of ${messageMax} characters`}</span>
            </span>
            <span className="sr-only" aria-live="polite">
              {counter.near && !locked
                ? `${counter.remaining} ${counter.remaining === 1 ? "character" : "characters"} left`
                : ""}
            </span>
          </FormField>
        </FormFieldGroup>

        {/* Delivery */}
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 border-t border-border px-3 py-3">
          <legend className="sr-only">Delivery</legend>
          <span aria-hidden className={genuiType.label}>
            Delivery
          </span>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <label className={deliveryCard(mode === "now")}>
                <input
                  type="radio"
                  name={`${uid}-delivery`}
                  value="now"
                  checked={mode === "now"}
                  onChange={() => setMode("now")}
                  className="sr-only"
                />
                <RadioMark checked={mode === "now"} />
                Send now
              </label>
              <label className={deliveryCard(mode === "schedule")}>
                <input
                  type="radio"
                  name={`${uid}-delivery`}
                  value="schedule"
                  checked={mode === "schedule"}
                  onChange={() => setMode("schedule")}
                  className="sr-only"
                />
                <RadioMark checked={mode === "schedule"} />
                Schedule
              </label>
            </div>
            {mode === "schedule" && (
              <FormField htmlFor={`${uid}-date`} label="Delivery date" pinned>
                <DatePicker
                  id={`${uid}-date`}
                  type="date"
                  min={today}
                  value={date}
                  onValueChange={(v) => {
                    setDate(v)
                    touch("date")
                  }}
                  className={formDateClass}
                />
              </FormField>
            )}
          </div>
          {dateError && (
            <p
              id={`${uid}-date-error`}
              className="text-[13px] leading-4 text-destructive"
            >
              {dateError}
            </p>
          )}
        </fieldset>
      </fieldset>

      <SurfaceFooter aria-live="polite">
        {streaming ? (
          <ShimmeringText
            text="Loading gift card options…"
            color="var(--muted-foreground)"
            shimmeringColor="var(--foreground)"
            className="text-[13px] leading-4"
          />
        ) : status === "sent" ? (
          <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
            <CheckIcon aria-hidden className="size-4 shrink-0" />
            {`Sent to payment${delivery ? ` · ${delivery}` : ""}`}
          </p>
        ) : status === "dismissed" ? (
          <p className={genuiType.meta}>Cancelled. Nothing was sent.</p>
        ) : (
          // A form's one primary action spans the card; Cancel is a quiet text button.
          <div className="flex w-full flex-col gap-2">
            <WhyDisabled
              when={busy || !currency}
              reason={busy ? "Sending…" : "Pick a currency first"}
              className="w-full"
            >
              <Button
                onClick={submit}
                disabled={busy || !currency}
                className={formPrimaryClass}
              >
                {status === "submitting" ? "Sending…" : "Continue to payment"}
              </Button>
            </WhyDisabled>
            <WhyDisabled when={busy} reason="Sending…" className="w-full">
              <Button
                variant="ghost"
                onClick={dismiss}
                disabled={busy}
                className="h-11 w-full rounded-[24px] text-muted-foreground"
              >
                Cancel
              </Button>
            </WhyDisabled>
          </div>
        )}
      </SurfaceFooter>
    </Surface>
  )
}

/** Delivery options sit side by side, so each is a button card. */
const deliveryCard = (checked: boolean) =>
  cn(
    "flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-border px-3 py-3 text-[13px] transition-colors hover:bg-muted dark:hover:bg-white/5 has-[:disabled]:cursor-default has-[:disabled]:hover:bg-transparent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
    checked && "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
  )

export function GiftCard({ mode, ...props }: GiftCardProps) {
  return (
    <MotionConfig reducedMotion="user">
      {mode === "send" ? <SendView {...props} /> : <BalanceView {...props} />}
    </MotionConfig>
  )
}
