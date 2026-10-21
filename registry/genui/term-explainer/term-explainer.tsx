"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookOpenIcon,
  CheckIcon,
  CircleCheckIcon,
  CoinsIcon,
  CpuIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  InfoIcon,
  type LucideIcon,
  ScaleIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import {
  describeValue,
  disclaimerText,
  formatNumber,
  formatRange,
  type RangeStatus,
  rangeScale,
  rangeStatus,
  resolveValue,
  safeHttpUrl,
  statusLabel,
  withUnit,
} from "./term-explainer-utils"
import type {
  RelatedTerm,
  TermContext,
  TermKind,
  TermExplainerInput,
  TermExplainerResult,
  TermRange,
} from "./term-explainer.schema"

export type TermExplainerStatus = "streaming" | "ready"

type PartialContext = Partial<Omit<TermContext, "range">> & {
  range?: Partial<TermRange>
}

export type TermExplainerProps = Partial<
  Omit<TermExplainerInput, "context" | "aka" | "related" | "source">
> & {
  /** Nested fields may be partial while the tool call streams. */
  context?: PartialContext
  aka?: (string | undefined)[]
  related?: Partial<RelatedTerm>[]
  source?: { name?: string; url?: string }
  /** Lifecycle, controlled by the host. */
  status?: TermExplainerStatus
  /** Called when the user taps a related term. The explainer never locks. */
  onResult?: (result: TermExplainerResult) => void
  /**
   * Terms already asked about (from history). Those buttons render as asked
   * and aren't sent again; the others stay usable.
   */
  result?: TermExplainerResult | TermExplainerResult[]
  className?: string
}

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const appear = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

const statusIcon: Record<RangeStatus, typeof CheckIcon> = {
  within: CircleCheckIcon,
  above: ArrowUpIcon,
  below: ArrowDownIcon,
}

/** Title icon per field: a tinted box. */
const KINDS: Record<TermKind, { icon: LucideIcon; tone: string }> = {
  health: {
    icon: HeartPulseIcon,
    tone: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
  },
  finance: {
    icon: CoinsIcon,
    tone: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  },
  legal: {
    icon: ScaleIcon,
    tone: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  },
  science: {
    icon: FlaskConicalIcon,
    tone: "bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-400",
  },
  technology: {
    icon: CpuIcon,
    tone: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  },
  general: {
    icon: BookOpenIcon,
    tone: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
  },
}

/** Judgement colours for the scale: in range green, outside amber. */
const scaleTone: Record<RangeStatus, { band: string; marker: string }> = {
  within: {
    band: "bg-emerald-500/45 dark:bg-emerald-400/45",
    marker: "bg-emerald-500 dark:bg-emerald-400",
  },
  above: {
    band: "bg-orange-500/45 dark:bg-orange-400/45",
    marker: "bg-orange-500 dark:bg-orange-400",
  },
  below: {
    band: "bg-orange-500/45 dark:bg-orange-400/45",
    marker: "bg-orange-500 dark:bg-orange-400",
  },
}

/** Keeps an edge label inside the bar: left-aligned at 0%, right-aligned at 100%. */
const edgeLabel = (pct: number): React.CSSProperties => ({
  left: `${pct}%`,
  transform: `translateX(-${pct}%)`,
})

