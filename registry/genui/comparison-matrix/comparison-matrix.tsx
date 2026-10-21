"use client"

import * as React from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  MinusIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  type ValuesMap,
  bestItemIds,
  bestScoreIds,
  commonCurrency,
  formatPrice,
  formatValue,
  getValue,
  groupCriteria,
  hasValue,
  isKnown,
  partitionRows,
  ratingFraction,
  safeUrl,
  spokenValue,
  weightedScores,
} from "./comparison-matrix-utils"
import type {
  CompareCriterion,
  CompareItem,
  ComparePrice,
  CompareValue,
  ComparisonMatrixInput,
  ComparisonMatrixResult,
} from "./comparison-matrix.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"

export type ComparisonMatrixStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "selected"
  | "dismissed"

type PartialItem = Partial<Omit<CompareItem, "price">> & {
  price?: Partial<ComparePrice>
}
type ReadyItem = PartialItem & { id: string }
type PartialCriterion = Partial<CompareCriterion>
type ReadyCriterion = PartialCriterion & { id: string; label: string }

export type ComparisonMatrixProps = Partial<
  Omit<
    ComparisonMatrixInput,
    "items" | "criteria" | "values" | "recommendation"
  >
> & {
  /** Items, criteria and values may be partial while the tool call streams. */
  items?: PartialItem[]
  criteria?: PartialCriterion[]
  values?: ValuesMap
  recommendation?: Partial<NonNullable<ComparisonMatrixInput["recommendation"]>>
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: ComparisonMatrixStatus
  /** Called once with the user's choice (only when `selectable`). */
  onResult?: (result: ComparisonMatrixResult) => void
  /**
   * A choice from history. Renders the matrix read-only with the chosen
   * column marked, and never calls onResult.
   */
  result?: ComparisonMatrixResult
  className?: string
}

// The criterion column stays visible while the table scrolls sideways. Solid
// fill so it covers what scrolls beneath it.
const stickyCell = "sticky left-0 z-[1] bg-(--surface-bg)"
const chosenFill = "color-mix(in oklab, var(--muted) 60%, var(--surface-bg))"

function ItemName({ item }: { item: PartialItem }) {
  if (!item.name) return <Skeleton className="h-4 w-24" />
  const href = safeUrl(item.url)
  if (!href) {
    return (
      <span className="text-[13px] font-semibold break-words">{item.name}</span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="rounded-sm text-[13px] font-semibold break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {item.name}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function ItemDetails({
  item,
  recommended,
}: {
  item: PartialItem
  recommended: boolean
}) {
  const locale = useGenUILocale()
  const price = formatPrice(item.price, locale)
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <ItemName item={item} />
      {item.subtitle && <span className="sr-only">{item.subtitle}</span>}
      {price && <span className="text-[13px] tabular-nums">{price}</span>}
      {(recommended || item.badge) && (
        <span className="mt-1 flex flex-wrap gap-1">
          {recommended && <Badge variant="success">Recommended</Badge>}
          {item.badge && <Badge variant="outline">{item.badge}</Badge>}
        </span>
      )}
    </span>
  )
}

function Choice({
  groupName,
  itemId,
  itemName,
  checked,
  disabled,
  onChoose,
  children,
  markFirst = true,
  card = false,
  className,
}: {
  groupName: string
  itemId: string
  itemName: string
  checked: boolean
  disabled: boolean
  onChoose: (id: string) => void
  /** The option's details, made clickable with the radio. Never a link. */
  children?: React.ReactNode
  /** Whether the mark comes before the details (it follows in the table). */
  markFirst?: boolean
  /** Side-by-side options (table columns) are button cards. */
  card?: boolean
  className?: string
}) {
  const mark = (
    // At least 24px tall and wide, so the radio is easy to hit.
    <span
      className={cn(
        "inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center",
        children ? "self-start" : "",
      )}
    >
      <RadioMark
        checked={checked}
        className="size-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-60"
      />
    </span>
  )
  return (
    <label
      className={cn(
        children
          ? className
          : card
            ? "flex min-h-11 w-full items-center justify-center"
            : "inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center gap-2",
        card &&
          cn(
            "rounded-[10px] border border-border px-3 py-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
            !disabled && "hover:bg-muted dark:hover:bg-white/5",
            checked && "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
          ),
        disabled ? "cursor-default" : "cursor-pointer",
      )}
    >
      <input
        type="radio"
        name={groupName}
        value={itemId}
        checked={checked}
        disabled={disabled}
        onChange={() => onChoose(itemId)}
        aria-label={`Choose ${itemName}`}
        className="peer sr-only"
      />
      {markFirst && mark}
      {children}
      {!markFirst && mark}
    </label>
  )
}

