"use client"

import * as React from "react"
import {
  ArrowRightIcon,
  BanIcon,
  CheckIcon,
  MessageSquareIcon,
  Undo2Icon,
  XIcon,
  CalendarIcon,
  ClockIcon,
  UsersIcon,
  UserIcon,
  MapPinIcon,
  WalletIcon,
  CreditCardIcon,
  TagIcon,
  PackageIcon,
  FileTextIcon,
  MailIcon,
  ShieldIcon,
  DatabaseIcon,
  ServerIcon,
  GlobeIcon,
  HashIcon,
  TrendingUpIcon,
  Building2Icon,
  type LucideIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  FormField,
  FormFieldGroup,
  formInputClass,
  formSelectClass,
  formTextareaClass,
} from "@/components/genui/form-field"
import { useGenUILocale } from "@/components/genui/locale"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type { ApprovalIcon } from "./approval-request.schema"
import type {
  ApprovalAdjustable,
  ApprovalAdjustValue,
  ApprovalAlternative,
  ApprovalRequestInput,
  ApprovalRequestResult,
  ApprovalScope,
} from "./approval-request.schema"
import {
  type AdjustField,
  decisionText,
  diffAdjustments,
  expiryText,
  formatCost,
  HOLD_MS,
  matchesConfirmPhrase,
  needsHold,
  readReversible,
  reversibilityText,
  riskMeta,
  toEpoch,
  validateAdjustment,
} from "./approval-request-utils"

const ICONS: Record<ApprovalIcon, LucideIcon> = {
  calendar: CalendarIcon,
  clock: ClockIcon,
  users: UsersIcon,
  user: UserIcon,
  "map-pin": MapPinIcon,
  wallet: WalletIcon,
  "credit-card": CreditCardIcon,
  tag: TagIcon,
  package: PackageIcon,
  "file-text": FileTextIcon,
  mail: MailIcon,
  shield: ShieldIcon,
  database: DatabaseIcon,
  server: ServerIcon,
  globe: GlobeIcon,
  hash: HashIcon,
  "trending-up": TrendingUpIcon,
  building: Building2Icon,
}

function FactIcon({ name }: { name: ApprovalIcon }) {
  const Icon = ICONS[name]
  return <Icon aria-hidden className="size-3.5 shrink-0" />
}

export type ApprovalRequestStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "approved"
  | "rejected"
  | "revised"
  | "alternative"

type Decided = Exclude<
  ApprovalRequestStatus,
  "streaming" | "ready" | "submitting"
>

const DECIDED: Record<ApprovalRequestResult["action"], Decided> = {
  approve: "approved",
  reject: "rejected",
  revise: "revised",
  alternative: "alternative",
}

export type ApprovalRequestProps = Partial<
  Omit<
    ApprovalRequestInput,
    "scope" | "consequences" | "adjustable" | "alternatives"
  >
> & {
  /** Lists may be partial while the tool call streams. */
  scope?: Partial<ApprovalScope>[]
  consequences?: (string | undefined)[]
  adjustable?: Partial<ApprovalAdjustable>[]
  alternatives?: Partial<ApprovalAlternative>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent generates
   * props; 'submitting' while the host sends the decision. When omitted, the
   * component tracks the user's decision itself.
   */
  status?: ApprovalRequestStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: ApprovalRequestResult) => void
  /** A decision from history. Renders the record and never calls onResult. */
  result?: ApprovalRequestResult
  /**
   * Fixed current time (Date, ISO or epoch ms) for the expiry text. By default
   * the clock starts after mount, so server and client render the same markup.
   */
  now?: Date | string | number
  className?: string
}

const DECISION_ICON = {
  approve: CheckIcon,
  reject: XIcon,
  revise: MessageSquareIcon,
  alternative: ArrowRightIcon,
} as const

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

const focusRing =
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

/** Ticks every 30 s while active, after mount. A fixed `now` wins. */
function useClock(fixed: number | null, active: boolean) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (fixed !== null || !active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [fixed, active])
  return fixed ?? now
}

function useMounted() {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  return mounted
}

function formatClock(iso: string | undefined, locale: string) {
  const t = toEpoch(iso)
  if (t === null) return undefined
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(t)
}

