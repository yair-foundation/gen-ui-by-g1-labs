"use client"

import * as React from "react"
import { CheckIcon, MessageCircleQuestionIcon } from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import {
  buildResult,
  canSubmit,
  choose,
  isAnswered,
  OTHER,
  type OtherTexts,
  type QuestionLike,
  recordSegments,
  restore,
  type Selections,
  selectionFor,
} from "./quick-questions-utils"
import type {
  QuickQuestion,
  QuickQuestionsInput,
  QuickQuestionsResult,
} from "./quick-questions.schema"
import { WhyDisabled } from "@/components/genui/hint"

export type QuickQuestionsStatus = "streaming" | "ready" | "submitted"

type PartialOption = { id?: string; label?: string }

type PartialQuestion = Partial<
  Omit<QuickQuestion, "options" | "type" | "required" | "allowOther">
> & {
  type?: QuickQuestion["type"]
  options?: PartialOption[]
  required?: boolean
  allowOther?: boolean
}

type ReadyOption = { id: string; label: string }
type ReadyQuestion = QuestionLike & { options: ReadyOption[] }

export type QuickQuestionsProps = Partial<
  Omit<QuickQuestionsInput, "questions">
> & {
  /** Questions may be partial while the tool call is still streaming. */
  questions?: PartialQuestion[]
  /**
   * Lifecycle, controlled by the host. While 'streaming', questions that have
   * arrived can be answered, but not submitted. When omitted, the component
   * tracks the submission itself.
   */
  status?: QuickQuestionsStatus
  /** Called once with the answers. Send it back to the agent. */
  onResult?: (result: QuickQuestionsResult) => void
  /**
   * Answers from history (e.g. the tool call's stored output). Renders the
   * submitted summary and never calls onResult.
   */
  result?: QuickQuestionsResult
  className?: string
}

/** An answer chip: a pill; picked, it takes the choice ring and a check. */
const chipClass = (checked: boolean) =>
  cn(
    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors select-none",
    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
    checked
      ? "bg-accent ring-2 ring-choice ring-inset dark:bg-accent"
      : "border border-border bg-transparent hover:bg-accent dark:hover:bg-white/5",
  )

function readyOptions(q: PartialQuestion): ReadyOption[] {
  return (q.options ?? []).filter(
    (o): o is ReadyOption =>
      typeof o.id === "string" &&
      o.id !== "" &&
      typeof o.label === "string" &&
      o.label !== "",
  )
}

