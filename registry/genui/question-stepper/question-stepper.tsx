"use client"

import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  XIcon,
} from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  genuiType,
} from "@/components/genui/surface"
import { CheckMark, RadioMark } from "@/components/genui/genui-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WhyDisabled } from "@/components/genui/hint"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  FormField,
  formTextareaClass,
  formTextareaUnlabeledClass,
} from "@/components/genui/form-field"

import type {
  Question,
  QuestionAnswer,
  QuestionStepperInput,
  QuestionStepperResult,
} from "./question-stepper.schema"

export type QuestionStepperStatus =
  | "streaming"
  | "ready"
  | "submitted"
  | "dismissed"

type PartialQuestion = Partial<
  Omit<Question, "type" | "allowOther" | "required">
> & {
  type?: Question["type"]
  allowOther?: boolean
  required?: boolean
}

type ReadyQuestion = PartialQuestion & { id: string; prompt: string }

export type QuestionStepperProps = Partial<
  Omit<QuestionStepperInput, "questions">
> & {
  /** Questions may be partial while the tool call is still streaming. */
  questions?: PartialQuestion[]
  /**
   * Lifecycle, controlled by the host. While 'streaming', the user can already
   * answer the questions that have arrived, but cannot submit.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: QuestionStepperStatus
  /** Called once with the user's answers. Send it back to the agent. */
  onResult?: (result: QuestionStepperResult) => void
  /**
   * Answers from history (e.g. the tool call's stored output). Renders the
   * submitted summary and never calls onResult.
   */
  result?: QuestionStepperResult
  className?: string
}

type Draft = { selected: string[]; text: string; delegated: boolean }

const emptyDraft: Draft = { selected: [], text: "", delegated: false }

function hasAnswer(q: PartialQuestion, d: Draft) {
  if (d.delegated) return true
  if (q.type === "text") return d.text.trim() !== ""
  return d.selected.length > 0 || d.text.trim() !== ""
}

function toAnswer(q: ReadyQuestion, d: Draft): QuestionAnswer {
  if (d.delegated) return { id: q.id, status: "delegated" }
  if (!hasAnswer(q, d)) return { id: q.id, status: "skipped" }
  const text = d.text.trim()
  return {
    id: q.id,
    status: "answered",
    ...(q.type !== "text" && d.selected.length ? { selected: d.selected } : {}),
    ...(text ? { text } : {}),
  }
}

function describeAnswer(q: ReadyQuestion, d: Draft) {
  if (d.delegated) return "Agent decides"
  if (!hasAnswer(q, d)) return "Skipped"
  const labels = d.selected.map(
    (v) => q.options?.find((o) => o.value === v)?.label ?? v,
  )
  if (d.text.trim()) labels.push(d.text.trim())
  return labels.join(", ")
}

function OptionRow({
  label,
  description,
  recommended,
  checked,
  multi,
  onSelect,
}: {
  label?: string
  description?: string
  recommended?: boolean
  checked: boolean
  multi: boolean
  onSelect: () => void
}) {
  const ariaProps = {
    role: multi ? "checkbox" : "radio",
    "aria-checked": checked,
  }
  return (
    <button
      type="button"
      {...ariaProps}
      onClick={onSelect}
      className={cn(
        "group/option flex w-full cursor-pointer items-start gap-3 rounded-[10px] px-3 py-3 text-left transition-colors outline-none",
        "hover:bg-muted dark:hover:bg-white/5 focus-visible:ring-3 focus-visible:ring-ring/50",
        checked && "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
      )}
    >
      {multi ? (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input",
            checked && "border-choice bg-choice text-background",
          )}
        >
          {checked && <CheckMark className="size-3" />}
        </span>
      ) : (
        // Our 24px radio, pulled into the 20px line so rows keep their height.
        <RadioMark checked={checked} className="-my-0.5" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            genuiType.body,
            "flex flex-wrap items-center gap-2 font-medium",
          )}
        >
          {label}
          {recommended && <Badge variant="info">Recommended</Badge>}
        </span>
        {description && <span className={genuiType.meta}>{description}</span>}
      </span>
    </button>
  )
}