function ScopeSkeleton() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3"
    >
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-32" />
    </div>
  )
}

function isReadyField(f: Partial<ApprovalAdjustable>): f is AdjustField & {
  help?: string
} {
  return (
    typeof f.id === "string" &&
    typeof f.label === "string" &&
    (f.type === "number" ||
      f.type === "text" ||
      f.type === "toggle" ||
      (f.type === "select" && (f.options?.length ?? 0) > 0)) &&
    f.value !== undefined
  )
}

function AdjustControl({
  field,
  id,
  labelId,
  describedBy,
  value,
  invalid,
  disabled,
  onChange,
}: {
  field: AdjustField
  id: string
  labelId: string
  describedBy: string | undefined
  value: ApprovalAdjustValue
  invalid: boolean
  disabled: boolean
  onChange: (value: ApprovalAdjustValue) => void
}) {
  const common = {
    id,
    disabled,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
  }
  switch (field.type) {
    case "toggle":
      return (
        <Switch
          nativeButton
          {...common}
          aria-labelledby={labelId}
          checked={value === true}
          onCheckedChange={(on) => onChange(on)}
          // Larger tap area than the 20px track, without changing its look.
          className="after:absolute after:-inset-2"
        />
      )
    case "select": {
      const items = (field.options ?? []).map((o) => ({ value: o, label: o }))
      return (
        <Select
          value={String(value)}
          onValueChange={(v) => onChange(typeof v === "string" ? v : "")}
          items={items}
          disabled={disabled}
        >
          <SelectTrigger
            {...common}
            aria-labelledby={labelId}
            className={formSelectClass}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    case "number":
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          min={field.min}
          max={field.max}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={formInputClass}
        />
      )
    default:
      return (
        <Input
          {...common}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={formInputClass}
        />
      )
  }
}

/**
 * Approve as a press and hold: the fill grows while the pointer or Enter/Space
 * is held, and releasing early cancels. A click that arrives with no pointer
 * or key press before it comes from assistive technology (a screen reader's
 * "activate"), which can't hold, so it approves at once.
 */
function HoldToApprove({
  label,
  disabled,
  onConfirm,
  className,
}: {
  label: string
  disabled?: boolean
  onConfirm: () => void
  className?: string
}) {
  const reduced = useReducedMotion()
  const [progress, setProgress] = React.useState(0)
  const [holding, setHolding] = React.useState(false)
  const [note, setNote] = React.useState("")
  const frame = React.useRef(0)
  const startedAt = React.useRef(0)
  const touched = React.useRef(false)
  const hintId = React.useId()

  React.useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const end = (announce?: string) => {
    cancelAnimationFrame(frame.current)
    setHolding(false)
    setProgress(0)
    if (announce) setNote(announce)
  }

  const begin = () => {
    if (disabled || holding) return
    setNote("")
    setHolding(true)
    startedAt.current = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt.current) / HOLD_MS)
      // Reduced motion: quarter steps instead of a smooth fill.
      setProgress(reduced ? Math.floor(p * 4) / 4 : p)
      if (p >= 1) {
        end()
        onConfirm()
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const release = () => {
    if (holding) end("Released early. Press and hold to approve.")
  }

  return (
    <>
      <Button
        size="sm"
        disabled={disabled}
        aria-describedby={hintId}
        data-holding={holding || undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          touched.current = true
          try {
            // Keep receiving the release if the pointer slides off the button.
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // Not every pointer can be captured (e.g. synthetic events).
          }
          begin()
        }}
        onPointerUp={() => {
          release()
          window.setTimeout(() => {
            touched.current = false
          }, 50)
        }}
        onPointerCancel={release}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          if (e.repeat) return
          touched.current = true
          begin()
        }}
        onKeyUp={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          release()
          touched.current = false
        }}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          const fromAssistiveTech = !touched.current
          touched.current = false
          if (fromAssistiveTech && !disabled) onConfirm()
        }}
        className={cn(
          "relative touch-none overflow-hidden select-none",
          className,
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 origin-left bg-primary-foreground/25 dark:bg-foreground/20"
          style={{ transform: `scaleX(${progress})` }}
        />
        <span className="relative">{holding ? "Keep holding…" : label}</span>
      </Button>
      {/* The footer around it is already a polite live region. */}
      <span className="sr-only">
        {holding ? "Holding. Keep holding to approve." : note}
      </span>
      <span id={hintId} className="sr-only">
        Press and hold for about a second, or hold Enter or Space. With a screen
        reader, activate it normally.
      </span>
    </>
  )
}

