"use client"

import * as React from "react"
import { CheckIcon, ExternalLinkIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
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
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { CheckMark } from "@/components/genui/genui-motion"

import {
  countsText,
  formatCorrectionValue,
  groupItems,
  metaText,
  resultText,
  sameValue,
  validateCorrection,
} from "./assumptions-utils"
import type {
  AssumptionItem,
  AssumptionKind,
  AssumptionsInput,
  AssumptionsResult,
  Correction,
  CorrectionValue,
} from "./assumptions.schema"

/** Explains a disabled button. Disabled controls swallow pointer events, so the span takes the hover. */
export type AssumptionsStatus =
  | "streaming"
  | "ready"
  | "corrected"
  | "confirmed"

type PartialItem = Partial<AssumptionItem>
type ReadyItem = PartialItem & {
  id: string
  kind: AssumptionKind
  statement: string
}

export type AssumptionsProps = Partial<Omit<AssumptionsInput, "items">> & {
  /** Items may be partial while the tool call streams. */
  items?: PartialItem[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props. When omitted, the component tracks the user's decision.
   */
  status?: AssumptionsStatus
  /** Called once when the user sends corrections or confirms everything. */
  onResult?: (result: AssumptionsResult) => void
  /** A decision from history. Restores the finished record and locks; never calls onResult. */
  result?: AssumptionsResult
  className?: string
}

const KINDS: AssumptionKind[] = [
  "assumption",
  "unknown",
  "constraint",
  "data-limit",
]

const kindNames: Record<AssumptionKind, string> = {
  assumption: "Assumption",
  unknown: "Not known",
  constraint: "Constraint",
  "data-limit": "Data limit",
}

/** What "it holds" means for each kind. */
const confirmLabels: Record<AssumptionKind, string> = {
  assumption: "Looks right",
  unknown: "Fine without it",
  constraint: "Understood",
  "data-limit": "Understood",
}

/** Only http(s) links are rendered as links; anything else is dropped. */
function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}

/** Where the editor starts: the user's last value, else the agent's. */
function initialDraft(correction: Correction, current?: CorrectionValue) {
  const start = current ?? correction.value
  switch (correction.type) {
    case "boolean":
      // Correcting a yes/no means flipping it.
      return current !== undefined
        ? Boolean(current)
        : typeof start === "boolean"
          ? !start
          : false
    case "select":
      return typeof start === "string" && correction.options?.includes(start)
        ? start
        : null
    default:
      return start === undefined ? "" : String(start)
  }
}

function CorrectionEditor({
  correction,
  draft,
  onChange,
  onSave,
  onCancel,
  label,
  errorId,
  invalid,
}: {
  correction: Correction
  draft: unknown
  onChange: (value: unknown) => void
  onSave: () => void
  onCancel: () => void
  label: string
  errorId: string
  invalid: boolean
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel()
    if (e.key === "Enter") {
      e.preventDefault()
      onSave()
    }
  }
  const described = invalid ? errorId : undefined

  switch (correction.type) {
    case "boolean":
      return (
        <span className="inline-flex items-center gap-2 text-[13px]">
          <Switch
            nativeButton
            autoFocus
            aria-label={label}
            checked={Boolean(draft)}
            onCheckedChange={(on) => onChange(on)}
            className="relative after:absolute after:-inset-2"
          />
          <span aria-hidden>{draft ? "Yes" : "No"}</span>
        </span>
      )
    case "select":
      if (correction.options?.length) {
        const items = correction.options.map((o) => ({ value: o, label: o }))
        return (
          <Select
            value={typeof draft === "string" ? draft : null}
            onValueChange={(v) => onChange(v)}
            items={items}
          >
            <SelectTrigger
              autoFocus
              aria-label={label}
              aria-invalid={invalid || undefined}
              aria-describedby={described}
              className="min-w-44"
            >
              <SelectValue placeholder="Choose…" />
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
      break
    case "number":
      return (
        <span className="inline-flex items-center gap-2 text-[13px]">
          <Input
            autoFocus
            type="number"
            inputMode="decimal"
            aria-label={
              correction.unit ? `${label} (${correction.unit})` : label
            }
            aria-invalid={invalid || undefined}
            aria-describedby={described}
            value={typeof draft === "string" ? draft : ""}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-32"
          />
          {correction.unit && (
            <span aria-hidden className="text-muted-foreground">
              {correction.unit}
            </span>
          )}
        </span>
      )
  }
  return (
    <Input
      autoFocus
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={described}
      value={typeof draft === "string" ? draft : ""}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className="min-w-0 flex-1 sm:max-w-72"
    />
  )
}

function ItemRow({
  item,
  corrected,
  confirmed,
  locked,
  disabled,
  onCorrect,
  onUndo,
  onConfirm,
}: {
  item: ReadyItem
  corrected: CorrectionValue | undefined
  confirmed: boolean
  /** Sent: the row becomes a read-only record. */
  locked: boolean
  /** Still streaming: actions show but can't be used yet. */
  disabled: boolean
  onCorrect: (value: CorrectionValue) => void
  onUndo: () => void
  onConfirm: (on: boolean) => void
}) {
  const locale = useGenUILocale()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<unknown>(null)
  const [error, setError] = React.useState<string | null>(null)
  const actionsRef = React.useRef<HTMLDivElement>(null)
  const restoreFocus = React.useRef(false)
  const errorId = React.useId()

  const correction = item.correction
  const isCorrected = corrected !== undefined && correction !== undefined
  const meta = metaText(item.confidence, item.impact)
  const url = safeUrl(item.sourceUrl)
  const highImpact = item.impact === "high"
  // One visible flag at most: what needs a look. The full rating is spoken.
  const flag = highImpact
    ? "High impact"
    : item.confidence === "low"
      ? "Low confidence"
      : null

  // Return focus to the row's actions when the editor closes.
  React.useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false
      actionsRef.current?.querySelector("button")?.focus()
    }
  }, [editing])

  if (locked && editing) setEditing(false)

  const open = () => {
    if (!correction) return
    setDraft(initialDraft(correction, corrected))
    setError(null)
    setEditing(true)
  }
  const close = () => {
    restoreFocus.current = true
    setEditing(false)
  }
  const save = () => {
    if (!correction) return
    const checked = validateCorrection(correction, draft)
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    // Saving the value that was assumed is the same as "Looks right".
    if (sameValue(checked.value, correction.value)) {
      onUndo()
      onConfirm(true)
    } else {
      onCorrect(checked.value)
    }
    close()
  }

  const correctLabel = item.kind === "unknown" ? "I can tell you" : "Correct"

  return (
    <motion.li
      layout="position"
      data-slot="assumptions-item"
      data-kind={item.kind}
      data-impact={item.impact}
      data-corrected={isCorrected || undefined}
      data-confirmed={confirmed || undefined}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="flex flex-col gap-2 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          {isCorrected ? (
            <>
              <p className={cn(genuiType.meta, "line-through")}>
                <span className="sr-only">{`${kindNames[item.kind]}, was: `}</span>
                {item.statement}
              </p>
              <p className={cn(genuiType.body, "font-medium break-words")}>
                <span className="sr-only">Corrected by you to: </span>
                {formatCorrectionValue(correction, corrected, locale)}
              </p>
            </>
          ) : (
            <>
              <p className={genuiType.body}>
                <span className="sr-only">{`${kindNames[item.kind]}: `}</span>
                {item.statement}
                {item.basis && (
                  <span className="sr-only">{` Based on: ${item.basis}.`}</span>
                )}
                {meta && <span className="sr-only">{` ${meta}.`}</span>}
              </p>
              {(flag || url) && (
                <p className={cn(genuiType.meta, "flex flex-wrap gap-x-1.5")}>
                  {flag && (
                    <span
                      aria-hidden
                      className={cn(
                        highImpact && "font-medium text-foreground",
                      )}
                    >
                      {flag}
                    </span>
                  )}
                  {flag && url && <span aria-hidden>·</span>}
                  {url && (
                    <a
                      href={url.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      Source
                      <ExternalLinkIcon aria-hidden className="size-3" />
                      <span className="sr-only">
                        {` for “${item.statement}” (opens in a new tab)`}
                      </span>
                    </a>
                  )}
                </p>
              )}
            </>
          )}
        </div>

        {editing && correction ? null : locked ? (
          confirmed &&
          !isCorrected && (
            <p className={cn(genuiType.meta, "flex items-center gap-1")}>
              <CheckIcon aria-hidden className="size-3.5" />
              Confirmed
            </p>
          )
        ) : (
          <div ref={actionsRef} className="flex shrink-0 items-center gap-1.5">
            {isCorrected ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={open}
                >
                  Change
                  <span className="sr-only">{` your correction to “${item.statement}”`}</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={onUndo}
                >
                  Undo
                  <span className="sr-only">{` your correction to “${item.statement}”`}</span>
                </Button>
              </>
            ) : (
              <>
                {correction && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    onClick={open}
                  >
                    {correctLabel}
                    <span className="sr-only">{`: ${item.statement}`}</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={confirmed ? "secondary" : "ghost"}
                  aria-pressed={confirmed}
                  disabled={disabled}
                  onClick={() => onConfirm(!confirmed)}
                >
                  {confirmed && <CheckMark className="size-4" />}
                  {confirmLabels[item.kind]}
                  <span className="sr-only">{`: ${item.statement}`}</span>
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {editing && correction && (
        <div className="flex flex-col gap-1.5">
          {item.basis && (
            <p aria-hidden className={genuiType.meta}>
              {item.basis}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <CorrectionEditor
              correction={correction}
              draft={draft}
              onChange={(v) => {
                setDraft(v)
                setError(null)
              }}
              onSave={save}
              onCancel={close}
              label={`Correct “${item.statement}”`}
              errorId={errorId}
              invalid={error !== null}
            />
            <Button size="sm" onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
          {error && (
            <p id={errorId} className="text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </motion.li>
  )
}

function RowSkeleton() {
  return (
    <li aria-hidden className="flex flex-col gap-1.5 py-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
    </li>
  )
}

export function Assumptions({
  title = "What this is based on",
  appliesTo,
  items = [],
  status: statusProp,
  onResult,
  result,
  className,
}: AssumptionsProps) {
  const [corrections, setCorrections] = React.useState<
    Record<string, CorrectionValue>
  >(() =>
    result?.action === "redo"
      ? Object.fromEntries(result.corrections.map((c) => [c.id, c.value]))
      : {},
  )
  const [confirmed, setConfirmed] = React.useState<Set<string>>(
    () => new Set(result?.action === "redo" ? result.confirmed : []),
  )
  const [sent, setSent] = React.useState<AssumptionsResult | null>(
    result ?? null,
  )
  const decision: AssumptionsStatus | null = sent
    ? sent.action === "redo"
      ? "corrected"
      : "confirmed"
    : null

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: AssumptionsStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status === "corrected" || status === "confirmed"
  const allConfirmed = status === "confirmed"

  const ready = items.filter(
    (i): i is ReadyItem =>
      typeof i.id === "string" &&
      typeof i.statement === "string" &&
      KINDS.includes(i.kind as AssumptionKind),
  )
  const groups = groupItems(ready)
  const idPrefix = React.useId()

  const correctionOf = (i: ReadyItem) =>
    i.correction ? corrections[i.id] : undefined
  const correctedIds = ready
    .filter((i) => correctionOf(i) !== undefined)
    .map((i) => i.id)
  const confirmedIds = ready
    .filter((i) => confirmed.has(i.id) && !correctedIds.includes(i.id))
    .map((i) => i.id)

  const setCorrection = (id: string, value: CorrectionValue | undefined) => {
    setCorrections((prev) => {
      const { [id]: _removed, ...rest } = prev
      return value === undefined ? rest : { ...rest, [id]: value }
    })
    if (value !== undefined) setConfirm(id, false)
  }
  const setConfirm = (id: string, on: boolean) => {
    setConfirmed((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const send = (next: AssumptionsResult) => {
    setSent(next)
    onResult?.(next)
  }
  const redo = () =>
    send({
      action: "redo",
      corrections: ready
        .filter((i) => correctedIds.includes(i.id))
        .map((i) => ({ id: i.id, value: corrections[i.id] })),
      confirmed: confirmedIds,
    })
  const confirmAll = () => send({ action: "confirm-all" })

  // A terminal status from the host without a stored result still reads sensibly.
  const record: AssumptionsResult | null =
    sent ??
    (status === "confirmed"
      ? { action: "confirm-all" }
      : status === "corrected"
        ? {
            action: "redo",
            corrections: correctedIds.map((id) => ({
              id,
              value: corrections[id],
            })),
            confirmed: confirmedIds,
          }
        : null)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="assumptions"
        data-status={status}
        aria-busy={streaming}
        aria-label={title}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
          {appliesTo && <p className="sr-only">{`For: ${appliesTo}`}</p>}
        </SurfaceHeader>

        <AutoHeight>
          {groups.map((group) => {
            const headingId = `${idPrefix}-${group.key}`
            return (
              <motion.section
                key={group.key}
                data-slot="assumptions-group"
                data-group={group.key}
                aria-labelledby={headingId}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className="border-t border-border px-3 pt-3 pb-1"
              >
                <h4 id={headingId} className={genuiType.label}>
                  {group.label}
                </h4>
                <ul>
                  {group.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      corrected={correctionOf(item)}
                      confirmed={
                        allConfirmed ||
                        (confirmed.has(item.id) &&
                          correctionOf(item) === undefined)
                      }
                      locked={locked}
                      disabled={streaming}
                      onCorrect={(v) => setCorrection(item.id, v)}
                      onUndo={() => setCorrection(item.id, undefined)}
                      onConfirm={(on) => setConfirm(item.id, on)}
                    />
                  ))}
                </ul>
              </motion.section>
            )
          })}

          {streaming && (
            <ul className="border-t border-border px-3">
              <RowSkeleton />
              {ready.length === 0 && <RowSkeleton />}
            </ul>
          )}
        </AutoHeight>

        <SurfaceFooter
          aria-live="polite"
          className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          {record ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4" />
              {resultText(record)}
            </p>
          ) : (
            <>
              <p className={cn(genuiType.meta, "tabular-nums")}>
                {streaming ? (
                  <ShimmeringText
                    text="Listing assumptions…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                ) : correctedIds.length + confirmedIds.length > 0 ? (
                  countsText(correctedIds.length, confirmedIds.length)
                ) : null}
              </p>
              <div className="flex flex-wrap gap-2 sm:shrink-0">
                <WhyDisabled
                  when={!streaming && correctedIds.length > 0}
                  reason="You've made corrections"
                  className="flex-1 sm:flex-none"
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={confirmAll}
                    // Confirming everything would drop the user's corrections.
                    disabled={streaming || correctedIds.length > 0}
                    className="flex-1 sm:flex-none"
                  >
                    Everything looks right
                  </Button>
                </WhyDisabled>
                <WhyDisabled
                  when={!streaming && correctedIds.length === 0}
                  reason="Correct something first"
                  className="flex-1 sm:flex-none"
                >
                  <Button
                    size="sm"
                    onClick={redo}
                    disabled={streaming || correctedIds.length === 0}
                    className="flex-1 sm:flex-none"
                  >
                    Redo with corrections
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
