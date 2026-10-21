"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  FormField,
  FormFieldGroup,
  formInputClass,
  formTextareaClass,
} from "@/components/genui/form-field"

import type {
  RecoveryPanelInput,
  RecoveryPanelResult,
} from "./recovery-panel.schema"
import {
  countdownText,
  fieldError,
  formatCountdown,
  kindLabel,
  moreCount,
  msUntil,
  partialCounts,
  previousError,
  primaryLabel,
  type RecoveryFieldType,
  type RecoveryKind,
  type RecoveryOptionType,
  recommendedOption,
  recordText,
  revealAnnouncement,
  safeHttpUrl,
  splitText,
} from "./recovery-panel-utils"
import { WhyDisabled } from "@/components/genui/hint"

export type RecoveryPanelStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "chosen"
  | "cancelled"

type PartialField = {
  id?: string
  label?: string
  type?: RecoveryFieldType
  value?: string
  error?: string
  required?: boolean
}
type ReadyField = PartialField & { id: string; label: string }

type PartialChoice = { id?: string; label?: string; detail?: string }
type ReadyChoice = PartialChoice & { id: string; label: string }

/** Any option, possibly partial while streaming. */
export type PartialRecoveryOption = {
  id?: string
  type?: RecoveryOptionType
  label?: string
  actionLabel?: string
  detail?: string
  availableAt?: string
  service?: string
  to?: string
  messagePreview?: string
  fields?: PartialField[]
  choices?: PartialChoice[]
  verb?: string
  consequence?: string
  url?: string
}
type ReadyOption = PartialRecoveryOption & {
  id: string
  type: RecoveryOptionType
  label: string
}

type Completed = NonNullable<RecoveryPanelInput["completed"]>
type Failed = NonNullable<RecoveryPanelInput["failed"]>

export type RecoveryPanelProps = Partial<
  Omit<RecoveryPanelInput, "options" | "completed" | "failed">
> & {
  /** May be partial while the tool call streams. */
  completed?: Partial<Completed>
  failed?: Partial<Omit<Failed, "items">> & {
    items?: Partial<NonNullable<Failed["items"]>[number]>[]
  }
  options?: PartialRecoveryOption[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: RecoveryPanelStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: RecoveryPanelResult) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Renders the
   * compact record and never calls onResult.
   */
  result?: RecoveryPanelResult
  className?: string
}

const isReadyOption = (o: PartialRecoveryOption): o is ReadyOption =>
  typeof o.id === "string" &&
  typeof o.type === "string" &&
  typeof o.label === "string"

const readyFields = (o: PartialRecoveryOption) =>
  (o.fields ?? []).filter(
    (f): f is ReadyField =>
      typeof f.id === "string" && typeof f.label === "string",
  )

const readyChoices = (o: PartialRecoveryOption) =>
  (o.choices ?? []).filter(
    (c): c is ReadyChoice =>
      typeof c.id === "string" && typeof c.label === "string",
  )

/**
 * A clock that starts after mount (so SSR stays deterministic) and ticks each
 * second only while one of the deadlines is still ahead.
 */
function useNow(deadlines: string[]) {
  const key = deadlines.join("|")
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    const list = key ? key.split("|") : []
    const pending = (t: number) => list.some((d) => msUntil(d, t) > 0)
    const first = Date.now()
    setNow(first)
    if (!pending(first)) return
    const timer = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (!pending(t)) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [key])
  return now
}

/** Options that reveal inline UI when selected. */
const hasPanel = (o: ReadyOption) =>
  o.type === "fix-input" ||
  o.type === "alternative" ||
  o.type === "request-access" ||
  o.type === "reconnect"

function Indicator({ checked }: { checked: boolean }) {
  return <RadioMark checked={checked} className="-mt-0.5" />
}

/**
 * "Available in 1:52" with the clock's digits rolling as it counts down.
 * Each digit rolls on its own, so the seconds keep their leading zero.
 */