function ContextBlock({
  context,
  id,
}: {
  context: PartialContext & { value: string }
  id: string
}) {
  const locale = useGenUILocale()
  const range = context.range
  const value = resolveValue(context)
  const status = rangeStatus(value, range?.low, range?.high)
  const scale = rangeScale(value, range?.low, range?.high)
  const rangeText = formatRange(range, locale)
  const Icon = status ? statusIcon[status] : null
  const unit = range?.unit
  const hasLow = typeof range?.low === "number"
  const hasHigh = typeof range?.high === "number"
  // One quiet line: the range in words only when the bar can't show it.
  const metaLine = [
    !scale && rangeText ? `Range ${rangeText}` : null,
    range?.source,
    context.note,
  ]
    .filter((p): p is string => !!p)
    .join(" · ")

  return (
    <motion.section
      {...appear}
      aria-labelledby={id}
      className="flex flex-col gap-3 border-t border-border px-3 py-3"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h4 id={id} className={genuiType.label}>
            {context.label ?? "Your value"}
          </h4>
          {metaLine && (
            <p className={cn(genuiType.meta, "ml-auto text-right")}>
              {metaLine}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <p className={genuiType.stat}>{context.value}</p>
          {status && Icon && (
            <p>
              <Badge variant={status === "within" ? "success" : "warning"}>
                <Icon aria-hidden />
                {statusLabel(status)}
              </Badge>
            </p>
          )}
        </div>
      </div>

      {scale && (
        <div className="flex flex-col gap-1">
          {/* Visual only: the sentence below carries the same information. */}
          <div
            aria-hidden
            className="relative h-1.5 rounded-full bg-muted dark:bg-white/15"
          >
            <div
              className={cn(
                "absolute inset-y-0 rounded-full",
                status ? scaleTone[status].band : "bg-foreground/25",
              )}
              style={{
                left: `${scale.bandStart}%`,
                width: `${scale.bandEnd - scale.bandStart}%`,
              }}
            />
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={genuiMotion.fade}
              className={cn(
                "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                status ? scaleTone[status].marker : "bg-foreground",
              )}
              style={{ left: `${scale.valuePct}%` }}
            />
          </div>
          <div
            aria-hidden
            className={cn(genuiType.meta, "relative h-4 tabular-nums")}
          >
            {hasLow && (
              <span
                className="absolute top-0"
                style={edgeLabel(scale.bandStart)}
              >
                {withUnit(formatNumber(range?.low as number, locale), unit)}
              </span>
            )}
            {hasHigh && (
              <span className="absolute top-0" style={edgeLabel(scale.bandEnd)}>
                {withUnit(formatNumber(range?.high as number, locale), unit)}
              </span>
            )}
          </div>
          <p className="sr-only">{describeValue(context, locale)}</p>
        </div>
      )}
    </motion.section>
  )
}

export function TermExplainer({
  term,
  kind,
  pronunciation,
  category,
  definition,
  context,
  aka = [],
  related = [],
  source,
  disclaimer,
  status: statusProp,
  onResult,
  result,
  className,
}: TermExplainerProps) {
  const status: TermExplainerStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const id = React.useId()

  // Asked = restored from history, plus what the user tapped here.
  const [asked, setAsked] = React.useState<Set<string>>(() => new Set())
  const [message, setMessage] = React.useState("")
  const restored = React.useMemo(() => {
    const list = result === undefined ? [] : [result].flat()
    return new Set(list.map((r) => r.term))
  }, [result])
  const isAsked = (t: string) => restored.has(t) || asked.has(t)

  const names = [
    ...new Set(
      aka.filter((a): a is string => typeof a === "string" && !!a.trim()),
    ),
  ]
  const terms = related.filter(
    (r): r is RelatedTerm => typeof r?.term === "string" && !!r.term.trim(),
  )
  const kindInfo = kind ? KINDS[kind] : undefined
  const hasContext = typeof context?.value === "string" && !!context.value
  const sourceUrl = safeHttpUrl(source?.url)
  const disclaimerLine = disclaimerText(disclaimer, hasContext)

  const explain = (t: string) => {
    if (streaming || isAsked(t)) return
    setAsked((prev) => new Set(prev).add(t))
    setMessage(`Asked about ${t}`)
    onResult?.({ action: "explain", term: t })
  }

  const meta: { key: string; node: React.ReactNode }[] = []
  if (pronunciation) {
    meta.push({
      key: "say",
      node: (
        <>
          <span className="sr-only">Pronounced </span>
          {pronunciation}
        </>
      ),
    })
  }
  if (names.length > 0) {
    meta.push({ key: "aka", node: `Also called ${names.join(", ")}` })
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="term-explainer"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={term ? `${id}-term` : undefined}
        aria-label={term ? undefined : "Term explanation"}
        className={className}
      >
        <SurfaceHeader
          className={cn("pb-3", kindInfo && "flex-row items-center gap-3")}
        >
          {kindInfo && (
            <span
              aria-hidden
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
                kindInfo.tone,
              )}
            >
              <kindInfo.icon className="size-5" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <SurfaceTitle id={`${id}-term`}>{term}</SurfaceTitle>
              {category && <Badge variant="info">{category}</Badge>}
            </div>
            {meta.length > 0 && (
              <p
                className={cn(
                  genuiType.meta,
                  "flex flex-wrap items-center gap-x-1.5",
                )}
              >
                {meta.map((m, i) => (
                  <React.Fragment key={m.key}>
                    {i > 0 && <span aria-hidden>·</span>}
                    <span>{m.node}</span>
                  </React.Fragment>
                ))}
              </p>
            )}
          </div>
        </SurfaceHeader>

        <div
          className={cn(
            genuiType.body,
            "flex flex-col gap-2 border-t border-border px-3 py-3 leading-relaxed text-pretty",
          )}
        >
          {definition ? (
            <motion.p {...appear}>{definition}</motion.p>
          ) : streaming ? (
            <div aria-hidden className="flex flex-col gap-2 py-0.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : null}
          {streaming && !definition && !term && (
            <ShimmeringText
              text="Looking it up…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px]"
            />
          )}
        </div>

        {hasContext && context && (
          <ContextBlock
            context={context as PartialContext & { value: string }}
            id={`${id}-context`}
          />
        )}

        {terms.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-3">
            <h4 id={`${id}-related`} className={genuiType.label}>
              Related
            </h4>
            <ul
              aria-labelledby={`${id}-related`}
              className="flex flex-wrap gap-x-4 gap-y-1"
            >
              {terms.map((r) => {
                const done = isAsked(r.term)
                return (
                  <motion.li key={r.term} {...appear}>
                    <WhyDisabled
                      when={streaming || done}
                      reason={done ? "Already asked" : "Still loading…"}
                    >
                      <button
                        type="button"
                        disabled={streaming || done}
                        aria-label={
                          done
                            ? `Asked about ${r.term}`
                            : `Explain ${r.term}${r.short ? `: ${r.short}` : ""}`
                        }
                        onClick={() => explain(r.term)}
                        className={cn(
                          genuiType.body,
                          "relative", genuiHit, "inline-flex min-h-7 items-center gap-1.5 rounded-sm underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground disabled:pointer-events-none disabled:text-muted-foreground disabled:no-underline",
                          focusRing,
                        )}
                      >
                        {done && <CheckIcon aria-hidden className="size-3.5" />}
                        {r.term}
                      </button>
                    </WhyDisabled>
                  </motion.li>
                )
              })}
            </ul>
          </div>
        )}

        {(disclaimerLine || source?.name) && (
          <p
            className={cn(
              genuiType.meta,
              "flex items-start gap-1.5 border-t border-border px-3 py-3",
            )}
          >
            {disclaimerLine ? (
              <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            ) : (
              <BookOpenIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            )}
            <span className="min-w-0">
              {disclaimerLine}
              {disclaimerLine && source?.name && <span aria-hidden> · </span>}
              {source?.name &&
                (sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className={cn(
                      "rounded-sm underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground",
                      focusRing,
                    )}
                  >
                    <span className="sr-only">Source: </span>
                    {source.name}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <>
                    <span className="sr-only">Source: </span>
                    {source.name}
                  </>
                ))}
            </span>
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {message}
        </p>
      </Surface>
    </MotionConfig>
  )
}
