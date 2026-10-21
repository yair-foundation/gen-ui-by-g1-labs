"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
  SearchCheckIcon,
} from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { WhyDisabled } from "@/components/genui/hint"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  genuiMotion,
  genuiType,
} from "@/components/genui/surface"
import {
  CheckMark,
  SwapText,
  genuiEase,
  genuiStepIn,
} from "@/components/genui/genui-motion"

import type {
  ConfidenceEvidence,
  ConfidenceInput,
  ConfidenceLevel,
  ConfidenceResult,
} from "./confidence.schema"

export type ConfidenceStatus = "streaming" | "ready"

export type ConfidenceProps = Partial<Omit<ConfidenceInput, "evidence">> & {
  /** Evidence may be partial while the tool call is still streaming. */
  evidence?: Partial<ConfidenceEvidence>[]
  /** Lifecycle, controlled by the host. Buttons are disabled while 'streaming'. */
  status?: ConfidenceStatus
  /** Called once with { action: "verify" } or { action: "accept" }. */
  onResult?: (result: ConfidenceResult) => void
  /** A result from history. Shows the record; never calls onResult. */
  result?: ConfidenceResult
  className?: string
}

const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

/** Colour carries the level (data meaning): up for high, down for low. */
const levelTone =
  "[--conf-high:var(--up,#15703a)] [--conf-low:var(--down,#b91c1c)] dark:[--conf-high:var(--up,#4ade80)] dark:[--conf-low:var(--down,#f87171)]"

const levelMeta: Record<
  ConfidenceLevel,
  { label: string; bars: number; bar: string }
> = {
  high: { label: "High confidence", bars: 3, bar: "bg-(--conf-high)" },
  medium: { label: "Medium confidence", bars: 2, bar: "bg-choice" },
  low: { label: "Low confidence", bars: 1, bar: "bg-(--conf-low)" },
}

function isHttp(url: string | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url)
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Splits the claim so the hedge words can be underlined. */
function splitHedges(claim: string, hedges: string[]) {
  const words = hedges.filter((h) => h.trim().length > 0)
  if (words.length === 0) return [{ text: claim, hedge: false }]
  const re = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi")
  return claim
    .split(re)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      hedge: words.some((w) => w.toLowerCase() === part.toLowerCase()),
    }))
}

/** Three bars, filled to the level. Decorative; the meter carries the value. */
function LevelBars({ level }: { level: ConfidenceLevel }) {
  const meta = levelMeta[level]
  return (
    <span aria-hidden className="flex h-3.5 items-end gap-[3px]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={cn(
            "w-[4px] rounded-full transition-colors duration-300",
            i < meta.bars ? meta.bar : "bg-muted dark:bg-white/15",
          )}
          initial={false}
          animate={{ height: `${6 + i * 4}px` }}
          transition={genuiMotion.gentle}
        />
      ))}
    </span>
  )
}

function EvidenceItem({ item }: { item: ConfidenceEvidence }) {
  const isFor = item.stance === "for"
  const Icon = isFor ? PlusIcon : MinusIcon
  return (
    <motion.li
      {...genuiStepIn}
      className="flex flex-[1_1_min(100%,16rem)] gap-3"
    >
      <span
        aria-hidden
        className={cn(
          "mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full",
          isFor
            ? "bg-(--conf-high)/15 text-(--conf-high)"
            : "bg-(--conf-low)/15 text-(--conf-low)",
        )}
      >
        <Icon className="size-3" strokeWidth={2.5} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={genuiType.body}>
          <span className="sr-only">{isFor ? "Supports: " : "Against: "}</span>
          {item.text}
        </span>
        {item.source &&
          (isHttp(item.url) ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                genuiType.meta,
                "w-fit rounded-sm underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground",
                focusRing,
              )}
            >
              {item.source}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className={genuiType.meta}>{item.source}</span>
          ))}
      </span>
    </motion.li>
  )
}

