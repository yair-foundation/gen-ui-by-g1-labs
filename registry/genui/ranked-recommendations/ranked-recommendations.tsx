"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  ContrastIcon,
  MinusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

import type {
  RankedRecommendationsInput,
  RankedRecommendationsResult,
  RecommendationConstraint,
  RecommendationItem,
  RecommendationSource,
} from "./ranked-recommendations.schema"
import {
  type ConstraintRow,
  constraintLegend,
  describeConstraint,
  formatPrice,
  formatScore,
  safeImageSrc,
  safeUrl,
  sanitizeSelection,
  sortByRank,
  splitMarkers,
  summarizeConstraints,
  toggleSelection,
} from "./ranked-recommendations-utils"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type RankedRecommendationsStatus =
  | "streaming"
  | "ready"
  | "selected"
  | "more"
  | "dismissed"

type Decision = "selected" | "more" | "dismissed"

export type RankedRecommendationsProps = Partial<
  Omit<RankedRecommendationsInput, "items" | "constraints" | "sources">
> & {
  /** Items, constraints and sources may be partial while the tool call streams. */
  items?: Partial<RecommendationItem>[]
  constraints?: Partial<RecommendationConstraint>[]
  sources?: Partial<RecommendationSource>[]
  /** Lifecycle, controlled by the host. */
  status?: RankedRecommendationsStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: RankedRecommendationsResult) => void
  /** A decision from history. Restores the finished state; never calls onResult. */
  result?: RankedRecommendationsResult
  className?: string
}

type ReadyItem = Partial<RecommendationItem> & { id: string; name: string }
type ReadySource = RecommendationSource & { n: number }

const decisionOf: Record<RankedRecommendationsResult["action"], Decision> = {
  select: "selected",
  more: "more",
  dismiss: "dismissed",
}

const strings = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : []

// ---- Pieces ----------------------------------------------------------------

function Thumb({ item, featured }: { item: ReadyItem; featured: boolean }) {
  const src = safeImageSrc(item.image?.src)
  const [failed, setFailed] = React.useState<string | null>(null)
  if (!src || failed === src) return null
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={item.image?.alt ?? ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn(
        "shrink-0 rounded-lg bg-transparent object-cover",
        featured ? "size-16" : "size-12",
      )}
    />
  )
}

/** A reason with its "[n]" markers turned into links to the sources list. */
function Reason({
  text,
  byN,
  streaming,
  onJump,
  listId,
}: {
  text: string
  byN: Map<number, ReadySource>
  streaming: boolean
  onJump: (n: number) => void
  listId: string
}) {
  return (
    <>
      {splitMarkers(text, streaming).map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and append-only
        <React.Fragment key={i}>
          {part.kind === "text"
            ? part.value
            : // Markers pointing at a source that wasn't provided are dropped.
              part.refs
                .map((n) => byN.get(n))
                .filter((s): s is ReadySource => !!s)
                .map((s) => (
                  <sup key={s.n} className="ml-0.5">
                    <IconTip label={`Source ${s.n}: ${s.title}`}>
                      <a
                        href={`#${listId}-${s.n}`}
                        aria-label={`Source ${s.n}: ${s.title}`}
                        onClick={(e) => {
                          e.preventDefault()
                          onJump(s.n)
                        }}
                        className="rounded-sm px-0.5 text-[13px] font-medium text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        [{s.n}]
                      </a>
                    </IconTip>
                  </sup>
                ))}
        </React.Fragment>
      ))}
    </>
  )
}

