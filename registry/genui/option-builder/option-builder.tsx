"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  BlocksIcon,
  CheckIcon,
  CpuIcon,
  PlugIcon,
  PuzzleIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { LogoTile } from "@/components/genui/logo-tile"
import { ScrollFade } from "@/components/genui/scroll-fade"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"
import { RadioMark } from "@/components/genui/genui-motion"
import { useGenUILocale } from "@/components/genui/locale"

import {
  type Grade,
  type GroupLike,
  type MetricLike,
  type OptionLike,
  type SelectionModel,
  type Totals,
  blockReason,
  budgetState,
  computeScore,
  computeTotals,
  dependencyClosure,
  describeTotals,
  formatMetric,
  joinAnd,
  metricParts,
  toggleOption,
  unmetGroups,
} from "./option-builder-utils"
import type {
  BuilderKind,
  BuilderGroup,
  BuilderMetric,
  BuilderOption,
  OptionBuilderInput,
  OptionBuilderResult,
} from "./option-builder.schema"

export type OptionBuilderStatus =
  "streaming" | "ready" | "submitting" | "submitted" | "dismissed"

type PartialGroup = Partial<Omit<BuilderGroup, "options">> & {
  options?: Partial<BuilderOption>[]
}

export type OptionBuilderProps = Partial<
  Omit<
    OptionBuilderInput,
    "metrics" | "groups" | "selection" | "steps" | "score"
  >
> & {
  /** Fields may be partial while the tool call streams. */
  metrics?: Partial<BuilderMetric>[]
  groups?: PartialGroup[]
  selection?: { min?: number; max?: number }
  steps?: { current?: number; total?: number }
  score?: { label?: string; formula?: "budget" }
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host acts on the
   * selection. When omitted, the component tracks the user's decision itself.
   */
  status?: OptionBuilderStatus
  /** Called once: submit with the selection and totals, or dismiss. */
  onResult?: (result: OptionBuilderResult) => void
  /**
   * A decision from history (the tool call's stored output). Shows the
   * selection read-only and never calls onResult.
   */
  result?: OptionBuilderResult
  className?: string
}

type ReadyOption = OptionLike & {
  description?: string
  badges?: string[]
  logo?: { url?: string; darkUrl?: string; alt?: string }
}

type Score = { value: number; grade: Grade }

/** Rows before the option list scrolls inside the card. */
const MAX_ROWS = 4

const KIND_ICON = {
  apis: PlugIcon,
  "add-ons": PuzzleIcon,
  hardware: CpuIcon,
  other: BlocksIcon,
} as const

const KIND_TONE: Record<BuilderKind, string> = {
  apis: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  "add-ons":
    "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  hardware:
    "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  other: "bg-muted text-muted-foreground dark:bg-white/10",
}

function KindIcon({ kind }: { kind?: BuilderKind }) {
  const k = kind ?? "other"
  const Icon = KIND_ICON[k]
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
        KIND_TONE[k],
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}

/** The grade's colour: data meaning, not selection. */
const GRADE_FILL: Record<Grade, string> = {
  A: "bg-emerald-500 dark:bg-emerald-400",
  B: "bg-emerald-500 dark:bg-emerald-400",
  C: "bg-amber-500 dark:bg-amber-400",
  D: "bg-orange-500 dark:bg-orange-400",
  F: "bg-rose-500 dark:bg-rose-400",
}

// ---- Pieces ---------------------------------------------------------------

/** A metric value whose digits roll when it changes. */
function MetricValue({
  value,
  metric,
  unitClassName,
}: {
  value: number | null
  metric: MetricLike
  unitClassName?: string
}) {
  const locale = useGenUILocale()
  if (value === null) {
    return (
      <span className="tabular-nums">
        <span aria-hidden>—</span>
        <span className="sr-only">None</span>
      </span>
    )
  }
  const p = metricParts(value, metric, locale)
  const spaced = p.suffix.startsWith(" ")
  return (
    <span className="tabular-nums">
      <span className="sr-only">{p.text}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {p.prefix}
        <SlidingNumber
          number={p.number}
          decimalPlaces={p.decimals}
          decimalSeparator={p.decimalSeparator}
          thousandSeparator={p.groupSeparator}
          initiallyStable
        />
        {p.suffix && (
          <span className={cn(spaced && "ml-[0.25em]", unitClassName)}>
            {p.suffix.trim()}
          </span>
        )}
      </span>
    </span>
  )
}