export function Confidence({
  question,
  claim,
  level,
  score,
  reason,
  hedges = [],
  evidence = [],
  changeMind = [],
  verifyLabel,
  canVerify: canVerifyProp,
  status = "ready",
  onResult,
  result,
  className,
}: ConfidenceProps) {
  const [chosen, setChosen] = React.useState<ConfidenceResult | null>(
    result ?? null,
  )
  // null: follow the default (open at low confidence) until the user toggles.
  const [openPref, setOpenPref] = React.useState<boolean | null>(null)
  const recordRef = React.useRef<HTMLParagraphElement>(null)
  const focusRecord = React.useRef(false)
  const panelId = React.useId()

  const streaming = status === "streaming"
  const canVerify = canVerifyProp !== false && canVerifyProp !== "false"

  React.useEffect(() => {
    if (result) setChosen(result)
  }, [result])

  React.useEffect(() => {
    if (chosen && focusRecord.current) {
      focusRecord.current = false
      recordRef.current?.focus()
    }
  }, [chosen])

  const readyEvidence = evidence.filter(
    (e): e is ConfidenceEvidence =>
      typeof e.id === "string" &&
      (e.stance === "for" || e.stance === "against") &&
      typeof e.text === "string",
  )
  const supports = readyEvidence.filter((e) => e.stance === "for")
  const against = readyEvidence.filter((e) => e.stance === "against")
  const reasons = changeMind.filter((c) => typeof c === "string" && c)
  const hasDetail = readyEvidence.length > 0 || reasons.length > 0
  const open = openPref ?? level === "low"
  const meta = level ? levelMeta[level] : null
  const pct =
    typeof score === "number"
      ? Math.round(Math.min(100, Math.max(0, score)))
      : null

  const choose = (next: ConfidenceResult) => {
    if (chosen || result) return
    focusRecord.current = true
    setChosen(next)
    onResult?.(next)
  }

  const evidenceSummary = [
    supports.length > 0 && `${supports.length} for`,
    against.length > 0 && `${against.length} against`,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <MotionConfig reducedMotion="user">
      {question && (
        <h2 className={cn(genuiType.title, "mb-3 text-[16px]")}>{question}</h2>
      )}
      <Surface
        data-slot="confidence"
        data-status={chosen ? "answered" : status}
        data-level={level}
        aria-busy={streaming}
        aria-label={meta ? `Answer, ${meta.label.toLowerCase()}` : "Answer"}
        className={cn(levelTone, className)}
      >
        {/* Low confidence: say plainly that this is a hypothesis. */}
        <AnimatePresence initial={false}>
          {level === "low" && (
            <motion.div
              key="banner"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: genuiEase.emphasized }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 border-y border-border bg-transparent px-3 py-2.5">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-(--conf-low)"
                />
                <span className={cn(genuiType.label, "text-foreground")}>
                  Treat this as a hypothesis
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col">
          <div className="flex flex-col gap-4 px-3 py-3">
          {/* Level and the one-line reason. */}
          {meta && level ? (
            // biome-ignore lint/a11y/useSemanticElements: a native <meter> can't hold the bars and label
            <div
              role="meter"
              aria-label="Confidence"
              aria-valuemin={0}
              aria-valuemax={pct === null ? 3 : 100}
              aria-valuenow={pct ?? meta.bars}
              aria-valuetext={[
                pct === null ? meta.label : `${meta.label}, ${pct}%`,
                reason,
              ]
                .filter(Boolean)
                .join(". ")}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
            >
              <LevelBars level={level} />
              <span className={genuiType.title} aria-hidden>
                <SwapText value={meta.label} />
              </span>
              {pct !== null && (
                <span
                  className={cn(genuiType.meta, "inline-flex tabular-nums")}
                  aria-hidden
                >
                  <SlidingNumber number={pct} initiallyStable />%
                </span>
              )}
              {reason && (
                <span className={genuiType.meta}>
                  <span aria-hidden>· </span>
                  {reason}
                </span>
              )}
            </div>
          ) : (
            <Skeleton className="h-5 w-48" />
          )}

          {/* The claim, with hedge words underlined. */}
          {claim ? (
            <p
              className={cn(
                "text-[15px] leading-[1.65] tracking-[0.005em] transition-colors duration-300",
                level === "low" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {splitHedges(claim, hedges).map((part, i) =>
                part.hedge ? (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
                    key={i}
                    className="underline decoration-muted-foreground decoration-dotted decoration-[1.5px] underline-offset-[3px]"
                  >
                    {part.text}
                  </span>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
                  <React.Fragment key={i}>{part.text}</React.Fragment>
                ),
              )}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          )}

          </div>

          {/* Evidence and what would change the agent's mind. */}
          {hasDetail && (
            <div className="flex flex-col border-t border-border px-3 py-2">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenPref(!open)}
                className={cn(
                  "-mx-3 flex min-h-11 w-fit items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  focusRing,
                )}
              >
                Evidence
                {evidenceSummary && (
                  <span className="font-normal tabular-nums">
                    · {evidenceSummary}
                  </span>
                )}
                <motion.span
                  aria-hidden
                  animate={{ rotate: open ? 180 : 0 }}
                  transition={genuiMotion.snappy}
                  className="flex"
                >
                  <ChevronDownIcon className="size-4" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    id={panelId}
                    key="panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: genuiEase.emphasized }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap items-start gap-4 pt-2">
                      {readyEvidence.length > 0 && (
                        <ul
                          aria-label="Evidence for and against"
                          className="flex flex-[1_1_min(100%,18rem)] flex-wrap gap-x-6 gap-y-3"
                        >
                          {[...supports, ...against].map((e) => (
                            <EvidenceItem key={e.id} item={e} />
                          ))}
                        </ul>
                      )}
                      {reasons.length > 0 && (
                        <div className="flex flex-[1_1_min(100%,18rem)] flex-col gap-2 rounded-[10px] border border-border bg-transparent px-4 py-3">
                          <h4 className={genuiType.label}>
                            What would change my mind
                          </h4>
                          <ul className="flex flex-col gap-1.5">
                            {reasons.map((r) => (
                              <motion.li
                                key={r}
                                {...genuiStepIn}
                                className={cn(genuiType.body, "flex gap-2")}
                              >
                                <span
                                  aria-hidden
                                  className="mt-[9px] size-1 shrink-0 rounded-full bg-muted-foreground"
                                />
                                {r}
                              </motion.li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        <SurfaceFooter className="min-h-[76px]">
          {chosen ? (
            <p
              ref={recordRef}
              tabIndex={-1}
              aria-live="polite"
              data-slot="confidence-record"
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full text-[13px] text-muted-foreground",
                focusRing,
              )}
            >
              {chosen.action === "accept" ? (
                <>
                  <CheckMark className="size-4 text-foreground" />
                  Accepted as it stands
                </>
              ) : (
                <>
                  <SearchCheckIcon
                    aria-hidden
                    className="size-4 text-foreground"
                  />
                  Asked to verify
                </>
              )}
            </p>
          ) : (
            <>
              {canVerify && (
                <WhyDisabled reason={!streaming && !level && "No confidence level yet"} className="inline-flex flex-1">
                  <Button
                    size="lg"
                    className="flex-1"
                    variant={level === "low" ? "default" : "secondary"}
                    disabled={streaming || !level}
                    onClick={() => choose({ action: "verify" })}
                  >
                    <SearchCheckIcon data-icon="inline-start" />
                    {verifyLabel || "Verify"}
                  </Button>
                </WhyDisabled>
              )}
              <WhyDisabled reason={!streaming && !level && "No confidence level yet"} className="inline-flex flex-1">
                <Button
                  size="lg"
                  className="flex-1"
                  variant={level === "low" && canVerify ? "secondary" : "default"}
                  disabled={streaming || !level}
                  onClick={() => choose({ action: "accept" })}
                >
                  Accept
                </Button>
              </WhyDisabled>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