function ConstraintCheck({ row }: { row: ConstraintRow }) {
  const missedMust = row.state === "missed" && row.constraint.kind === "must"
  const Icon =
    row.state === "met"
      ? CheckIcon
      : row.state === "missed"
        ? XIcon
        : ContrastIcon
  return (
    <li
      data-state={row.state}
      className={cn(
        "inline-flex items-center gap-1",
        row.state === "met" ? "text-foreground" : "text-muted-foreground",
        missedMust && "text-destructive",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span aria-hidden>{row.constraint.label}</span>
      <span className="sr-only">{describeConstraint(row)}</span>
    </li>
  )
}

type RowProps = {
  item: ReadyItem
  featured: boolean
  constraints: RecommendationConstraint[]
  byN: Map<number, ReadySource>
  streaming: boolean
  listId: string
  onJump: (n: number) => void
  selectable: "none" | "single" | "multiple"
  groupName: string
  selected: boolean
  locked: boolean
  onSelect: () => void
}

function RecommendationRow({
  item,
  featured,
  constraints,
  byN,
  streaming,
  listId,
  onJump,
  selectable,
  groupName,
  selected,
  locked,
  onSelect,
}: RowProps) {
  const locale = useGenUILocale()
  const score = formatScore(item.score, locale)
  const price = formatPrice(item.price, locale)
  const href = safeUrl(item.url)
  // The top pick shows its full case; the rest show their lead reason and
  // main trade-off, so the list stays scannable.
  const why = strings(item.why).slice(0, featured ? 3 : 1)
  const tradeoffs = strings(item.tradeoffs).slice(0, featured ? 2 : 1)
  const tags = strings(item.tags).slice(0, 3)
  const summary = summarizeConstraints(item.meets ?? undefined, constraints)
  const checks = summary.rows.filter((r) => r.state !== "unknown")
  const missed = summary.missedMusts.length
  const rank = typeof item.rank === "number" ? item.rank : undefined
  const chooseLabel = `Choose ${item.name}${rank ? `, ranked ${rank}` : ""}`

  return (
    <motion.li
      data-slot="ranked-recommendations-item"
      data-featured={featured || undefined}
      data-selected={selected || undefined}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className={cn(
        "flex gap-3 rounded-[10px] px-3 py-2 transition-colors",
        selected && "bg-accent",
      )}
    >
      {selectable === "single" && (
        // A 24px tap target: an sr-only native radio and its visible mark.
        <label
          className={cn(
            "-m-1 flex size-6 shrink-0 items-center justify-center rounded-full has-[:disabled]:opacity-60",
            !locked && "cursor-pointer",
          )}
        >
          <input
            type="radio"
            name={groupName}
            value={item.id}
            checked={selected}
            disabled={locked}
            onChange={onSelect}
            aria-label={chooseLabel}
            className="peer sr-only"
          />
          <RadioMark
            checked={selected}
            className="size-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
          />
        </label>
      )}
      {selectable === "multiple" && (
        <Checkbox
          nativeButton
          size="sm"
          aria-label={chooseLabel}
          checked={selected}
          disabled={locked}
          onCheckedChange={onSelect}
          // Larger tap area than the 18px box, without changing its look.
          className="relative mt-0.5 after:absolute after:-inset-2"
        />
      )}

      <span
        aria-hidden
        className={cn(
          "w-6 shrink-0 text-[13px] leading-5 tabular-nums text-muted-foreground",
          featured ? "pt-0.5" : "pt-px",
        )}
      >
        {rank !== undefined ? `#${rank}` : ""}
      </span>

      <Thumb item={item} featured={featured} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-col gap-1 @md:flex-row @md:items-start @md:justify-between @md:gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4
                className={cn(
                  featured
                    ? "text-[20px] leading-tight font-semibold tracking-tight"
                    : "text-[13px] leading-snug font-semibold",
                )}
              >
                {rank !== undefined && (
                  <span className="sr-only">{`Rank ${rank}: `}</span>
                )}
                {featured && <span className="sr-only">Top pick: </span>}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {item.name}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  item.name
                )}
              </h4>
            </div>
            {(item.subtitle || tags.length > 0) && (
              <p className="sr-only">
                {[item.subtitle, tags.join(", ")].filter(Boolean).join(". ")}
              </p>
            )}
          </div>
          {(score || price) && (
            <div className="flex shrink-0 items-baseline gap-3 @md:flex-col @md:items-end @md:gap-0.5">
              {score && (
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    featured
                      ? "text-[14px] leading-5"
                      : "text-[13px] leading-5",
                  )}
                >
                  <span aria-hidden>{score.text}</span>
                  <span className="sr-only">{score.spoken}</span>
                </span>
              )}
              {price && (
                <span className={cn(genuiType.meta, "tabular-nums")}>
                  {price}
                </span>
              )}
            </div>
          )}
        </div>

        {missed > 0 && (
          <p className="flex items-center gap-1.5 text-[13px] leading-4 font-medium text-destructive">
            <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0" />
            {missed === 1
              ? "Misses a must-have"
              : `Misses ${missed} must-haves`}
          </p>
        )}

        {(why.length > 0 || tradeoffs.length > 0) && (
          <div
            className={cn(
              "grid gap-1",
              why.length > 0 &&
                tradeoffs.length > 0 &&
                "@md:grid-cols-2 @md:gap-x-4",
            )}
          >
            {why.length > 0 && (
              <ul
                aria-label={`Why ${item.name}`}
                className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-5 marker:text-muted-foreground"
              >
                {why.map((reason, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: reasons are positional and append-only
                  <li key={i}>
                    <Reason
                      text={reason}
                      byN={byN}
                      streaming={streaming}
                      onJump={onJump}
                      listId={listId}
                    />
                  </li>
                ))}
              </ul>
            )}
            {tradeoffs.length > 0 && (
              <ul
                aria-label={`Trade-offs of ${item.name}`}
                className="flex flex-col gap-1 text-[13px] leading-5"
              >
                {tradeoffs.map((t, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: trade-offs are positional and append-only
                  <li key={i} className="flex gap-1.5">
                    <MinusIcon
                      aria-hidden
                      className="mt-[0.2rem] size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0">
                      <Reason
                        text={t}
                        byN={byN}
                        streaming={streaming}
                        onJump={onJump}
                        listId={listId}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {checks.length > 0 && (
          <ul
            aria-label={`Constraints for ${item.name}`}
            className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-4"
          >
            {checks.map((row) => (
              <ConstraintCheck key={row.constraint.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </motion.li>
  )
}

function RowSkeleton({ featured }: { featured: boolean }) {
  return (
    <li aria-hidden className="flex gap-3 px-3 py-2">
      <Skeleton className="h-4 w-6" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className={cn("w-1/2", featured ? "h-7" : "h-4")} />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
    </li>
  )
}

// ---- Component -------------------------------------------------------------

export function RankedRecommendations({
  title,
  basis,
  constraints = [],
  items = [],
  sources = [],
  selectable = "none",
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: RankedRecommendationsProps) {
  const [decision, setDecision] = React.useState<Decision | null>(() =>
    result ? decisionOf[result.action] : null,
  )
  const [selected, setSelected] = React.useState<string[]>(() =>
    result?.action === "select" ? result.itemIds : [],
  )
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [reason, setReason] = React.useState(
    result?.action === "more" ? (result.reason ?? "") : "",
  )
  const [highlight, setHighlight] = React.useState<number | null>(null)
  const recordRef = React.useRef<HTMLParagraphElement>(null)
  const moveFocus = React.useRef(false)
  const baseId = React.useId()
  const listId = `${baseId}-src`
  const groupName = `${baseId}-choice`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: RankedRecommendationsStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  // After a decision made here (not one restored from history), move focus to
  // the record so keyboard users land on the outcome.
  React.useEffect(() => {
    if (decision && moveFocus.current) {
      moveFocus.current = false
      recordRef.current?.focus()
    }
  }, [decision])

  const readyConstraints = constraints.filter(
    (c): c is RecommendationConstraint =>
      typeof c.id === "string" &&
      typeof c.label === "string" &&
      (c.kind === "must" || c.kind === "nice"),
  )
  const legend = constraintLegend(readyConstraints)
  const ready = sortByRank(
    items.filter(
      (i): i is ReadyItem =>
        typeof i.id === "string" &&
        typeof i.name === "string" &&
        i.name.trim() !== "",
    ),
  )
  const readySources: ReadySource[] = sources.flatMap((s, i) =>
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.url === "string"
      ? [{ ...(s as RecommendationSource), n: i + 1 }]
      : [],
  )
  const byN = new Map(readySources.map((s) => [s.n, s]))

  const max = selectable === "single" ? 1 : undefined
  const ids = ready.map((i) => i.id)
  const chosen = sanitizeSelection(selected, ids, max)
  const chosenNames = ready
    .filter((i) => chosen.includes(i.id))
    .map((i) => i.name)

  const jumpTo = (n: number) => {
    setHighlight(n)
    requestAnimationFrame(() => {
      const el = document.getElementById(`${listId}-${n}`)
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      el?.querySelector("a")?.focus({ preventScroll: true })
    })
    setTimeout(() => setHighlight((h) => (h === n ? null : h)), 1600)
  }

  const decide = (next: Decision, r: RankedRecommendationsResult) => {
    moveFocus.current = true
    setDecision(next)
    onResult?.(r)
  }

  const submit = () => {
    if (locked || chosen.length === 0) return
    setSelected(chosen)
    decide("selected", { action: "select", itemIds: chosen })
  }

  const askForMore = () => {
    if (locked) return
    const text = reason.trim()
    setMoreOpen(false)
    decide("more", text ? { action: "more", reason: text } : { action: "more" })
  }

  const dismiss = () => {
    if (locked) return
    decide("dismissed", { action: "dismiss" })
  }

  const heading = title ? (
    <SurfaceTitle>{title}</SurfaceTitle>
  ) : streaming && !basis ? (
    <Skeleton className="h-4 w-48" />
  ) : null

  // Read to screen readers only: the rows already show what's checked.
  const selectionText =
    selectable === "single"
      ? chosenNames[0]
        ? `Selected: ${chosenNames[0]}`
        : null
      : selectable === "multiple" && chosen.length > 0
        ? `${chosen.length} selected`
        : null

  const record =
    status === "selected" ? (
      <>
        <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {chosenNames.length > 0
            ? `Chose ${chosenNames.join(", ")}`
            : `Chose ${chosen.length || selected.length} ${
                (chosen.length || selected.length) === 1 ? "option" : "options"
              }`}
        </span>
      </>
    ) : status === "more" ? (
      <>
        <RefreshCwIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Asked for other options
          {reason.trim() && (
            <span className="text-foreground">: “{reason.trim()}”</span>
          )}
        </span>
      </>
    ) : status === "dismissed" ? (
      <>
        <XIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>Dismissed</span>
      </>
    ) : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="ranked-recommendations"
        data-status={status}
        data-selectable={selectable}
        aria-busy={streaming}
        aria-label={title ?? "Recommendations"}
        className={cn("@container", className)}
      >
        <SurfaceHeader className="pb-3">
          {heading}
          {/* The basis and the must/nice legend restate the request; the
              per-item checks carry the constraints visually. */}
          {basis && <p className="sr-only">{basis}</p>}
          {(legend.must.length > 0 || legend.nice.length > 0) && (
            <p className="sr-only">
              {legend.must.length > 0 &&
                `Must have: ${legend.must.join(", ")}. `}
              {legend.nice.length > 0 &&
                `Nice to have: ${legend.nice.join(", ")}.`}
            </p>
          )}
        </SurfaceHeader>

        <AutoHeight>
          <ol
            aria-label={title ? `${title}, ranked` : "Ranked options"}
            className="flex flex-col gap-1 border-t border-border p-2"
          >
            {ready.map((item, index) => (
              <RecommendationRow
                key={item.id}
                item={item}
                featured={index === 0}
                constraints={readyConstraints}
                byN={byN}
                streaming={streaming}
                listId={listId}
                onJump={jumpTo}
                selectable={selectable}
                groupName={groupName}
                selected={chosen.includes(item.id)}
                locked={locked}
                onSelect={() =>
                  setSelected((prev) =>
                    toggleSelection(
                      sanitizeSelection(prev, ids, max),
                      item.id,
                      max,
                    ),
                  )
                }
              />
            ))}
            {streaming && <RowSkeleton featured={ready.length === 0} />}
          </ol>

          {readySources.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
              <p
                id={`${listId}-label`}
                className="flex items-center gap-2 text-[15px] font-medium"
              >
                Sources
                <Badge variant="info" className="tabular-nums">
                  {readySources.length}
                </Badge>
              </p>
              <ol
                aria-labelledby={`${listId}-label`}
                className="flex flex-col divide-y divide-border overflow-hidden rounded-[10px] border border-border"
              >
                {readySources.map((s) => {
                  const url = safeUrl(s.url)
                  const host = url
                    ? new URL(url).hostname.replace(/^www\./, "")
                    : ""
                  return (
                    <li
                      key={s.n}
                      id={`${listId}-${s.n}`}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 transition-colors duration-500",
                        highlight === s.n && "bg-muted dark:bg-white/5",
                      )}
                    >
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] leading-none font-medium text-muted-foreground tabular-nums dark:bg-white/10">
                        {s.n}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:justify-between @md:gap-4">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="min-w-0 rounded-sm text-[14px] font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            {s.title}
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        ) : (
                          <span className="min-w-0 text-[14px] font-medium">
                            {s.title}
                          </span>
                        )}
                        {host && (
                          <span
                            className={cn(
                              genuiType.meta,
                              "shrink-0 @md:text-right",
                            )}
                          >
                            {host}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </AutoHeight>

        <SurfaceFooter
          aria-live="polite"
          className="flex-col items-stretch gap-3 @md:flex-row @md:items-center @md:justify-between"
        >
          {record ? (
            <p
              ref={recordRef}
              tabIndex={-1}
              className="flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground outline-none"
            >
              {record}
            </p>
          ) : moreOpen ? (
            <div className="flex w-full flex-col gap-2">
              <Textarea
                autoFocus
                aria-label="What should be different? (optional)"
                placeholder="What should be different? (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                    askForMore()
                  if (e.key === "Escape") setMoreOpen(false)
                }}
                className="min-h-16"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setMoreOpen(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={askForMore}>
                  Show other options
                </Button>
              </div>
            </div>
          ) : (
            <>
              {streaming ? (
                <p className={genuiType.meta}>
                  <ShimmeringText
                    text="Ranking options…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                </p>
              ) : selectionText ? (
                <p className="sr-only">{selectionText}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 @md:ml-auto @md:shrink-0">
                {selectable !== "none" && (
                  <IconTip label="Not now">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Not now"
                      disabled={locked}
                      onClick={dismiss}
                      className="relative after:absolute after:-inset-1"
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </IconTip>
                )}
                <Button
                  size="sm"
                  variant={selectable === "none" ? "default" : "ghost"}
                  disabled={locked}
                  onClick={() => setMoreOpen(true)}
                  className="flex-1 @md:flex-none"
                >
                  Show other options
                </Button>
                {selectable !== "none" && (
                  <WhyDisabled reason={!locked && chosen.length === 0 && "Select at least one"} className="inline-flex flex-1 @md:flex-none">
                    <Button
                      size="sm"
                      disabled={locked || chosen.length === 0}
                      onClick={submit}
                      className="flex-1 @md:flex-none"
                    >
                      {submitLabel ??
                        (selectable === "single"
                          ? "Choose this"
                          : "Choose these")}
                    </Button>
                  </WhyDisabled>
                )}
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