function ValueCell({
  value,
  criterion,
  best,
  pending,
  currency,
}: {
  value: CompareValue | undefined
  criterion: PartialCriterion
  best: boolean
  pending: boolean
  currency?: string
}) {
  const locale = useGenUILocale()
  if (pending) return <Skeleton className="h-4 w-16" />
  if (!isKnown(value)) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">not known</span>
      </span>
    )
  }
  if (typeof value === "boolean") {
    return value ? (
      <span className="inline-flex items-center">
        <CheckIcon aria-hidden className="size-4" />
        <span className="sr-only">Yes</span>
      </span>
    ) : (
      <span className="inline-flex items-center text-muted-foreground">
        <MinusIcon aria-hidden className="size-4" />
        <span className="sr-only">No</span>
      </span>
    )
  }
  const text = formatValue(value, criterion, currency, locale)
  const fraction =
    criterion.type === "rating"
      ? ratingFraction(value, criterion.outOf ?? 5)
      : null
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums",
        best && "font-semibold",
      )}
    >
      {best && <TrophyIcon aria-hidden className="size-3.5 shrink-0" />}
      {fraction === null ? (
        <span className="break-words">
          {text}
          {best && <span className="sr-only">, best</span>}
        </span>
      ) : (
        <>
          <span aria-hidden>{text}</span>
          <span className="sr-only">
            {spokenValue(value, criterion, undefined, locale)}
            {best && ", best"}
          </span>
          {/* Decorative: the text is the value. */}
          <span
            aria-hidden
            className="h-1.5 w-10 overflow-hidden rounded-full bg-muted dark:bg-white/10"
          >
            <span
              className="block h-full rounded-full bg-choice"
              style={{ width: `${fraction * 100}%` }}
            />
          </span>
        </>
      )}
    </span>
  )
}