function BudgetLine({
  metric,
  total,
}: {
  metric: MetricLike
  total: number | null
}) {
  const locale = useGenUILocale()
  if (typeof metric.budget !== "number") return null
  const state = budgetState(metric, total)
  const higher = metric.better === "higher"
  return (
    <>
      <span className={cn(genuiType.meta, "tabular-nums")}>
        {higher ? "Target " : "of "}
        {formatMetric(metric.budget, metric, locale)}
      </span>
      {state?.exceeded && (
        <span className="flex basis-full items-center gap-1 text-[13px] font-medium text-destructive tabular-nums">
          <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0" />
          {higher ? "Below target by " : "Over budget by "}
          {formatMetric(state.by, metric, locale)}
        </span>
      )}
    </>
  )
}

/** How much of a budget is used: a thin bar, red once it's over. */
function BudgetBar({
  metric,
  total,
}: {
  metric: MetricLike
  total: number | null
}) {
  if (typeof metric.budget !== "number" || metric.budget <= 0) return null
  if (metric.better === "higher") return null
  const used = Math.max(0, (total ?? 0) / metric.budget)
  const over = used > 1
  return (
    <div
      aria-hidden
      className="h-1 w-20 self-center overflow-hidden rounded-full bg-muted dark:bg-white/10"
    >
      <motion.div
        className={cn(
          "h-full rounded-full",
          over ? "bg-destructive" : "bg-foreground/70",
        )}
        initial={false}
        animate={{ width: `${Math.min(100, used * 100)}%` }}
        transition={genuiMotion.gentle}
      />
    </div>
  )
}