export function ApprovalRequest({
  action,
  summary,
  risk,
  reversible,
  undoWindow,
  reversibleDetail,
  scope = [],
  consequences = [],
  cost,
  requestedBy,
  expiresAt,
  adjustable = [],
  confirmPhrase,
  hold,
  alternatives = [],
  status: statusProp,
  onResult,
  result,
  now: nowProp,
  className,
}: ApprovalRequestProps) {
  const locale = useGenUILocale()
  const [decision, setDecision] = React.useState<ApprovalRequestResult | null>(
    result ?? null,
  )
  // The user's changes to adjustable fields, raw (numbers stay text while typed).
  const [edits, setEdits] = React.useState<Record<string, ApprovalAdjustValue>>(
    () =>
      result?.action === "approve" && result.adjustments
        ? { ...result.adjustments }
        : {},
  )
  const [panel, setPanel] = React.useState<"reject" | "revise" | null>(null)
  const [reason, setReason] = React.useState("")
  const [feedback, setFeedback] = React.useState("")
  const [phrase, setPhrase] = React.useState("")

  const baseId = React.useId()
  const recordRef = React.useRef<HTMLParagraphElement>(null)
  const rejectRef = React.useRef<HTMLButtonElement>(null)
  const reviseRef = React.useRef<HTMLButtonElement>(null)
  const focusRecord = React.useRef(false)

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: ApprovalRequestStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? DECIDED[decision.action]
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"
  const pending =
    status === "streaming" || status === "ready" || status === "submitting"

  const mounted = useMounted()
  const now = useClock(
    toEpoch(nowProp),
    pending && !streaming && expiresAt !== undefined,
  )

  // Move focus to the record after the user acts (not when restored).
  React.useEffect(() => {
    if (decision && focusRecord.current) {
      focusRecord.current = false
      recordRef.current?.focus()
    }
  }, [decision])

  const readyScope = scope.filter(
    (s): s is ApprovalScope =>
      typeof s.label === "string" && typeof s.value === "string",
  )
  const readyConsequences = consequences.filter(
    (c): c is string => typeof c === "string" && c.trim() !== "",
  )
  const fields = adjustable.filter(isReadyField)
  const readyAlternatives = alternatives.filter(
    (a): a is ApprovalAlternative =>
      typeof a.id === "string" && typeof a.label === "string",
  )

  const rawValue = (f: AdjustField): ApprovalAdjustValue =>
    f.id in edits ? edits[f.id] : f.value
  const adjustments = diffAdjustments(fields, edits)
  const changedCount = Object.keys(adjustments).length
  const invalidCount = fields.filter(
    (f) => validateAdjustment(f, rawValue(f)) !== null,
  ).length
  const holdToApprove = needsHold({ hold, risk, confirmPhrase })
  const needsPhrase = Boolean(confirmPhrase?.trim())
  const phraseOk = matchesConfirmPhrase(phrase, confirmPhrase)
  const canApprove =
    !locked && phraseOk && invalidCount === 0 && readyScope.length > 0

  const meta = risk ? riskMeta(risk) : null
  const reversibility = reversibilityText({
    reversible: readReversible(reversible),
    undoWindow,
    reversibleDetail,
  })
  const costText =
    cost && typeof cost.amount === "number" && cost.currency?.length === 3
      ? formatCost({
          amount: cost.amount,
          currency: cost.currency,
          period: cost.period,
        }, locale)
      : null
  const expiry = pending && now !== null ? expiryText(expiresAt, now) : null

  const decide = (next: ApprovalRequestResult) => {
    const stamped = { ...next, decidedAt: new Date().toISOString() }
    focusRecord.current = true
    setPanel(null)
    setDecision(stamped)
    onResult?.(stamped)
  }

  const approve = () => {
    if (!canApprove) return
    decide(
      changedCount ? { action: "approve", adjustments } : { action: "approve" },
    )
  }

  const reject = () => {
    const text = reason.trim()
    decide(text ? { action: "reject", reason: text } : { action: "reject" })
  }

  const revise = () => {
    const text = feedback.trim()
    if (!text) return
    decide({ action: "revise", feedback: text })
  }

  const closePanel = () => {
    const back = panel === "reject" ? rejectRef : reviseRef
    setPanel(null)
    requestAnimationFrame(() => back.current?.focus())
  }

  const regionLabel = pending
    ? `Approval needed: ${action ?? "action"}`
    : `Approval request: ${action ?? "action"}`

  // Risk and the deadline change the decision; who asked is read to screen readers.
  const headerMeta = [expiry].filter(Boolean)

  const DecisionIcon = decision ? DECISION_ICON[decision.action] : null
  const record = decision
    ? decisionText(decision, {
        time: mounted ? formatClock(decision.decidedAt, locale) : undefined,
        alternativeLabel:
          decision.action === "alternative"
            ? readyAlternatives.find((a) => a.id === decision.id)?.label
            : undefined,
      })
    : null

  // What is still streaming in, for the trailing placeholder.
  const streamingConsequences = streaming && readyConsequences.length > 0

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="approval-request"
        data-status={status}
        data-risk={risk}
        aria-busy={streaming || status === "submitting"}
        aria-label={regionLabel}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <SurfaceTitle>{action}</SurfaceTitle>
              {meta && (
                <Badge
                  variant={
                    risk === "high"
                      ? "destructive"
                      : risk === "low"
                        ? "success"
                        : "warning"
                  }
                  className="shrink-0"
                >
                  {meta.label}
                </Badge>
              )}
              {!meta && streaming && <Skeleton className="h-5 w-16" />}
            </div>
            {headerMeta.length > 0 && (
              <p className={genuiType.meta}>{headerMeta.join(" · ")}</p>
            )}
          </div>
          {(summary || requestedBy) && (
            <p className="sr-only">
              {[summary, requestedBy && `Requested by ${requestedBy}`]
                .filter(Boolean)
                .join(". ")}
            </p>
          )}
        </SurfaceHeader>

        {/* Height animates as sections stream in and panels open. */}
        <AutoHeight>
          <div className="flex flex-col">
            {(costText ||
              readyScope.length > 0 ||
              streaming ||
              reversibility) && (
              <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
                {/* What it costs is the answer to "should I pay this?", so it leads. */}
                {costText && (
                  <motion.p
                    {...enter}
                    className="flex flex-wrap items-baseline gap-x-1.5"
                  >
                    <span className="sr-only">Cost: </span>
                    <span className={genuiType.stat}>{costText.amount}</span>
                    {costText.period && (
                      <span className="text-[13px] text-muted-foreground">
                        {costText.period}
                      </span>
                    )}
                  </motion.p>
                )}

                {(readyScope.length > 0 || streaming) && (
                  <div className="@container">
                    <dl className="flex flex-col divide-y divide-border">
                      {readyScope.map((s) => (
                        <motion.div
                          key={`${s.label}:${s.value}`}
                          data-slot="approval-request-scope"
                          {...enter}
                          className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-start gap-4 py-2.5 first:pt-0 last:pb-0"
                        >
                          <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                            {s.icon && ICONS[s.icon] && (
                              <FactIcon name={s.icon} />
                            )}
                            {s.label}
                          </dt>
                          <dd className="min-w-0 text-[13px] font-medium break-words">
                            {s.value}
                            {s.detail && (
                              <span
                                className={cn(
                                  genuiType.meta,
                                  "block font-normal",
                                )}
                              >
                                {s.detail}
                              </span>
                            )}
                          </dd>
                        </motion.div>
                      ))}
                      {streaming && readyConsequences.length === 0 && (
                        <ScopeSkeleton />
                      )}
                      {streaming && readyScope.length === 0 && (
                        <ScopeSkeleton />
                      )}
                    </dl>
                  </div>
                )}

                {reversibility && reversibility.kind !== "irreversible" && (
                  <p className="sr-only">{reversibility.text}</p>
                )}
                {reversibility && reversibility.kind === "irreversible" && (
                  <motion.p
                    {...enter}
                    className="flex items-start gap-1.5 text-[13px]"
                  >
                    {reversibility.kind === "irreversible" ? (
                      <BanIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <Undo2Icon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span
                      className={cn(
                        reversibility.kind === "irreversible" &&
                          "font-semibold",
                      )}
                    >
                      {reversibility.text}
                    </span>
                  </motion.p>
                )}
              </div>
            )}

            {(readyConsequences.length > 0 || streamingConsequences) && (
              <section
                aria-labelledby={`${baseId}-consequences`}
                className="flex flex-col gap-1.5 border-t border-border px-3 py-3"
              >
                <h4 id={`${baseId}-consequences`} className={genuiType.label}>
                  What happens
                </h4>
                <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] marker:text-muted-foreground">
                  {readyConsequences.map((c) => (
                    <motion.li key={c} {...enter}>
                      {c}
                    </motion.li>
                  ))}
                  {streamingConsequences && (
                    <li aria-hidden className="list-none">
                      <Skeleton className="h-4 w-2/3" />
                    </li>
                  )}
                </ul>
              </section>
            )}

            {fields.length > 0 && (
              <section
                aria-labelledby={`${baseId}-adjust`}
                className="flex flex-col gap-4 border-t border-border px-3 py-3"
              >
                <div className="flex min-h-4 items-center justify-between gap-2">
                  <h4 id={`${baseId}-adjust`} className={genuiType.label}>
                    Adjust
                  </h4>
                  {changedCount > 0 && !locked && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEdits({})}
                      className="-my-1"
                    >
                      Reset changes
                    </Button>
                  )}
                </div>
                {/* Text, number and select values are form fields, one per row;
                    toggles keep their compact row. */}
                <FormFieldGroup>
                {fields.map((f) => {
                  const id = `${baseId}-f-${f.id}`
                  const labelId = `${id}-label`
                  const helpId = `${id}-help`
                  const errId = `${id}-error`
                  const value = rawValue(f)
                  const error = locked ? null : validateAdjustment(f, value)
                  const describedBy =
                    [f.help && helpId, error && errId]
                      .filter(Boolean)
                      .join(" ") || undefined
                  const changed = f.id in adjustments
                  const labelText = (
                    <>
                      {f.label}
                      {changed && <span className="sr-only">(changed)</span>}
                    </>
                  )
                  const control = (
                    <AdjustControl
                      field={f}
                      id={id}
                      labelId={labelId}
                      describedBy={describedBy}
                      value={value}
                      invalid={Boolean(error)}
                      disabled={locked}
                      onChange={(v) =>
                        setEdits((prev) => ({ ...prev, [f.id]: v }))
                      }
                    />
                  )
                  return (
                    <motion.div
                      key={f.id}
                      data-slot="approval-request-field"
                      {...enter}
                      className="flex flex-col gap-2"
                    >
                      {f.type === "toggle" ? (
                        <div className="flex items-center justify-between gap-3">
                          <label
                            id={labelId}
                            htmlFor={id}
                            className={cn(
                              genuiType.label,
                              "flex items-center gap-2",
                            )}
                          >
                            {labelText}
                          </label>
                          {control}
                        </div>
                      ) : (
                        <FormField
                          htmlFor={id}
                          labelId={labelId}
                          label={labelText}
                          filled={String(value) !== ""}
                          error={error ?? undefined}
                          errorId={errId}
                        >
                          {control}
                        </FormField>
                      )}
                      {/* Help is read with the field, not shown under it. */}
                      {f.help && (
                        <p id={helpId} className="sr-only">
                          {f.help}
                        </p>
                      )}
                      {error && f.type === "toggle" && (
                        <p id={errId} className="text-xs text-destructive">
                          {error}
                        </p>
                      )}
                    </motion.div>
                  )
                })}
                </FormFieldGroup>
              </section>
            )}

            {pending && readyAlternatives.length > 0 && (
              <section
                aria-labelledby={`${baseId}-alternatives`}
                className="flex flex-col gap-2 border-t border-border px-3 py-3"
              >
                <h4 id={`${baseId}-alternatives`} className={genuiType.label}>
                  Or instead
                </h4>
                <ul className="flex flex-wrap gap-2">
                  {readyAlternatives.map((a) => {
                    const descId = `${baseId}-alt-${a.id}`
                    return (
                      <motion.li key={a.id} {...enter}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={locked}
                          aria-describedby={a.description ? descId : undefined}
                          onClick={() =>
                            decide({ action: "alternative", id: a.id })
                          }
                        >
                          {a.label}
                        </Button>
                        {a.description && (
                          <span id={descId} className="sr-only">
                            {a.description}
                          </span>
                        )}
                      </motion.li>
                    )
                  })}
                </ul>
              </section>
            )}

            {pending && needsPhrase && (
              <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                {/* A safety gate, not a form field: the phrase to type must never be truncated. */}
                <label htmlFor={`${baseId}-phrase`} className={genuiType.label}>
                  Type{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {confirmPhrase?.trim()}
                  </span>{" "}
                  to confirm
                </label>
                <Input
                  id={`${baseId}-phrase`}
                  value={phrase}
                  disabled={locked}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-describedby={`${baseId}-phrase-desc`}
                  onChange={(e) => setPhrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canApprove) approve()
                  }}
                  className="w-full sm:w-72"
                />
                <p id={`${baseId}-phrase-desc`} className="sr-only">
                  {phraseOk
                    ? "Matches. You can approve now."
                    : "Approve unlocks when the text matches. This guards against approving by accident."}
                </p>
              </div>
            )}
          </div>
        </AutoHeight>

        <SurfaceFooter
          aria-live="polite"
          className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          {decision && DecisionIcon && record ? (
            // The decision record. Focus lands here after acting.
            <p
              ref={recordRef}
              tabIndex={-1}
              data-slot="approval-request-record"
              className={cn(
                "flex items-start gap-1.5 text-[13px] break-words",
                decision.action !== "approve" && "text-muted-foreground",
                focusRing,
              )}
            >
              <DecisionIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{record}</span>
            </p>
          ) : panel === "reject" ? (
            <div className="flex w-full flex-col gap-2">
              <FormField
                htmlFor={`${baseId}-reason`}
                label={
                  <>
                    Reason{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </>
                }
                pinned
              >
                <Textarea
                  id={`${baseId}-reason`}
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) reject()
                    if (e.key === "Escape") closePanel()
                  }}
                  className={formTextareaClass}
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={closePanel}>
                  Cancel
                </Button>
                <Button size="sm" onClick={reject}>
                  Send rejection
                </Button>
              </div>
            </div>
          ) : panel === "revise" ? (
            <div className="flex w-full flex-col gap-2">
              <FormField
                htmlFor={`${baseId}-feedback`}
                label="Ask a question or request changes"
                pinned
              >
                <Textarea
                  id={`${baseId}-feedback`}
                  autoFocus
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) revise()
                    if (e.key === "Escape") closePanel()
                  }}
                  className={formTextareaClass}
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={closePanel}>
                  Cancel
                </Button>
                <Button size="sm" onClick={revise} disabled={!feedback.trim()}>
                  Send
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className={genuiType.meta}>
                {streaming ? (
                  <ShimmeringText
                    text="Preparing request…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                ) : status === "submitting" ? (
                  "Sending your decision…"
                ) : invalidCount > 0 ? (
                  "Fix the highlighted field to approve"
                ) : !phraseOk ? (
                  "Type the confirmation to approve"
                ) : (
                  <span className="sr-only">Waiting for your decision</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <Button
                  ref={reviseRef}
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Request changes"
                  title="Request changes"
                  disabled={locked}
                  onClick={() => setPanel("revise")}
                >
                  <MessageSquareIcon />
                </Button>
                <Button
                  ref={rejectRef}
                  size="sm"
                  variant="secondary"
                  disabled={locked}
                  onClick={() => setPanel("reject")}
                  className="flex-1 sm:flex-none"
                >
                  Reject
                </Button>
                {holdToApprove ? (
                  <HoldToApprove
                    label={
                      changedCount > 0
                        ? "Hold to approve with changes"
                        : "Hold to approve"
                    }
                    disabled={!canApprove}
                    onConfirm={approve}
                    className="flex-1 sm:flex-none"
                  />
                ) : (
                  <Button
                    size="sm"
                    disabled={!canApprove}
                    onClick={approve}
                    className="flex-1 sm:flex-none"
                  >
                    {changedCount > 0 ? "Approve with changes" : "Approve"}
                  </Button>
                )}
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