function RollingWait({ text, ms }: { text: string; ms: number }) {
  const clock = formatCountdown(ms)
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const digit = (n: number) => <SlidingNumber number={n} initiallyStable />
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {text.endsWith(clock) ? text.slice(0, -clock.length) : `${text} `}
        {h > 0 ? (
          <>
            {digit(h)}:{digit(Math.floor(m / 10))}
            {digit(m % 10)}
          </>
        ) : (
          digit(m)
        )}
        :{digit(Math.floor(s / 10))}
        {digit(s % 10)}
      </span>
    </>
  )
}

/** The failure as the title; the kind is spoken, the title already says it. */
function Header({
  title,
  titleId,
  kind,
  children,
}: {
  title?: string
  titleId: string
  kind?: RecoveryKind
  children?: React.ReactNode
}) {
  return (
    <SurfaceHeader className="pb-3">
      <SurfaceTitle id={titleId}>
        {title}
        {title && kind && (
          <span className="sr-only">{`. ${kindLabel[kind]}`}</span>
        )}
      </SurfaceTitle>
      {children}
    </SurfaceHeader>
  )
}

const fadeIn = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

export function RecoveryPanel({
  title,
  kind,
  explanation,
  completed,
  failed,
  nothingChanged,
  options = [],
  status: statusProp,
  onResult,
  result,
  className,
}: RecoveryPanelProps) {
  const [final, setFinal] = React.useState<RecoveryPanelResult | null>(
    result ?? null,
  )
  const [selectedId, setSelectedId] = React.useState<string | null>(
    result?.action === "recover" ? result.optionId : null,
  )
  const [choices, setChoices] = React.useState<Record<string, string>>({})
  const [values, setValues] = React.useState<
    Record<string, Record<string, string>>
  >({})
  const [messages, setMessages] = React.useState<Record<string, string>>({})
  const [touched, setTouched] = React.useState<Set<string>>(() => new Set())
  const [attempted, setAttempted] = React.useState(false)
  const [choiceError, setChoiceError] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const baseId = React.useId()
  const titleId = `${baseId}-title`

  const decision = final
    ? final.action === "cancel"
      ? "cancelled"
      : "chosen"
    : null
  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: RecoveryPanelStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready" && status !== "streaming"
  const done = status === "chosen" || status === "cancelled"

  const ready = options.filter(isReadyOption)
  const cancelOption = ready.find((o) => o.type === "cancel")
  const cards = ready.filter((o) => o.type !== "cancel")
  const recommended = recommendedOption(cards)
  const selected = cards.find((o) => o.id === selectedId) ?? recommended

  const now = useNow(
    done || streaming
      ? []
      : cards.flatMap((o) =>
          o.type === "retry" && o.availableAt ? [o.availableAt] : [],
        ),
  )
  // Disabled until the clock starts after mount, then until availableAt.
  const isWaiting = (o: ReadyOption) =>
    o.type === "retry" &&
    o.availableAt !== undefined &&
    (now === null || msUntil(o.availableAt, now) > 0)
  const waitText = (o: ReadyOption) =>
    o.type === "retry" && now !== null
      ? countdownText(o.availableAt, now)
      : null

  const counts = partialCounts(completed, failed)
  const failedItems = (failed?.items ?? []).filter(
    (i): i is { id: string; label: string; reason?: string } =>
      typeof i.id === "string" && typeof i.label === "string",
  )
  const completedItems = (completed?.items ?? []).filter(
    (i): i is string => typeof i === "string",
  )
  const more = moreCount(completed?.count, completedItems.length)

  const fieldId = (o: ReadyOption, f: ReadyField) =>
    `${baseId}-${o.id}-field-${f.id}`
  const rawValue = (o: ReadyOption, f: ReadyField) =>
    values[o.id]?.[f.id] ?? f.value ?? ""
  const shownError = (o: ReadyOption, f: ReadyField) =>
    attempted || touched.has(`${o.id}:${f.id}`)
      ? fieldError(f, rawValue(o, f))
      : previousError(f, rawValue(o, f))
  const chosenChoice = (o: ReadyOption) => {
    const list = readyChoices(o)
    return (
      list.find((c) => c.id === choices[o.id]) ??
      (list.length === 1 ? list[0] : undefined)
    )
  }
  const message = (o: ReadyOption) => messages[o.id] ?? o.messagePreview ?? ""

  const invalidCount =
    attempted && selected?.type === "fix-input"
      ? readyFields(selected).filter((f) =>
          fieldError(f, rawValue(selected, f)),
        ).length
      : 0

  const select = (o: ReadyOption) => {
    setSelectedId(o.id)
    setAttempted(false)
    setChoiceError(false)
    setAnnouncement(revealAnnouncement(o, waitText(o)))
  }

  const finish = (r: RecoveryPanelResult) => {
    setFinal(r)
    onResult?.(r)
  }

  const submit = () => {
    if (locked || streaming || !selected || isWaiting(selected)) return
    const base = {
      action: "recover",
      optionId: selected.id,
      type: selected.type,
    } as const
    switch (selected.type) {
      case "fix-input": {
        setAttempted(true)
        const fields = readyFields(selected)
        const firstInvalid = fields.find((f) =>
          fieldError(f, rawValue(selected, f)),
        )
        if (firstInvalid) {
          document.getElementById(fieldId(selected, firstInvalid))?.focus()
          return
        }
        return finish({
          ...base,
          values: Object.fromEntries(
            fields.map((f) => [f.id, rawValue(selected, f).trim()]),
          ),
        })
      }
      case "alternative": {
        const choice = chosenChoice(selected)
        if (!choice) {
          setChoiceError(true)
          document.getElementById(`${baseId}-${selected.id}-choice-0`)?.focus()
          return
        }
        return finish({ ...base, choiceId: choice.id })
      }
      case "request-access":
        return finish({ ...base, message: message(selected).trim() })
      default:
        return finish(base)
    }
  }

  const cancel = () => finish({ action: "cancel" })

  // Chosen or cancelled: a compact record for the chat history.
  if (done && final) {
    const option =
      final.action === "recover"
        ? ready.find((o) => o.id === final.optionId)
        : undefined
    const choice =
      final.action === "recover" && option && final.choiceId
        ? readyChoices(option).find((c) => c.id === final.choiceId)
        : undefined
    const fields =
      final.action === "recover" && option && final.values
        ? readyFields(option)
        : []
    const sentMessage =
      final.action === "recover" && final.type === "request-access"
        ? final.message
        : undefined
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="recovery-panel"
          data-status={status}
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : "Couldn't finish"}
          className={className}
        >
          <Header title={title} titleId={titleId} kind={kind} />
          {(fields.length > 0 || sentMessage) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="border-t border-border px-3 py-3"
            >
              {fields.length > 0 && final.action === "recover" && (
                <dl className="flex flex-col gap-2">
                  {fields.map((f) => (
                    <div
                      key={f.id}
                      className="flex flex-col gap-0.5 sm:flex-row sm:gap-4"
                    >
                      <dt className={cn(genuiType.label, "sm:w-1/3 sm:pt-0.5")}>
                        {f.label}
                      </dt>
                      <dd className={cn(genuiType.body, "break-words")}>
                        {final.values?.[f.id] || "Not provided"}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {sentMessage && (
                <p
                  className={cn(
                    genuiType.body,
                    "break-words whitespace-pre-line",
                  )}
                >
                  “{sentMessage}”
                </p>
              )}
            </motion.div>
          )}
          <SurfaceFooter aria-live="polite">
            {status === "chosen" ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {recordText(final, option, choice?.label)}
              </p>
            ) : (
              <p className={genuiType.meta}>{recordText(final)}</p>
            )}
          </SurfaceFooter>
        </Surface>
      </MotionConfig>
    )
  }

  const hasOutcome = Boolean(completed?.label || failed?.label)
  const showSplit =
    Boolean(completed && failed) && counts.done > 0 && counts.failed > 0
  const groupName = `${baseId}-option`
  const contactUrl =
    selected?.type === "contact" ? safeHttpUrl(selected.url) : null
  const primaryDisabled =
    locked || streaming || !selected || isWaiting(selected)
  const primaryText =
    status === "submitting"
      ? "Working…"
      : selected
        ? primaryLabel(selected, choices[selected.id])
        : "Continue"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="recovery-panel"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Couldn't finish"}
        className={className}
      >
        <Header title={title} titleId={titleId} kind={kind}>
          {explanation || nothingChanged ? (
            <p className={genuiType.meta}>
              {explanation}
              {explanation && nothingChanged && " "}
              {nothingChanged && (
                <span className="font-medium text-foreground">
                  Nothing was changed.
                </span>
              )}
            </p>
          ) : (
            streaming && <Skeleton className="h-3 w-full max-w-sm" />
          )}
        </Header>

        <AutoHeight>
          {hasOutcome && (
            <motion.div
              {...fadeIn}
              data-slot="recovery-panel-outcome"
              className="flex flex-col gap-3 border-t border-border px-3 py-3"
            >
              {showSplit ? (
                <div className="flex flex-col gap-1.5">
                  <p className={cn(genuiType.body, "font-medium tabular-nums")}>
                    {splitText(counts, completed?.verb)}
                  </p>
                  {/* Decorative: the line above carries the numbers. */}
                  <div
                    aria-hidden
                    className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
                  >
                    <motion.div
                      className="h-full rounded-l-full bg-emerald-500 dark:bg-emerald-400"
                      initial={false}
                      animate={{ width: `${counts.donePercent}%` }}
                      transition={genuiMotion.gentle}
                    />
                    <div className="h-full flex-1 rounded-r-full bg-destructive" />
                  </div>
                </div>
              ) : (
                <>
                  {completed?.label && (
                    <p className={cn(genuiType.body, "font-medium")}>
                      {completed.label}
                    </p>
                  )}
                  {failed?.label && (
                    <p className={cn(genuiType.body, "font-medium")}>
                      {failed.label}
                    </p>
                  )}
                </>
              )}

              {/* What worked is spoken; what failed is listed, since it's what to fix. */}
              {completedItems.length > 0 && (
                <p className="sr-only">
                  {`${completed?.label ?? "Done"}: ${completedItems.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`}
                </p>
              )}
              {failed?.label && failedItems.length > 0 && (
                <ul aria-label={failed.label} className="flex flex-col gap-1.5">
                  {failedItems.map((item) => (
                    <motion.li
                      key={item.id}
                      {...fadeIn}
                      className="flex flex-col"
                    >
                      <span className={cn(genuiType.body, "break-words")}>
                        {item.label}
                      </span>
                      {item.reason && (
                        <span className={cn(genuiType.meta, "break-words")}>
                          {item.reason}
                        </span>
                      )}
                    </motion.li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}

          {(cards.length > 0 || streaming) && (
            <fieldset
              data-slot="recovery-panel-options"
              disabled={locked || streaming}
              className="min-w-0 border-0 border-t border-border p-0"
            >
              <legend className="sr-only">How do you want to continue?</legend>
              <div className="flex flex-col py-2">
                {cards.map((o) => {
                  const isSel = selected?.id === o.id
                  const panelId = `${baseId}-${o.id}-panel`
                  const subtitleId = `${baseId}-${o.id}-subtitle`
                  const wait = waitText(o)
                  // Visible: what changes the decision (a consequence, a wait).
                  const subtitle =
                    o.type === "skip"
                      ? o.consequence
                      : o.type === "retry"
                        ? (wait ?? undefined)
                        : undefined
                  // Spoken only: the agent's side notes.
                  const spoken = [
                    o.id === recommended?.id ? "Recommended" : null,
                    o.type === "retry" ? o.detail : null,
                    o.type === "request-access" && o.to ? `To ${o.to}` : null,
                  ]
                    .filter(Boolean)
                    .join(". ")
                  const panel =
                    isSel && hasPanel(o) ? (
                      <OptionPanel
                        option={o}
                        baseId={baseId}
                        fieldId={fieldId}
                        rawValue={rawValue}
                        shownError={shownError}
                        chosenChoice={chosenChoice(o)}
                        choiceError={choiceError}
                        message={message(o)}
                        onValue={(f, v) =>
                          setValues((prev) => ({
                            ...prev,
                            [o.id]: { ...prev[o.id], [f.id]: v },
                          }))
                        }
                        onBlur={(f) =>
                          setTouched((prev) =>
                            new Set(prev).add(`${o.id}:${f.id}`),
                          )
                        }
                        onChoice={(c) => {
                          setChoices((prev) => ({ ...prev, [o.id]: c.id }))
                          setChoiceError(false)
                        }}
                        onMessage={(v) =>
                          setMessages((prev) => ({ ...prev, [o.id]: v }))
                        }
                      />
                    ) : null
                  return (
                    <motion.div
                      key={o.id}
                      {...fadeIn}
                      data-slot="recovery-panel-option"
                      data-selected={isSel}
                      className={cn("px-3 py-2.5 transition-colors")}
                    >
                      <label className="-mx-3 -my-2 flex min-h-10 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted dark:hover:bg-white/5 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:hover:bg-transparent dark:has-disabled:hover:bg-transparent">
                        <input
                          type="radio"
                          name={groupName}
                          value={o.id}
                          checked={isSel}
                          onChange={() => select(o)}
                          aria-describedby={
                            subtitle || spoken ? subtitleId : undefined
                          }
                          aria-controls={panel ? panelId : undefined}
                          className="sr-only"
                        />
                        <Indicator checked={isSel} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              genuiType.body,
                              "font-medium break-words",
                            )}
                          >
                            {o.label}
                          </span>
                          {(subtitle || spoken) && (
                            <span
                              id={subtitleId}
                              className={cn(genuiType.meta, "tabular-nums")}
                            >
                              {wait && now !== null && o.type === "retry" ? (
                                <RollingWait
                                  text={wait}
                                  ms={msUntil(o.availableAt, now)}
                                />
                              ) : (
                                subtitle
                              )}
                              {spoken && (
                                <span className="sr-only">
                                  {subtitle ? `. ${spoken}` : spoken}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </label>
                      {panel && (
                        <motion.div
                          id={panelId}
                          {...fadeIn}
                          className="mt-3 pl-9"
                        >
                          {panel}
                        </motion.div>
                      )}
                    </motion.div>
                  )
                })}
                {streaming && (
                  <div aria-hidden className="flex gap-3 px-3 py-2.5">
                    <Skeleton className="size-4 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                )}
                {streaming && cards.length === 0 && (
                  <div aria-hidden className="flex gap-3 px-3 py-2.5">
                    <Skeleton className="size-4 rounded-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                )}
              </div>
            </fieldset>
          )}
        </AutoHeight>

        {/* Announces the selected option and the fields it reveals. */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <SurfaceFooter className="justify-between gap-3">
          <p aria-live="polite" className={genuiType.meta}>
            {streaming ? (
              <ShimmeringText
                text="Preparing options…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : status === "submitting" ? (
              "Working…"
            ) : invalidCount > 0 ? (
              <span className="text-destructive">
                {invalidCount === 1
                  ? "1 field needs attention."
                  : `${invalidCount} fields need attention.`}
              </span>
            ) : choiceError ? (
              <span className="text-destructive">Choose one to continue.</span>
            ) : null}
          </p>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {cancelOption && (
              <Button
                size="sm"
                variant="secondary"
                onClick={cancel}
                disabled={locked || streaming}
              >
                {cancelOption.label}
              </Button>
            )}
            {contactUrl && !primaryDisabled ? (
              <a
                href={contactUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(e) => {
                  // Open before recording: the record view replaces this link,
                  // and a disconnected link can't navigate.
                  e.preventDefault()
                  window.open(contactUrl, "_blank", "noopener,noreferrer")
                  submit()
                }}
                className={buttonVariants({ size: "sm" })}
              >
                {primaryText}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <WhyDisabled
                when={!locked && !streaming && primaryDisabled}
                reason={
                  !selected ? "Choose an option first" : "Not available yet"
                }
              >
                <Button size="sm" onClick={submit} disabled={primaryDisabled}>
                  {primaryText}
                </Button>
              </WhyDisabled>
            )}
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

/** The inline UI a selected option reveals. */
function OptionPanel({
  option: o,
  baseId,
  fieldId,
  rawValue,
  shownError,
  chosenChoice,
  choiceError,
  message,
  onValue,
  onBlur,
  onChoice,
  onMessage,
}: {
  option: ReadyOption
  baseId: string
  fieldId: (o: ReadyOption, f: ReadyField) => string
  rawValue: (o: ReadyOption, f: ReadyField) => string
  shownError: (o: ReadyOption, f: ReadyField) => string | null
  chosenChoice: ReadyChoice | undefined
  choiceError: boolean
  message: string
  onValue: (f: ReadyField, value: string) => void
  onBlur: (f: ReadyField) => void
  onChoice: (c: ReadyChoice) => void
  onMessage: (value: string) => void
}) {
  switch (o.type) {
    case "fix-input":
      return (
        <FormFieldGroup>
          {readyFields(o).map((f) => {
            const id = fieldId(o, f)
            const errId = `${id}-error`
            const error = shownError(o, f)
            const type = f.type ?? "text"
            return (
              <FormField
                key={f.id}
                htmlFor={id}
                label={f.label}
                required={f.required}
                filled={rawValue(o, f) !== ""}
                // A date input shows its own format, so its label stays up.
                pinned={type === "date"}
                error={error}
                errorId={errId}
              >
                <Input
                  id={id}
                  type={
                    type === "email"
                      ? "email"
                      : type === "date"
                        ? "date"
                        : "text"
                  }
                  inputMode={type === "number" ? "decimal" : undefined}
                  autoComplete="off"
                  value={rawValue(o, f)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errId : undefined}
                  aria-required={f.required || undefined}
                  onChange={(e) => onValue(f, e.target.value)}
                  onBlur={() => onBlur(f)}
                  className={formInputClass}
                />
              </FormField>
            )
          })}
        </FormFieldGroup>
      )
    case "alternative": {
      const list = readyChoices(o)
      const errId = `${baseId}-${o.id}-choice-error`
      return (
        <fieldset
          className="min-w-0"
          aria-describedby={choiceError ? errId : undefined}
        >
          <legend className="sr-only">{o.label}</legend>
          <div className="-mx-3 flex flex-col gap-1">
            {list.map((c, i) => (
              <label
                key={c.id}
                className="flex min-h-10 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted dark:hover:bg-white/5 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-disabled:hover:bg-transparent dark:has-disabled:hover:bg-transparent"
              >
                <input
                  id={`${baseId}-${o.id}-choice-${i}`}
                  type="radio"
                  name={`${baseId}-${o.id}-choice`}
                  value={c.id}
                  checked={chosenChoice?.id === c.id}
                  onChange={() => onChoice(c)}
                  className="sr-only"
                />
                <Indicator checked={chosenChoice?.id === c.id} />
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className={cn(genuiType.body, "break-words")}>
                    {c.label}
                  </span>
                  {c.detail && (
                    <span className={genuiType.meta}>{c.detail}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {choiceError && (
            <p
              id={errId}
              className="mt-1 text-[13px] leading-4 text-destructive"
            >
              Choose one to continue.
            </p>
          )}
        </fieldset>
      )
    }
    case "request-access": {
      const id = `${baseId}-${o.id}-message`
      return (
        <FormField
          htmlFor={id}
          label={o.to ? `Message to ${o.to}` : "Message"}
          pinned
        >
          <Textarea
            id={id}
            value={message}
            maxLength={500}
            onChange={(e) => onMessage(e.target.value)}
            className={formTextareaClass}
          />
        </FormField>
      )
    }
    case "reconnect":
      return (
        <p className={genuiType.meta}>
          {`Opens ${o.service ?? "the service"} sign-in. No password here.`}
        </p>
      )
    default:
      return null
  }
}