function MetricsStrip({
  metrics,
  totals,
  score,
  scoreLabel,
  streaming,
}: {
  metrics: MetricLike[]
  totals: Totals
  score: Score | null
  scoreLabel: string
  streaming: boolean
}) {
  if (metrics.length === 0) {
    if (!streaming) return null
    return (
      <div
        aria-hidden
        className="flex flex-wrap gap-x-6 border-t border-border"
      >
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-none flex-col gap-1.5 px-3 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    )
  }
  const [first, second, ...rest] = metrics
  const big = second ? [first, second] : [first]
  return (
    <div className="flex flex-col border-t border-border">
      <dl className="flex flex-wrap gap-x-10">
        {big.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={genuiMotion.fade}
            className="flex flex-none flex-col gap-1 px-3 py-3"
          >
            <dt className={genuiType.label}>{m.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className={genuiType.stat}>
                <MetricValue
                  value={totals[m.id] ?? null}
                  metric={m}
                  unitClassName="font-sans text-[14px] font-normal text-muted-foreground"
                />
              </span>
              <BudgetLine metric={m} total={totals[m.id] ?? null} />
              {/* Beside the budget, so it costs no height. The score bar
                  already sums the budgets up. */}
              {!score && <BudgetBar metric={m} total={totals[m.id] ?? null} />}
            </dd>
          </motion.div>
        ))}
      </dl>
      {rest.length > 0 && (
        <dl className="flex flex-wrap gap-x-10 gap-y-2 px-3 pb-3">
          {rest.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              style={{ flex: "1 1 min(100%, 8rem)" }}
              className="flex min-w-0 flex-col gap-0.5"
            >
              <dt className={genuiType.label}>{m.label}</dt>
              <dd className="flex flex-col gap-0.5">
                <span className={cn(genuiType.body, "font-medium")}>
                  <MetricValue value={totals[m.id] ?? null} metric={m} />
                </span>
                <BudgetLine metric={m} total={totals[m.id] ?? null} />
              </dd>
            </motion.div>
          ))}
        </dl>
      )}
      {score && (
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          <p className={genuiType.body}>
            <span className="sr-only">
              {`${scoreLabel} ${score.value} out of 100, grade ${score.grade}`}
            </span>
            <span aria-hidden className="inline-flex items-baseline gap-1">
              <span className={genuiType.label}>{scoreLabel}</span>
              <span className="font-medium">{score.grade}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium tabular-nums">
                <SlidingNumber number={score.value} initiallyStable />
              </span>
            </span>
          </p>
          {/* Plain filled track; the sentence above is the accessible value. */}
          <div
            aria-hidden
            className="h-1.5 overflow-hidden rounded-full border border-border bg-transparent"
          >
            <motion.div
              className={cn("h-full rounded-full", GRADE_FILL[score.grade])}
              initial={false}
              animate={{ width: `${score.value}%` }}
              transition={genuiMotion.gentle}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function OptionMetric({
  option,
  metric,
}: {
  option: ReadyOption
  metric: MetricLike
}) {
  const locale = useGenUILocale()
  const value = option.metrics?.[metric.id]
  if (typeof value !== "number") {
    return (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">{`${metric.label}: not applicable`}</span>
      </>
    )
  }
  return (
    <>
      <span className="sr-only">{`${metric.label} `}</span>
      {formatMetric(value, metric, locale)}
    </>
  )
}

function OptionRow({
  option,
  metrics,
  checked,
  single,
  radioName,
  reason,
  note,
  disabled,
  onToggle,
}: {
  option: ReadyOption
  metrics: MetricLike[]
  checked: boolean
  single: boolean
  radioName: string
  /** Why it can't be selected right now. */
  reason: string | null
  /** Dependency note, e.g. "Adds Auth service". */
  note: string | null
  disabled: boolean
  onToggle: (on: boolean) => void
}) {
  const locale = useGenUILocale()
  const uid = React.useId()
  const nameId = `${uid}-name`
  const detailsId = `${uid}-details`
  const [primary, secondary, ...extra] = metrics
  const blocked = !checked && reason !== null

  const content = (
    <>
      <LogoTile
        src={option.logo?.url}
        darkSrc={option.logo?.darkUrl}
        size={56}
        className={cn(blocked && "opacity-50")}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            id={nameId}
            className={cn(
              genuiType.body,
              "font-medium break-words",
              blocked && "text-muted-foreground/60",
            )}
          >
            {option.name}
          </span>
          {option.badges?.slice(0, 2).map((b) => (
            <Badge key={b} variant="info">
              {b}
            </Badge>
          ))}
        </div>
        <div id={detailsId} className="flex flex-col gap-0.5">
          {option.description && (
            <span className={cn(genuiType.meta, "break-words")}>
              {option.description}
            </span>
          )}
          {extra.length > 0 && (
            <span className={cn(genuiType.meta, "tabular-nums")}>
              {extra.map((m, i) => (
                <React.Fragment key={m.id}>
                  {i > 0 && " · "}
                  {m.label}{" "}
                  {typeof option.metrics?.[m.id] === "number"
                    ? formatMetric(option.metrics[m.id] as number, m, locale)
                    : "n/a"}
                </React.Fragment>
              ))}
            </span>
          )}
          {/* The row metrics, for screen readers; shown visually on the right. */}
          <span className="sr-only">
            {[primary, secondary]
              .filter((m): m is MetricLike => !!m)
              .map((m) => {
                const v = option.metrics?.[m.id]
                return typeof v === "number"
                  ? `${m.label} ${formatMetric(v, m, locale)}`
                  : `${m.label}: not applicable`
              })
              .join(", ")}
          </span>
          {blocked ? (
            // Why it can't be picked: a tooltip on the row, read here too.
            <span className="sr-only">{reason}</span>
          ) : (
            note && <span className={genuiType.meta}>{note}</span>
          )}
        </div>
      </div>
      {(primary || secondary) && (
        <div
          aria-hidden
          className="flex shrink-0 items-center gap-3 pt-0.5 tabular-nums"
        >
          {primary && (
            <span
              className={cn(
                "text-[14px] font-medium",
                blocked && "text-muted-foreground/60",
              )}
            >
              <OptionMetric option={option} metric={primary} />
            </span>
          )}
          {secondary && (
            <span className={cn(genuiType.meta, "min-w-14 text-right")}>
              <OptionMetric option={option} metric={secondary} />
            </span>
          )}
        </div>
      )}
    </>
  )

  const rowMotion = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.2, ease: "easeOut" as const },
  }

  if (single) {
    // A native radio inside a label: the whole row is the tap target, and
    // arrow keys move between options in the group.
    const row = (
      <label
        className={cn(
          "mx-2 flex items-center gap-3.5 rounded-[10px] px-3 py-2.5 transition-colors",
          checked && "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-inset",
          disabled || blocked
            ? "cursor-not-allowed"
            : "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
        )}
      >
        <input
          type="radio"
          name={radioName}
          value={option.id}
          checked={checked}
          disabled={disabled || blocked}
          aria-labelledby={nameId}
          aria-describedby={detailsId}
          onChange={() => onToggle(true)}
          className="sr-only"
        />
        <RadioMark checked={checked} className="size-5" />
        {content}
      </label>
    )
    return (
      <motion.li {...rowMotion} data-selected={checked}>
        {blocked && reason ? <IconTip label={reason}>{row}</IconTip> : row}
      </motion.li>
    )
  }

  // The checkbox and its text share one label, so the whole row toggles it.
  // The checkbox keeps its own focus ring.
  const row = (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside renders a labelable button (Base UI supports a wrapping label)
    <label
      className={cn(
        "mx-2 flex items-center gap-3.5 rounded-[10px] px-3 py-2.5 transition-colors",
        checked && "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
        disabled || blocked
          ? "cursor-not-allowed"
          : "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
      )}
    >
      <Checkbox
        nativeButton
        size="sm"
        aria-labelledby={nameId}
        aria-describedby={detailsId}
        checked={checked}
        disabled={disabled || blocked}
        onCheckedChange={(on) => onToggle(Boolean(on))}
        className="mt-px"
      />
      {content}
    </label>
  )
  return (
    <motion.li {...rowMotion} data-selected={checked}>
      {blocked && reason ? <IconTip label={reason}>{row}</IconTip> : row}
    </motion.li>
  )
}