export function QuestionStepper({
  title,
  questions = [],
  allowDelegate = true,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: QuestionStepperProps) {
  const [index, setIndex] = React.useState(0)
  // 1 = forward, -1 = back; drives the slide direction between questions.
  const [direction, setDirection] = React.useState(1)
  const [furthest, setFurthest] = React.useState(0)
  // Restored from `result` when the answers are already in history.
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() =>
    result?.action === "submit"
      ? Object.fromEntries(
          result.answers.map((a) => [
            a.id,
            {
              selected: a.selected ?? [],
              text: a.text ?? "",
              delegated: a.status === "delegated",
            },
          ]),
        )
      : {},
  )
  const [decision, setDecision] = React.useState<
    "submitted" | "dismissed" | null
  >(() =>
    result ? (result.action === "submit" ? "submitted" : "dismissed") : null,
  )
  const otherRef = React.useRef<HTMLInputElement>(null)
  const headingId = React.useId()
  const descId = React.useId()
  const hintId = React.useId()
  const answerId = React.useId()

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: QuestionStepperStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const done = status === "submitted" || status === "dismissed"

  const ready = questions.filter(
    (q): q is ReadyQuestion =>
      typeof q.id === "string" && typeof q.prompt === "string",
  )
  const current = ready[Math.min(index, ready.length - 1)] as
    | ReadyQuestion
    | undefined
  const draft = (current && drafts[current.id]) || emptyDraft
  const isLast = !streaming && index >= ready.length - 1
  const multi = current?.type === "multi"
  const allowOther = current?.type !== "text" && current?.allowOther !== false
  const canContinue =
    !!current && (!current.required || hasAnswer(current, draft))

  // Functional updates, so rapid key presses never read a stale draft.
  const update = (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    if (!current) return
    setDrafts((prev) => {
      const d = prev[current.id] ?? emptyDraft
      return {
        ...prev,
        [current.id]: {
          ...d,
          ...(typeof patch === "function" ? patch(d) : patch),
        },
      }
    })
  }

  const select = (value: string) => {
    if (multi) {
      update((d) => ({
        selected: d.selected.includes(value)
          ? d.selected.filter((v) => v !== value)
          : [...d.selected, value],
        delegated: false,
      }))
    } else {
      // A single choice replaces any 'Other' text.
      update({ selected: [value], text: "", delegated: false })
    }
  }

  const goTo = (i: number) => {
    setDirection(i >= index ? 1 : -1)
    setIndex(i)
    setFurthest((f) => Math.max(f, i))
  }

  const submit = (finalDrafts = drafts) => {
    setDecision("submitted")
    onResult?.({
      action: "submit",
      answers: ready.map((q) => toAnswer(q, finalDrafts[q.id] ?? emptyDraft)),
    })
  }

  const next = () => {
    if (!canContinue) return
    if (isLast) submit()
    else if (index < ready.length - 1) goTo(index + 1)
  }

  const delegate = () => {
    if (!current) return
    const nextDrafts = {
      ...drafts,
      [current.id]: { ...emptyDraft, delegated: true },
    }
    setDrafts(nextDrafts)
    if (isLast) submit(nextDrafts)
    else if (index < ready.length - 1) goTo(index + 1)
  }

  const skip = () => {
    if (!current) return
    const nextDrafts = { ...drafts, [current.id]: emptyDraft }
    setDrafts(nextDrafts)
    if (isLast) submit(nextDrafts)
    else if (index < ready.length - 1) goTo(index + 1)
  }

  const dismiss = () => {
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (done || !current || e.metaKey || e.ctrlKey || e.altKey) return
    const inField =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    // Enter continues (option buttons still toggle with Space).
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      next()
      return
    }
    if (inField || current.type === "text") return
    const n = Number(e.key)
    if (!Number.isInteger(n) || n < 1) return
    const options = current.options ?? []
    if (n <= options.length) {
      e.preventDefault()
      select(options[n - 1].value)
    } else if (allowOther && n === options.length + 1) {
      e.preventDefault()
      otherRef.current?.focus()
    }
  }

  // Submitted: a compact record of the answers, for the chat history.
  if (done) {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="question-stepper"
          data-status={status}
          aria-label={title ?? "Questions"}
          className={className}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {status === "dismissed" ? (
              <p
                className={cn(
                  genuiType.body,
                  "flex items-center gap-1.5 px-3 py-3 text-muted-foreground",
                )}
              >
                <XIcon aria-hidden className="size-4" />
                Dismissed. Nothing sent.
              </p>
            ) : (
              <dl className="flex flex-col gap-3 px-3 py-3">
                {ready.map((q) => (
                  <div key={q.id} className="flex flex-col gap-0.5">
                    <dt className={genuiType.label}>{q.header ?? q.prompt}</dt>
                    <dd
                      className={cn(
                        genuiType.body,
                        "font-medium",
                        !hasAnswer(q, drafts[q.id] ?? emptyDraft) &&
                          "text-muted-foreground",
                      )}
                    >
                      {describeAnswer(q, drafts[q.id] ?? emptyDraft)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </motion.div>
        </Surface>
      </MotionConfig>
    )
  }

  const total = streaming ? Math.max(ready.length, index + 1) : ready.length
  const options = current?.options ?? []

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="question-stepper"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={headingId}
        onKeyDown={onKeyDown}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <p className="sr-only">
            {title ? `${title}. ` : ""}Question{" "}
            {Math.min(index + 1, Math.max(total, 1))} of{" "}
            {streaming ? `${total}…` : total}
          </p>
          {/* Progress: one segment per question. */}
          <div aria-hidden className="flex flex-1 gap-1">
            {Array.from({ length: Math.max(total, 1) }, (_, i) => (
              <span
                // Segments are positional; the index is the identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: static positional list
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full bg-muted dark:bg-white/15",
                  i < index && "bg-choice/40",
                  i === index && "bg-choice",
                )}
              />
            ))}
          </div>
          <div className="-mr-2 flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Previous question"
                    disabled={index === 0}
                    onClick={() => goTo(index - 1)}
                    className="hover:bg-muted dark:hover:bg-white/10"
                  />
                }
              >
                <ChevronLeftIcon />
              </TooltipTrigger>
              <TooltipContent>Previous question</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Next question"
                    disabled={index >= Math.min(furthest, ready.length - 1)}
                    onClick={() => goTo(index + 1)}
                    className="hover:bg-muted dark:hover:bg-white/10"
                  />
                }
              >
                <ChevronRightIcon />
              </TooltipTrigger>
              <TooltipContent>Next question</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Dismiss questions"
                    onClick={dismiss}
                    className="hover:bg-muted dark:hover:bg-white/10"
                  />
                }
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipContent>Dismiss questions</TooltipContent>
            </Tooltip>
          </div>
        </SurfaceHeader>

        <p id={hintId} className="sr-only">
          Press 1 to 9 to choose an option and Enter to continue.
        </p>

        {/* Height follows the question; questions slide in their direction. */}
        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            {current ? (
              <motion.div
                key={current.id}
                custom={direction}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: d * 16 }),
                  center: { opacity: 1, x: 0 },
                  exit: (d: number) => ({ opacity: 0, x: d * -16 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex flex-col gap-4 border-t border-border px-3 py-3"
              >
                <h3 id={headingId} className={genuiType.title}>
                  {current.prompt}
                  {current.required && (
                    <>
                      <span aria-hidden className="text-destructive">
                        {" "}
                        *
                      </span>
                      <span className="sr-only"> (required)</span>
                    </>
                  )}
                </h3>
                {/* The reason for asking is read to screen readers only. */}
                {current.description && (
                  <p id={descId} className="sr-only">
                    {current.description}
                  </p>
                )}

                {current.type === "text" ? (
                  // The question heading names the field (aria-labelledby): no box label.
                  <FormField>
                    <Textarea
                      id={answerId}
                      aria-labelledby={headingId}
                      aria-describedby={
                        current.description ? descId : undefined
                      }
                      placeholder={current.placeholder ?? "Type your answer"}
                      value={draft.text}
                      onChange={(e) =>
                        update({ text: e.target.value, delegated: false })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          next()
                        }
                      }}
                      className={cn(
                        formTextareaClass,
                        formTextareaUnlabeledClass,
                      )}
                    />
                  </FormField>
                ) : (
                  <div
                    {...{
                      role: multi ? "group" : "radiogroup",
                      "aria-labelledby": headingId,
                      "aria-describedby": current.description
                        ? `${descId} ${hintId}`
                        : hintId,
                    }}
                    className="flex flex-col gap-2"
                  >
                    {options.map((o) => (
                      <OptionRow
                        key={o.value}
                        label={o.label}
                        description={o.description}
                        recommended={o.recommended}
                        checked={draft.selected.includes(o.value)}
                        multi={multi}
                        onSelect={() => select(o.value)}
                      />
                    ))}
                    {allowOther && (
                      <Input
                        ref={otherRef}
                        aria-label="Other answer"
                        placeholder={current.placeholder ?? "Other…"}
                        value={draft.text}
                        onChange={(e) =>
                          update({
                            text: e.target.value,
                            // In single mode, typing 'Other' replaces the choice.
                            ...(multi ? {} : { selected: [] }),
                            delegated: false,
                          })
                        }
                      />
                    )}
                    {streaming && options.length === 0 && (
                      <Skeleton className="h-12 rounded-[10px]" />
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <div
                key="loading"
                className="flex flex-col gap-2 border-t border-border px-3 py-3"
              >
                <ShimmeringText
                  text="Writing questions…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                  className="text-[13px] leading-5"
                />
                <Skeleton className="h-12 rounded-[10px]" />
                <Skeleton className="h-12 rounded-[10px]" />
              </div>
            )}
          </AnimatePresence>
        </AutoHeight>

        <SurfaceFooter>
          {allowDelegate && current && (
            <Button size="sm" variant="secondary" onClick={delegate}>
              Let agent decide
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {current && !current.required && (
              <Button size="sm" variant="secondary" onClick={skip}>
                Skip
              </Button>
            )}
            <WhyDisabled
              when={!canContinue && !(!isLast && index >= ready.length - 1)}
              reason="Answer this question first"
            >
              <Button
                size="sm"
                onClick={next}
                disabled={
                  !canContinue || (!isLast && index >= ready.length - 1)
                }
              >
                {isLast ? (submitLabel ?? "Submit") : "Next"}
                <CornerDownLeftIcon data-icon="inline-end" aria-hidden />
              </Button>
            </WhyDisabled>
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