export function ComparisonMatrix({
  title,
  items = [],
  criteria = [],
  values,
  highlight = "differences",
  recommendation,
  selectable = false,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: ComparisonMatrixProps) {
  const [choice, setChoice] = React.useState<string | null>(() =>
    result?.action === "select" ? result.itemId : null,
  )
  const [decision, setDecision] = React.useState<
    "selected" | "dismissed" | null
  >(() =>
    result ? (result.action === "select" ? "selected" : "dismissed") : null,
  )
  const [showSame, setShowSame] = React.useState(false)
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const sameId = `${baseId}-same`
  const sameListId = `${baseId}-same-list`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: ComparisonMatrixStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const canChoose = selectable && status === "ready"
  const showChoice = selectable || status === "selected"

  const readyItems = items.filter(
    (i): i is ReadyItem => typeof i.id === "string",
  )
  const itemIds = readyItems.map((i) => i.id)
  const readyCriteria = criteria.filter(
    (c): c is ReadyCriterion =>
      typeof c.id === "string" && typeof c.label === "string",
  )
  // While streaming, a row appears once its first value arrives.
  const rows = streaming
    ? readyCriteria.filter((c) =>
        itemIds.some((id) => hasValue(values, id, c.id)),
      )
    : readyCriteria
  // Rows are folded only once everything has arrived, so nothing jumps.
  const { different, same } = streaming
    ? { different: rows, same: [] as ReadyCriterion[] }
    : partitionRows(rows, itemIds, values, highlight)
  const groups = groupCriteria(different)
  const currency = commonCurrency(readyItems)

  // Best marks only for rows whose values have all arrived.
  const rowComplete = (c: ReadyCriterion) =>
    !streaming || itemIds.every((id) => hasValue(values, id, c.id))
  const bestFor = (c: ReadyCriterion) =>
    rowComplete(c) ? bestItemIds(c, itemIds, values) : []

  const scoring = streaming
    ? null
    : weightedScores(readyCriteria, itemIds, values)
  const scoreBest = scoring ? bestScoreIds(scoring.scores) : []

  const recommended =
    recommendation?.itemId !== undefined
      ? readyItems.find((i) => i.id === recommendation.itemId)
      : undefined
  const chosen = readyItems.find((i) => i.id === choice)
  const nameOf = (i: PartialItem) => i.name ?? i.id ?? "option"

  const choose = (id: string) => {
    if (canChoose) setChoice(id)
  }
  const submit = () => {
    if (!canChoose || !choice) return
    setDecision("selected")
    onResult?.({ action: "select", itemId: choice })
  }
  const dismiss = () => {
    if (!canChoose) return
    setChoice(null)
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  const columnCount = 1 + Math.max(readyItems.length, streaming ? 2 : 0)
  const cellStyle = (id: string): React.CSSProperties | undefined =>
    showChoice && id === choice ? { background: chosenFill } : undefined
  const sameLabel =
    different.length === 0
      ? `All ${same.length} rows are the same`
      : `${same.length} ${same.length === 1 ? "row is" : "rows are"} the same`

  // -------------------------------------------------------------------------
  // Table (sm and up)
  // -------------------------------------------------------------------------

  const tableRow = (c: ReadyCriterion) => {
    const best = bestFor(c)
    return (
      <motion.tr
        key={c.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="border-b align-top last:border-b-0"
      >
        <th
          scope="row"
          className={cn(
            stickyCell,
            "max-w-56 min-w-36 py-1.5 pr-3 pl-5 text-left font-normal text-muted-foreground",
          )}
        >
          <span className="block text-[13px]">{c.label}</span>
          {c.help && <span className="sr-only">{`, ${c.help}`}</span>}
        </th>
        {readyItems.map((item) => (
          <td
            key={item.id}
            style={cellStyle(item.id)}
            className="min-w-36 px-3 py-1.5 text-[13px] last:pr-5"
          >
            <ValueCell
              value={getValue(values, item.id, c.id)}
              criterion={c}
              best={best.includes(item.id)}
              pending={streaming && !hasValue(values, item.id, c.id)}
              currency={currency}
            />
          </td>
        ))}
      </motion.tr>
    )
  }

  const groupHeading = (group: string) => (
    <tr>
      <th
        colSpan={columnCount}
        scope="rowgroup"
        className="p-0 text-left text-[13px] font-semibold"
      >
        <span className="sticky left-0 inline-block px-3 pt-2 pb-0.5">
          {group}
        </span>
      </th>
    </tr>
  )

  const table = (
    <section
      aria-label={`${title ?? "Comparison"}, table`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard to scroll it
      tabIndex={0}
      className="hidden overflow-x-auto border-t border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:block"
    >
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b align-top">
            <th
              scope="col"
              className={cn(stickyCell, "min-w-36 py-2 pr-3 pl-5 text-left")}
            >
              <span className="sr-only">Criterion</span>
            </th>
            {readyItems.map((item) => (
              <th
                key={item.id}
                scope="col"
                style={cellStyle(item.id)}
                className="min-w-36 px-3 py-2 text-left font-normal last:pr-5"
              >
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex flex-col gap-2"
                >
                  {showChoice && !safeUrl(item.url) ? (
                    // No link in the details: the whole header picks it.
                    <Choice
                      groupName={`${baseId}-table`}
                      itemId={item.id}
                      itemName={nameOf(item)}
                      checked={choice === item.id}
                      disabled={!canChoose}
                      onChoose={choose}
                      markFirst={false}
                      card
                      className="flex flex-col gap-2"
                    >
                      <ItemDetails
                        item={item}
                        recommended={recommended?.id === item.id}
                      />
                    </Choice>
                  ) : (
                    <>
                      <ItemDetails
                        item={item}
                        recommended={recommended?.id === item.id}
                      />
                      {showChoice && (
                        <Choice
                          groupName={`${baseId}-table`}
                          itemId={item.id}
                          itemName={nameOf(item)}
                          checked={choice === item.id}
                          disabled={!canChoose}
                          onChoose={choose}
                          card
                        />
                      )}
                    </>
                  )}
                </motion.div>
              </th>
            ))}
            {streaming &&
              ["first", "second"]
                .slice(0, Math.max(0, 2 - readyItems.length))
                .map((slot) => (
                  <th
                    key={slot}
                    aria-hidden
                    className="min-w-36 px-3 py-3 last:pr-5"
                  >
                    <Skeleton className="h-4 w-24" />
                  </th>
                ))}
          </tr>
        </thead>

        {groups.map(([group, list]) => (
          <tbody key={group || "_"}>
            {group && groupHeading(group)}
            {list.map(tableRow)}
          </tbody>
        ))}

        {streaming && (
          <tbody aria-hidden className="border-t">
            <tr>
              <td colSpan={columnCount} className="px-3 py-3">
                <Skeleton className="h-4" />
              </td>
            </tr>
          </tbody>
        )}

        {same.length > 0 && (
          <>
            <tbody className="border-t">
              <tr>
                <td colSpan={columnCount} className="p-0">
                  <span className="sticky left-0 inline-flex px-3 py-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-expanded={showSame}
                      aria-controls={sameId}
                      onClick={() => setShowSame((v) => !v)}
                    >
                      <ChevronDownIcon
                        aria-hidden
                        className={cn(
                          "transition-transform",
                          showSame && "rotate-180",
                        )}
                      />
                      {sameLabel}
                    </Button>
                  </span>
                </td>
              </tr>
            </tbody>
            <tbody id={sameId} hidden={!showSame} className="border-t">
              {same.map(tableRow)}
            </tbody>
          </>
        )}

        {scoring && (
          <tfoot className="border-t">
            <tr className="align-top">
              <th
                scope="row"
                className={cn(
                  stickyCell,
                  "py-2 pr-3 pl-5 text-left font-normal",
                )}
              >
                <span className="block text-[13px] font-semibold">
                  Score
                  <span className="sr-only"> (weighted, out of 100)</span>
                </span>
              </th>
              {readyItems.map((item) => {
                const best = scoreBest.includes(item.id)
                return (
                  <td
                    key={item.id}
                    style={cellStyle(item.id)}
                    className="px-3 py-2 text-[13px] last:pr-5"
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 tabular-nums",
                        best && "font-semibold",
                      )}
                    >
                      {best && <TrophyIcon aria-hidden className="size-3.5" />}
                      {scoring.scores[item.id]}
                      <span className="sr-only">
                        {` out of 100${best ? ", best" : ""}`}
                      </span>
                    </span>
                  </td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  )

  // -------------------------------------------------------------------------
  // Stacked list (below sm): "Price: A $12 · B $18 · C $9"
  // -------------------------------------------------------------------------

  const stackedRow = (c: ReadyCriterion) => {
    const best = bestFor(c)
    return (
      <motion.li
        key={c.id}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={genuiMotion.fade}
        className="flex flex-col gap-0.5 px-3 py-2"
      >
        <span className={genuiType.label}>
          {c.label}
          {c.help && <span className="sr-only">{`, ${c.help}`}</span>}
        </span>
        <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
          {readyItems.map((item, i) => (
            <li key={item.id} className="inline-flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
              )}
              <span className="text-muted-foreground">{nameOf(item)}</span>
              <ValueCell
                value={getValue(values, item.id, c.id)}
                criterion={c}
                best={best.includes(item.id)}
                pending={streaming && !hasValue(values, item.id, c.id)}
                currency={currency}
              />
            </li>
          ))}
        </ul>
      </motion.li>
    )
  }

  const stackedItems = readyItems.map((item) => (
    <motion.li
      key={item.id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      style={cellStyle(item.id)}
      className="px-3 py-2.5"
    >
      {showChoice && !safeUrl(item.url) ? (
        // No link in the details: the whole row picks it.
        <Choice
          groupName={`${baseId}-list`}
          itemId={item.id}
          itemName={nameOf(item)}
          checked={choice === item.id}
          disabled={!canChoose}
          onChoose={choose}
          className={cn(
            "-mx-3 -my-2.5 flex items-start gap-2 px-3 py-2.5 transition-colors [&>span:first-of-type]:-my-0.5",
            canChoose && "hover:bg-muted",
          )}
        >
          <ItemDetails item={item} recommended={recommended?.id === item.id} />
        </Choice>
      ) : (
        <div className="flex items-start gap-2">
          {showChoice && (
            <span className="-my-0.5">
              <Choice
                groupName={`${baseId}-list`}
                itemId={item.id}
                itemName={nameOf(item)}
                checked={choice === item.id}
                disabled={!canChoose}
                onChoose={choose}
              />
            </span>
          )}
          <ItemDetails item={item} recommended={recommended?.id === item.id} />
        </div>
      )}
    </motion.li>
  ))

  const stacked = (
    <div className="border-t border-border sm:hidden">
      {showChoice ? (
        <fieldset>
          <legend className="sr-only">
            {title ? `Choose one: ${title}` : "Choose one option"}
          </legend>
          <ul className="divide-y">{stackedItems}</ul>
        </fieldset>
      ) : (
        <ul className="divide-y">{stackedItems}</ul>
      )}
      {streaming && readyItems.length === 0 && (
        <div aria-hidden className="flex flex-col gap-2 px-3 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      )}

      <ScrollFade
        label={`${title ?? "Comparison"}, rows`}
        className="max-h-64"
        viewportClassName="overflow-y-auto"
      >
        {groups.map(([group, list]) => (
          <section
            key={group || "_"}
            aria-label={group || undefined}
            className="border-t"
          >
            {group && (
              <h4 className="px-3 pt-3 pb-1 text-[13px] font-semibold">
                {group}
              </h4>
            )}
            <ul className="divide-y">{list.map(stackedRow)}</ul>
          </section>
        ))}

        {streaming && (
          <div aria-hidden className="border-t px-3 py-3">
            <Skeleton className="h-4" />
          </div>
        )}

        {same.length > 0 && (
          <div className="border-t">
            <div className="px-3 py-2">
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={showSame}
                aria-controls={sameListId}
                onClick={() => setShowSame((v) => !v)}
              >
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    "transition-transform",
                    showSame && "rotate-180",
                  )}
                />
                {sameLabel}
              </Button>
            </div>
            <ul
              id={sameListId}
              hidden={!showSame}
              className="divide-y border-t"
            >
              {same.map(stackedRow)}
            </ul>
          </div>
        )}

      </ScrollFade>

      {scoring && (
        <div className="flex flex-col gap-1 border-t px-3 py-3">
          <span className="text-[13px] font-semibold">
            Score
            <span className="sr-only"> (weighted, out of 100)</span>
          </span>
          <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
            {readyItems.map((item, i) => {
              const best = scoreBest.includes(item.id)
              return (
                <li key={item.id} className="inline-flex items-center gap-1.5">
                  {i > 0 && (
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                  )}
                  <span className="text-muted-foreground">{nameOf(item)}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 tabular-nums",
                      best && "font-semibold",
                    )}
                  >
                    {best && <TrophyIcon aria-hidden className="size-3.5" />}
                    {scoring.scores[item.id]}
                    <span className="sr-only">
                      {` out of 100${best ? ", best" : ""}`}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )

  const showFooter =
    selectable || streaming || status === "selected" || status === "dismissed"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="comparison-matrix"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>
            {title ?? (streaming ? undefined : "Comparison")}
          </SurfaceTitle>
          {recommended && recommendation?.reason && (
            <p className="mt-1 text-[13px]">
              <span className="font-semibold">
                Recommended: {nameOf(recommended)}.
              </span>{" "}
              <span className="text-muted-foreground">
                {recommendation.reason}
              </span>
            </p>
          )}
        </SurfaceHeader>

        {/* Height animates as rows stream in and the same rows unfold. */}
        <AutoHeight>
          {table}
          {stacked}
        </AutoHeight>

        {showFooter && (
          <SurfaceFooter aria-live="polite" className="justify-between gap-3">
            {status === "selected" ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4" />
                Chose {chosen ? nameOf(chosen) : choice}
              </p>
            ) : status === "dismissed" ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <XIcon aria-hidden className="size-4" />
                Dismissed
              </p>
            ) : (
              <>
                <p className={genuiType.meta}>
                  {streaming ? (
                    <ShimmeringText
                      text="Loading comparison…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : status === "submitting" ? (
                    "Saving…"
                  ) : chosen ? (
                    <span className="sr-only">Selected: {nameOf(chosen)}</span>
                  ) : null}
                </p>
                {selectable && (
                  <div className="ml-auto flex gap-2">
                    <WhyDisabled when={!canChoose} reason="Already answered">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={dismiss}
                        disabled={!canChoose}
                      >
                        None of these
                      </Button>
                    </WhyDisabled>
                    <WhyDisabled
                      when={!canChoose || !chosen}
                      reason="Pick an option first"
                    >
                      <Button
                        size="sm"
                        onClick={submit}
                        disabled={!canChoose || !chosen}
                      >
                        {status === "submitting"
                          ? "Saving…"
                          : (submitLabel ?? "Choose")}
                      </Button>
                    </WhyDisabled>
                  </div>
                )}
              </>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