function GroupTabs({
  groups,
  active,
  counts,
  onSelect,
}: {
  groups: GroupLike[]
  active: string
  counts: Record<string, number>
  onSelect: (id: string) => void
}) {
  // A one-pick group shows a check once chosen; others show their count.
  const refs = React.useRef(new Map<string, HTMLButtonElement>())
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = groups.findIndex((g) => g.id === active)
    let next = -1
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = i + 1
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = i - 1
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = groups.length - 1
    else return
    e.preventDefault()
    const target = groups[(next + groups.length) % groups.length]
    onSelect(target.id)
    refs.current.get(target.id)?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="Option groups"
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-1 flex-wrap gap-0.5 rounded-[20px] border border-border bg-transparent p-1"
    >
      {groups.map((g) => {
        const checked = g.id === active
        const count = counts[g.id] ?? 0
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control; each segment is one styled button with radio semantics
          <button
            key={g.id}
            ref={(el) => {
              if (el) refs.current.set(g.id, el)
              else refs.current.delete(g.id)
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onSelect(g.id)}
            className={cn(
              "relative", genuiHit, "inline-flex h-8 flex-1 shrink-0 items-center justify-center gap-1 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none",
              "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              checked
                ? "bg-accent text-foreground"
                : "hover:bg-accent",
            )}
          >
            {g.label}
            {count > 0 && g.max === 1 ? (
              <>
                <CheckIcon
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
                <span className="sr-only">, chosen</span>
              </>
            ) : (
              count > 0 && (
                <span className="inline-flex tabular-nums text-muted-foreground">
                  <span className="sr-only">{`${count} selected`}</span>
                  <span aria-hidden className="inline-flex">
                    <SlidingNumber number={count} initiallyStable />
                  </span>
                </span>
              )
            )}
          </button>
        )
      })}
    </div>
  )
}