function QuestionField({
  question: q,
  selected,
  otherText,
  streaming,
  onChoose,
  onOther,
}: {
  question: ReadyQuestion
  selected: string[]
  otherText: string
  streaming: boolean
  onChoose: (id: string) => void
  onOther: (text: string) => void
}) {
  const uid = React.useId()
  const multiple = q.type === "multiple"
  const otherOn = selected.includes(OTHER)
  const options = q.allowOther
    ? [...q.options, { id: OTHER, label: "Other…" }]
    : q.options

  const answered = isAnswered(selected, otherText)
  return (
    <fieldset className="m-0 min-w-0 border-0 px-3 py-3">
      <legend className="sr-only">
        {q.label}
        {multiple ? " (choose any)" : ""}
        {q.required === false ? " (optional)" : ""}
      </legend>
      <p
        aria-hidden
        className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium"
      >
        {q.label}
        {multiple && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] leading-4 font-medium text-muted-foreground dark:bg-white/10">
            Pick any
          </span>
        )}
        {q.required === false && (
          <span className={cn(genuiType.meta, "font-normal")}>Optional</span>
        )}
        {answered && (
          <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = selected.includes(o.id)
          return (
            <motion.label
              key={o.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className={chipClass(checked)}
            >
              <input
                type={multiple ? "checkbox" : "radio"}
                name={uid}
                value={o.id}
                checked={checked}
                onChange={() => onChoose(o.id)}
                className="sr-only"
              />
              {checked && <CheckIcon aria-hidden className="size-3.5" />}
              {o.label}
            </motion.label>
          )
        })}
        {streaming && q.options.length < 2 && (
          <>
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-20 rounded-full" />
          </>
        )}
      </div>
      <AnimatePresence initial={false}>
        {q.allowOther && otherOn && (
          <motion.div
            key="other"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <Input
                autoFocus
                aria-label={`Other answer: ${q.label}`}
                placeholder="Type your answer"
                maxLength={80}
                value={otherText}
                onChange={(e) => onOther(e.target.value)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </fieldset>
  )
}

export function QuickQuestions({
  title,
  questions = [],
  submitLabel,
  defaults,
  status: statusProp,
  onResult,
  result,
  className,
}: QuickQuestionsProps) {
  // Restored from `result` when the answers are already in history.
  const [selections, setSelections] = React.useState<Selections>(() =>
    result ? restore(result).selections : {},
  )
  const [others, setOthers] = React.useState<OtherTexts>(() =>
    result ? restore(result).others : {},
  )
  const [sent, setSent] = React.useState<QuickQuestionsResult | null>(
    result ?? null,
  )

  // A host-provided "ready" (or nothing) yields to the user's submission.
  const status: QuickQuestionsStatus =
    sent && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const ready: ReadyQuestion[] = questions
    .filter(
      (q): q is PartialQuestion & { id: string; label: string } =>
        typeof q.id === "string" &&
        q.id !== "" &&
        typeof q.label === "string" &&
        q.label !== "",
    )
    .map((q) => ({ ...q, options: readyOptions(q) }))

  const answerable = canSubmit(ready, selections, others, defaults)
  const disabled = streaming || !answerable || !submitLabel
  const answeredCount = ready.filter((q) =>
    isAnswered(selectionFor(q, selections, defaults), others[q.id]),
  ).length
  const missing = ready.filter(
    (q) =>
      q.required !== false &&
      !isAnswered(selectionFor(q, selections, defaults), others[q.id]),
  ).length

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (disabled) return
    const r: QuickQuestionsResult = buildResult(
      ready,
      selections,
      others,
      defaults,
    )
    setSent(r)
    onResult?.(r)
  }

  if (status === "submitted") {
    const segments = sent ? recordSegments(ready, sent) : []
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="quick-questions"
          data-status={status}
          aria-label="Your answers"
          className={className}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex items-start gap-2.5 px-3 py-3"
          >
            <CheckIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <p className={genuiType.body}>
              {segments.length === 0 ? (
                <span className="text-muted-foreground">No answers</span>
              ) : (
                segments.map((s, i) => (
                  <React.Fragment key={s.id}>
                    {i > 0 && (
                      <>
                        <span aria-hidden className="text-muted-foreground">
                          {" · "}
                        </span>
                        <span className="sr-only">; </span>
                      </>
                    )}
                    <span>
                      {s.header && (
                        <span className="text-muted-foreground">
                          {s.header}:{" "}
                        </span>
                      )}
                      <span className="font-medium">{s.value}</span>
                    </span>
                  </React.Fragment>
                ))
              )}
            </p>
          </motion.div>
        </Surface>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="quick-questions"
        data-status={status}
        aria-busy={streaming}
        aria-label="Quick questions"
        className={className}
      >
        <form onSubmit={submit} noValidate>
          <SurfaceHeader className="flex-row items-center gap-3 pb-3">
            <span
              aria-hidden
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400"
            >
              <MessageCircleQuestionIcon className="size-5" />
            </span>
            <SurfaceTitle className="min-w-0 flex-1">
              {title ?? "A few quick questions"}
            </SurfaceTitle>
          </SurfaceHeader>
          <AutoHeight>
            <div className="flex flex-col">
              {ready.map((q) => (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="border-t border-border"
                >
                  <QuestionField
                    question={q}
                    selected={selectionFor(q, selections, defaults)}
                    otherText={others[q.id] ?? ""}
                    streaming={streaming}
                    onChoose={(id) =>
                      setSelections((prev) => ({
                        ...prev,
                        [q.id]: choose(q, selectionFor(q, prev, defaults), id),
                      }))
                    }
                    onOther={(text) =>
                      setOthers((prev) => ({ ...prev, [q.id]: text }))
                    }
                  />
                </motion.div>
              ))}
              {ready.length === 0 && (
                <div className="flex flex-col gap-3 px-3 py-3">
                  <ShimmeringText
                    text="Writing questions…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                    className="text-[13px] leading-5"
                  />
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-5 w-32" />
                </div>
              )}
            </div>
          </AutoHeight>

          <SurfaceFooter className="justify-between gap-3">
            <p
              aria-live="polite"
              className={cn(genuiType.meta, "tabular-nums")}
            >
              {ready.length > 0 &&
                `${answeredCount} of ${ready.length} answered`}
            </p>
            <WhyDisabled
              when={disabled}
              reason={
                streaming
                  ? "One moment…"
                  : missing > 0
                    ? `Answer ${missing} more`
                    : "Answer the questions first"
              }
            >
              <Button type="submit" size="sm" disabled={disabled}>
                {submitLabel ?? (
                  <>
                    <span className="sr-only">Submit</span>
                    <Skeleton className="h-4 w-28 bg-primary-foreground/20" />
                  </>
                )}
              </Button>
            </WhyDisabled>
          </SurfaceFooter>
        </form>
      </Surface>
    </MotionConfig>
  )
}