function RowSkeleton() {
  return (
    <li aria-hidden className="mx-2 flex items-start gap-3 px-3 py-3">
      <Skeleton className="size-5 rounded-full" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-20" />
    </li>
  )
}

// ---- Component ------------------------------------------------------------

export function OptionBuilder({
  kind,
  title,
  description,
  metrics: metricsProp = [],
  score: scoreConfig,
  groups: groupsProp = [],
  selection,
  steps,
  defaultSelected,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: OptionBuilderProps) {
  const locale = useGenUILocale()
  const [userPicked, setUserPicked] = React.useState<string[] | null>(() =>
    result?.action === "submit" ? result.selected : null,
  )
  const [decision, setDecision] = React.useState<
    "submitted" | "dismissed" | null
  >(() =>
    result ? (result.action === "submit" ? "submitted" : "dismissed") : null,
  )
  const [tab, setTab] = React.useState<string | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const uid = React.useId()
  const titleId = `${uid}-title`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: OptionBuilderStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const done = status === "submitted" || status === "dismissed"
  const locked = status !== "ready" && status !== "streaming"

  const metrics: MetricLike[] = metricsProp
    .filter(
      (m): m is Partial<BuilderMetric> & { id: string; label: string } =>
        typeof m.id === "string" && typeof m.label === "string",
    )
    .map((m) => ({ ...m, id: m.id, label: m.label }))

  const groups: (GroupLike & { options: ReadyOption[] })[] = groupsProp
    .filter(
      (g): g is PartialGroup & { id: string; label: string } =>
        typeof g.id === "string" && typeof g.label === "string",
    )
    .map((g) => ({
      id: g.id,
      label: g.label,
      min: g.min,
      max: g.max,
      options: (g.options ?? [])
        .filter(
          (o): o is Partial<BuilderOption> & { id: string; name: string } =>
            typeof o.id === "string" && typeof o.name === "string",
        )
        .map((o) => ({
          id: o.id,
          name: o.name,
          groupId: g.id,
          description: o.description,
          logo: o.logo,
          badges: o.badges,
          metrics: o.metrics ?? {},
          requires: o.requires,
          excludes: o.excludes,
          disabled: o.disabled,
        })),
    }))
  const options = groups.flatMap((g) => g.options)
  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id
  const model: SelectionModel = { options, groups, max: selection?.max }

  const picked = userPicked ?? defaultSelected ?? []
  const selected = dependencyClosure(model, picked)
  const selectedOptions = options.filter((o) => selected.has(o.id))
  const restoredTotals =
    result?.action === "submit" && userPicked === result.selected
      ? result
      : null
  const totals: Totals = restoredTotals
    ? Object.fromEntries(
        metrics.map((m) => [m.id, restoredTotals.totals[m.id] ?? null]),
      )
    : computeTotals(metrics, options, selected)
  const score: Score | null = scoreConfig
    ? restoredTotals
      ? (restoredTotals.score ?? null)
      : computeScore(metrics, totals)
    : null
  const scoreLabel = scoreConfig?.label ?? "Score"

  const counts: Record<string, number> = {}
  for (const o of selectedOptions)
    counts[o.groupId] = (counts[o.groupId] ?? 0) + 1

  const minPicks = selection?.min ?? 1
  const unmet = unmetGroups(model, selected)
  const overBudget = metrics.filter(
    (m) => budgetState(m, totals[m.id] ?? null)?.exceeded,
  )
  const count = selectedOptions.length
  const canSubmit =
    !streaming &&
    !locked &&
    groups.length > 0 &&
    count >= minPicks &&
    unmet.length === 0 &&
    (selection?.max === undefined || count <= selection.max)

  const activeGroup = groups.find((g) => g.id === tab) ?? groups[0]
  const isLastStep =
    !steps?.current || !steps.total || steps.current >= steps.total
  const primaryLabel = submitLabel ?? (isLastStep ? "Done" : "Next")

  const toggle = (option: ReadyOption, on: boolean) => {
    if (locked || streaming) return
    if (on && blockReason(model, picked, option.id) !== null) return
    const outcome = toggleOption(model, picked, option.id, on)
    setUserPicked(outcome.picked)
    const nextTotals = computeTotals(
      metrics,
      options,
      dependencyClosure(model, outcome.picked),
    )
    const nextScore = scoreConfig ? computeScore(metrics, nextTotals) : null
    const parts = [
      `${on ? "Added" : "Removed"} ${option.name}${
        outcome.added.length
          ? `, with ${joinAnd(outcome.added.map(nameOf))}`
          : ""
      }.`,
      outcome.removed.length
        ? `Also removed ${joinAnd(outcome.removed.map(nameOf))}.`
        : "",
      describeTotals(metrics, nextTotals, nextScore, scoreLabel),
    ]
    setAnnouncement(parts.filter(Boolean).join(" "))
  }

  const submit = () => {
    if (!canSubmit) return
    setDecision("submitted")
    onResult?.({
      action: "submit",
      selected: selectedOptions.map((o) => o.id),
      totals: Object.fromEntries(
        Object.entries(totals).filter(
          (e): e is [string, number] => e[1] !== null,
        ),
      ),
      ...(score ? { score } : {}),
    })
  }

  const dismiss = () => {
    if (locked) return
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  const noteFor = (option: ReadyOption, checked: boolean) => {
    if (checked) {
      if (picked.includes(option.id)) return null
      const by = selectedOptions.filter(
        (o) =>
          o.id !== option.id && dependencyClosure(model, [o.id]).has(option.id),
      )
      return by.length
        ? `Included with ${joinAnd(by.map((o) => o.name))}`
        : null
    }
    const adds = [...dependencyClosure(model, [option.id])].filter(
      (id) => id !== option.id && !selected.has(id),
    )
    return adds.length ? `Adds ${joinAnd(adds.map(nameOf))}` : null
  }

  // First child in both layouts, so the outcome is announced when it lands.
  const announcer = (
    <p aria-live="polite" className="sr-only">
      {status === "submitted"
        ? "Selection sent."
        : status === "dismissed"
          ? "Closed. Nothing was selected."
          : announcement}
    </p>
  )

  // Finished: a compact, read-only record for the chat history.
  if (done) {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="option-builder"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          {announcer}
          <SurfaceHeader
            className={cn(
              "flex-row items-center justify-between gap-3",
              status === "dismissed" && "pb-3",
            )}
          >
            <KindIcon kind={kind} />
            <SurfaceTitle id={titleId} className="min-w-0 flex-1">
              {title}
            </SurfaceTitle>
            {status === "submitted" ? (
              <Badge variant="success" className="shrink-0">
                <CheckIcon aria-hidden />
                Submitted
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">
                <XIcon aria-hidden />
                Closed
              </Badge>
            )}
          </SurfaceHeader>
          {status === "submitted" ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              <MetricsStrip
                metrics={metrics}
                totals={totals}
                score={score}
                scoreLabel={scoreLabel}
                streaming={false}
              />
              <ul className="flex flex-col gap-2 border-t border-border px-3 py-3">
                {(selectedOptions.length
                  ? selectedOptions
                  : picked.map((id): ReadyOption => ({
                      id,
                      name: id,
                      groupId: "",
                    }))
                ).map((o) => {
                  const group = groups.find((g) => g.id === o.groupId)
                  return (
                    <li key={o.id} className="flex items-baseline gap-3">
                      <span
                        className={cn(
                          genuiType.body,
                          "min-w-0 flex-1 font-medium break-words",
                        )}
                      >
                        {o.name}
                        {group && groups.length > 1 && (
                          <span className="sr-only">, {group.label}</span>
                        )}
                      </span>
                      {metrics[0] && (
                        <span
                          className={cn(
                            genuiType.body,
                            "shrink-0 tabular-nums",
                          )}
                        >
                          <OptionMetric option={o} metric={metrics[0]} />
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </motion.div>
          ) : null}
        </Surface>
      </MotionConfig>
    )
  }

  const hint =
    unmet.length > 0
      ? `Choose ${joinAnd(
          unmet.map((g) =>
            (g.min ?? 0) > 1 ? `${g.min} in ${g.label}` : g.label,
          ),
        )}`
      : count < minPicks
        ? `Pick at least ${minPicks}`
        : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="option-builder"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        {announcer}
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <KindIcon kind={kind} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            {description && (
              <SurfaceDescription>{description}</SurfaceDescription>
            )}
          </div>
        </SurfaceHeader>

        <MetricsStrip
          metrics={metrics}
          totals={totals}
          score={score}
          scoreLabel={scoreLabel}
          streaming={streaming}
        />

        <div className="flex items-center justify-between gap-3 border-t border-border px-3 pt-2 pb-2">
          {groups.length > 1 && activeGroup ? (
            <GroupTabs
              groups={groups}
              active={activeGroup.id}
              counts={counts}
              onSelect={setTab}
            />
          ) : activeGroup ? (
            <span className="sr-only">{activeGroup.label}</span>
          ) : (
            <Skeleton className="h-10 w-40 rounded-full" />
          )}
          {steps?.current && steps.total ? (
            <span className={cn(genuiType.meta, "shrink-0 tabular-nums")}>
              {`Step ${steps.current} of ${steps.total}`}
            </span>
          ) : null}
        </div>

        <AutoHeight>
          {activeGroup && (
            <fieldset key={activeGroup.id} className="m-0 min-w-0 border-0 p-0">
              <legend className="sr-only">
                {activeGroup.label}
                {activeGroup.max === 1
                  ? ", choose one"
                  : activeGroup.max
                    ? `, up to ${activeGroup.max}`
                    : ""}
              </legend>
              <ScrollFade
                className={cn(
                  activeGroup.options.length > MAX_ROWS && "max-h-[19rem]",
                )}
              >
                <ul className="flex flex-col gap-1.5 py-2">
                  {activeGroup.options.map((o) => {
                    const checked = selected.has(o.id)
                    return (
                      <OptionRow
                        key={o.id}
                        option={o}
                        metrics={metrics}
                        checked={checked}
                        single={model.max === 1 || activeGroup.max === 1}
                        radioName={`${uid}-${model.max === 1 ? "all" : activeGroup.id}`}
                        reason={
                          checked ? null : blockReason(model, picked, o.id)
                        }
                        note={noteFor(o, checked)}
                        disabled={locked || streaming}
                        onToggle={(on) => toggle(o, on)}
                      />
                    )
                  })}
                  {streaming && activeGroup === groups[groups.length - 1] && (
                    <RowSkeleton />
                  )}
                </ul>
              </ScrollFade>
            </fieldset>
          )}
          {!activeGroup && streaming && (
            <ul className="py-1">
              <RowSkeleton />
              <RowSkeleton />
            </ul>
          )}
        </AutoHeight>

        <SurfaceFooter className="justify-between gap-3">
          <p aria-live="polite" className={genuiType.meta}>
            {streaming ? (
              <ShimmeringText
                text="Loading options…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : status === "submitting" ? (
              "Saving…"
            ) : (
              <>
                {hint ??
                  (count > 0
                    ? [
                        `${count} selected`,
                        ...metrics
                          .slice(0, 2)
                          .map((m) =>
                            typeof totals[m.id] === "number"
                              ? formatMetric(totals[m.id] as number, m, locale)
                              : null,
                          ),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null)}
                {/* Shown on the totals; announced here as well. */}
                {!hint && overBudget.length > 0 && (
                  <span className="sr-only">
                    Over budget: {joinAnd(overBudget.map((m) => m.label))}
                  </span>
                )}
              </>
            )}
          </p>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={dismiss}
              disabled={locked}
            >
              Cancel
            </Button>
            <WhyDisabled
              when={!canSubmit && status !== "submitting" && !locked}
              reason={hint ?? "Finish your choices first"}
            >
              <Button size="sm" onClick={submit} disabled={!canSubmit}>
                {status === "submitting" ? "Saving…" : primaryLabel}
              </Button>
            </WhyDisabled>
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
