"use client"

import * as React from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  InfoIcon,
  MessageSquareIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import {
  genuiMotion,
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
} from "@/components/genui/surface"

import {
  checkSummary,
  decisionMeta,
  formatDay,
  KIND_LABEL,
  RISK_LABEL,
  safeColor,
  safeHttpUrl,
  safeImageSrc,
  textBlocks,
} from "./design-review-utils"
import type {
  DesignReviewCheck,
  DesignReviewEvidence,
  DesignReviewInput,
  DesignReviewPane,
  DesignReviewResult,
} from "./design-review.schema"

export type DesignReviewStatus = "streaming" | "ready"

export type DesignReviewProps = Partial<
  Omit<DesignReviewInput, "checks" | "evidence">
> & {
  /** Lists may hold partial items while the tool call streams. */
  checks?: Partial<DesignReviewCheck>[]
  evidence?: Partial<DesignReviewEvidence>[]
  /** Lifecycle, controlled by the host. */
  status?: DesignReviewStatus
  /** Called once with the reviewer's decision. */
  onResult?: (result: DesignReviewResult) => void
  /** A decision from history. Renders the record; never calls onResult. */
  result?: DesignReviewResult
  className?: string
}

const CHECK_BADGE = {
  pass: { variant: "success", label: "Passed" },
  warn: { variant: "warning", label: "Warning" },
  fail: { variant: "destructive", label: "Failed" },
} as const

const RISK_BADGE = {
  low: "success",
  medium: "warning",
  high: "destructive",
} as const

const appear = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

/** A full-bleed section under an edge-to-edge divider. */
function Section({
  label,
  count,
  children,
  className,
}: {
  label?: string
  count?: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 border-t border-border px-3 py-3",
        className,
      )}
    >
      {label && (
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          {label}
          {count !== undefined && (
            <Badge variant="info" className="tabular-nums">
              {count}
            </Badge>
          )}
        </h3>
      )}
      {children}
    </section>
  )
}

/** A colour: a big chip, its name and value, and an icon button that copies the value. */
function SwatchRow({ swatch }: { swatch: { name: string; value: string } }) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const color = safeColor(swatch.value)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(swatch.value)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked (an insecure page, a denied permission).
    }
  }
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden
        className="size-12 shrink-0 rounded-lg border border-border"
        style={color ? { background: color } : undefined}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{swatch.name}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {swatch.value}
        </span>
      </span>
      <IconTip label={copied ? "Copied" : `Copy ${swatch.value}`}>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Copy ${swatch.value}`}
          onClick={copy}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        </Button>
      </IconTip>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  )
}

/** One pane as table cells: the picture, each swatch, then each line of text. */
function paneCells(pane: DesignReviewPane): React.ReactNode[] {
  const cells: React.ReactNode[] = []
  const src = safeImageSrc(pane.image?.src)
  if (src && pane.image) {
    cells.push(
      // biome-ignore lint/performance/noImgElement: agent-provided URLs; next/image would need every host configured
      <img
        key="image"
        src={src}
        alt={pane.image.alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="w-full rounded-md bg-muted object-cover"
      />,
    )
  }
  for (const sw of (pane.swatches ?? []).filter((x) => x?.name)) {
    cells.push(<SwatchRow key={`sw-${sw.name}`} swatch={sw} />)
  }
  if (pane.text) {
    for (const block of textBlocks(pane.text)) {
      if (block.type === "list") {
        for (const item of block.items)
          cells.push(<span key={`t-${cells.length}`}>{item}</span>)
      } else {
        cells.push(<span key={`t-${cells.length}`}>{block.text}</span>)
      }
    }
  }
  return cells
}

/**
 * Now and proposed as one comparison table: a header strip with the two
 * titles split by a divider, then one row per item with the old and the new
 * side by side. Rows are separated by hairlines, columns by a vertical one.
 */
function Compare({
  current,
  proposed,
}: {
  current?: DesignReviewPane
  proposed: DesignReviewPane
}) {
  const left = current ? paneCells(current) : null
  const right = paneCells(proposed)
  const count = Math.max(left?.length ?? 0, right.length)
  const rows = Array.from({ length: count }, (_, i) => i)
  return (
    <div>
      <table className="w-full table-fixed border-collapse text-left text-[13px] leading-6">
        <caption className="sr-only">Now and proposed</caption>
        <thead className="bg-muted/60 dark:bg-white/[0.04]">
          <tr>
            {left && (
              <th
                scope="col"
                className="px-3 py-2 text-left font-medium text-muted-foreground"
              >
                Now
              </th>
            )}
            <th
              scope="col"
              className={cn(
                "px-3 py-2 text-left font-medium",
                left && "border-l border-border",
              )}
            >
              <span className="inline-flex items-center gap-2">
                Proposed
                <Badge variant="info" className="gap-1">
                  <SparklesIcon aria-hidden />
                  AI
                </Badge>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i} className="border-t border-border">
              {left && (
                <td className="px-3 py-2.5 align-top text-muted-foreground">
                  {left[i] ?? <span aria-hidden>—</span>}
                </td>
              )}
              <td
                className={cn(
                  "px-3 py-2.5 align-top",
                  left && "border-l border-border",
                )}
              >
                {right[i] ?? (
                  <span aria-hidden className="text-muted-foreground">
                    —
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DesignReview({
  kind,
  title,
  summary,
  proposedBy,
  basis,
  proposedAt,
  risk,
  current,
  proposed,
  checks = [],
  evidence = [],
  editable,
  status = "ready",
  onResult,
  result,
  className,
}: DesignReviewProps) {
  const locale = useGenUILocale()
  const uid = React.useId()
  const streaming = status === "streaming"
  const [decision, setDecision] = React.useState<DesignReviewResult | null>(
    result ?? null,
  )
  const [mode, setMode] = React.useState<"idle" | "modify" | "decline">("idle")
  const [feedback, setFeedback] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [draft, setDraft] = React.useState<string | null>(null)
  const [showEvidence, setShowEvidence] = React.useState(false)
  const recordRef = React.useRef<HTMLParagraphElement>(null)

  const readyChecks = checks.filter(
    (c): c is DesignReviewCheck =>
      typeof c.label === "string" &&
      (c.status === "pass" || c.status === "warn" || c.status === "fail"),
  )
  const readyEvidence = evidence.filter(
    (e): e is DesignReviewEvidence => typeof e.title === "string",
  )
  const tally = checkSummary(readyChecks)
  const canEdit = (editable ?? true) && typeof proposed?.text === "string"
  const proposalText = draft ?? proposed?.text ?? ""

  const decided = decision !== null
  const meta = decision ? decisionMeta(decision) : null
  const day = formatDay(proposedAt, locale)
  const byline = [proposedBy, basis].filter(Boolean).join(" · ")

  const decide = (r: DesignReviewResult) => {
    if (decided || streaming) return
    const withTime = { ...r, decidedAt: new Date().toISOString() }
    setDecision(withTime)
    setMode("idle")
    onResult?.(withTime)
    requestAnimationFrame(() => recordRef.current?.focus())
  }

  const loading = streaming ? "Still loading…" : undefined
  const time = decision?.decidedAt
    ? new Date(decision.decidedAt).toLocaleTimeString(locale, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="design-review"
        data-status={status}
        data-decision={decision?.action}
        aria-busy={streaming}
        aria-labelledby={`${uid}-title`}
        className={cn("@container", className)}
      >
        {/* Title, then what it is and its impact level as badges on the same line. */}
        <SurfaceHeader className="gap-1 pb-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {title ? (
              <SurfaceTitle id={`${uid}-title`}>{title}</SurfaceTitle>
            ) : (
              <Skeleton className="h-5 w-48" />
            )}
            {kind && <Badge variant="info">{KIND_LABEL[kind]}</Badge>}
            {risk && !meta && (
              <Badge variant={RISK_BADGE[risk]}>{RISK_LABEL[risk]}</Badge>
            )}
            {meta && (
              <Badge variant={meta.tone} className="gap-1">
                {decision?.action === "approve" ? (
                  <CheckIcon aria-hidden />
                ) : decision?.action === "decline" ? (
                  <XIcon aria-hidden />
                ) : (
                  <MessageSquareIcon aria-hidden />
                )}
                {meta.badge}
              </Badge>
            )}
          </div>
          {/* One line under the title: the summary left, the date right. Who
              proposed it and on what basis sit in the date's tooltip. */}
          {(summary || day) && (
            <div className="flex items-baseline gap-x-3">
              {summary && (
                <p
                  className={cn(
                    genuiType.body,
                    "min-w-0 flex-1 truncate text-muted-foreground",
                  )}
                >
                  {summary.length > 64 ? (
                    <IconTip label={summary} side="bottom">
                      <span
                        // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can read the full summary
                        tabIndex={0}
                        className="outline-none"
                      >
                        {summary}
                      </span>
                    </IconTip>
                  ) : (
                    summary
                  )}
                </p>
              )}
              {byline && <span className="sr-only">{byline}.</span>}
              {day &&
                (byline ? (
                  <IconTip label={byline} side="bottom">
                    <span
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can read the tooltip
                      tabIndex={0}
                      className={cn(
                        genuiType.meta,
                        "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      )}
                    >
                      <InfoIcon aria-hidden className="size-3.5" />
                      <time dateTime={proposedAt}>{day}</time>
                    </span>
                  </IconTip>
                ) : (
                  <p className={cn(genuiType.meta, "ml-auto shrink-0")}>
                    <time dateTime={proposedAt}>{day}</time>
                  </p>
                ))}
            </div>
          )}
        </SurfaceHeader>

        {/* Current next to proposed: side by side when there is room. */}
        <Section className="p-0">
          {proposed ? (
            <Compare current={current} proposed={proposed} />
          ) : (
            <Skeleton aria-hidden className="m-3 h-28 rounded-[10px]" />
          )}
        </Section>

        {/* Checks as tinted badges on one line; the detail is in the tooltip. */}
        {readyChecks.length > 0 && (
          <Section>
            {tally.fail > 0 && !decided && (
              <div
                role="note"
                className="rounded-[10px] border border-border bg-transparent p-1"
              >
                <div className="flex items-center gap-3 rounded-md bg-red-500/10 px-3 py-3 text-[13px] dark:bg-red-400/10">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/15 text-red-500 dark:bg-red-400/15 dark:text-red-400">
                    <CircleAlertIcon aria-hidden className="size-4" />
                  </span>
                  <p>
                    {tally.fail === 1
                      ? "1 check failed."
                      : `${tally.fail} checks failed.`}{" "}
                    You can still approve; the failure ships with the change.
                  </p>
                </div>
              </div>
            )}
            <ul aria-label="Checks" className="flex flex-wrap gap-2">
              {readyChecks.map((c) => {
                const b = CHECK_BADGE[c.status]
                const badge = (
                  <Badge
                    variant={b.variant}
                    tabIndex={c.detail ? 0 : undefined}
                    className="gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {c.status === "pass" ? (
                      <CheckIcon aria-hidden />
                    ) : c.status === "warn" ? (
                      <TriangleAlertIcon aria-hidden />
                    ) : (
                      <XIcon aria-hidden />
                    )}
                    {c.label}
                    <span className="sr-only">
                      {`: ${b.label}${c.detail ? `, ${c.detail}` : ""}`}
                    </span>
                  </Badge>
                )
                return (
                  <motion.li key={c.label} {...appear} className="flex">
                    {c.detail ? (
                      <IconTip label={`${b.label}: ${c.detail}`}>
                        {badge}
                      </IconTip>
                    ) : (
                      badge
                    )}
                  </motion.li>
                )
              })}
            </ul>
          </Section>
        )}

        {/* Evidence folds away: a count to scan, the list on demand. */}
        {readyEvidence.length > 0 && (
          <Section className="py-0">
            <button
              type="button"
              aria-expanded={showEvidence}
              aria-controls={`${uid}-evidence`}
              onClick={() => setShowEvidence((v) => !v)}
              className="-mx-3 flex items-center gap-2 px-3 py-3 text-left text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              Evidence
              <Badge variant="info" className="tabular-nums">
                {readyEvidence.length}
              </Badge>
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "ml-auto size-4 transition-transform",
                  showEvidence && "rotate-180",
                )}
              />
            </button>
            {showEvidence && (
              <ol
                id={`${uid}-evidence`}
                className="mb-3 flex flex-col divide-y divide-border overflow-hidden rounded-[10px] border border-border"
              >
                {readyEvidence.map((e, i) => {
                  const url = safeHttpUrl(e.url)
                  return (
                    <motion.li
                      key={e.title}
                      {...appear}
                      className="flex items-center gap-3 px-3 py-3"
                    >
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] leading-none font-medium tabular-nums text-muted-foreground dark:bg-white/10">
                        {i + 1}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:justify-between @md:gap-4">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="min-w-0 rounded-sm text-[13px] font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            {e.title}
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        ) : (
                          <span className="min-w-0 text-[13px] font-medium">
                            {e.title}
                          </span>
                        )}
                        {e.source && (
                          <span
                            className={cn(
                              genuiType.meta,
                              "shrink-0 @md:text-right",
                            )}
                          >
                            {e.source}
                          </span>
                        )}
                      </div>
                    </motion.li>
                  )
                })}
              </ol>
            )}
          </Section>
        )}

        {/* Ask for changes: say what to change, and edit the text directly. */}
        {mode === "modify" && !decided && (
          <Section>
            <div className="flex flex-col gap-2">
              <label htmlFor={`${uid}-feedback`} className={genuiType.label}>
                What should change?
              </label>
              <Textarea
                id={`${uid}-feedback`}
                autoFocus
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. Keep outlined badges for filters you can tap"
                className="min-h-20 focus-visible:border-input focus-visible:ring-0 dark:focus-visible:border-border"
              />
            </div>
            {canEdit && (
              <div className="flex flex-col gap-2">
                <label htmlFor={`${uid}-proposal`} className={genuiType.label}>
                  Proposed text (optional edit)
                </label>
                <Textarea
                  id={`${uid}-proposal`}
                  value={proposalText}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-28 font-mono text-[13px]"
                />
              </div>
            )}
          </Section>
        )}

        {mode === "decline" && !decided && (
          <Section>
            <div className="flex flex-col gap-2">
              <label htmlFor={`${uid}-reason`} className={genuiType.label}>
                Why decline? (optional)
              </label>
              <Textarea
                id={`${uid}-reason`}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. This conflicts with the brand guidelines"
                className="min-h-20 focus-visible:border-input focus-visible:ring-0 dark:focus-visible:border-border"
              />
            </div>
          </Section>
        )}

        {/* All actions in one row: the hollow secondaries, then the grey primary. */}
        <SurfaceFooter aria-live="polite" className="justify-end">
          {decided && meta ? (
            <p
              ref={recordRef}
              tabIndex={-1}
              className={cn(
                genuiType.body,
                "mr-auto flex items-center gap-1.5 outline-none",
              )}
            >
              {meta.verb}
              {time && <span className="text-muted-foreground">· {time}</span>}
              {decision?.action === "decline" && decision.reason && (
                <span className="text-muted-foreground">
                  · “{decision.reason}”
                </span>
              )}
            </p>
          ) : mode === "modify" ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setMode("idle")}
              >
                Cancel
              </Button>
              <WhyDisabled
                reason={
                  feedback.trim() ? undefined : "Describe the change first"
                }
              >
                <Button
                  size="sm"
                  disabled={!feedback.trim()}
                  onClick={() =>
                    decide({
                      action: "modify",
                      feedback: feedback.trim(),
                      ...(draft !== null && draft !== proposed?.text
                        ? { proposal: draft }
                        : {}),
                    })
                  }
                >
                  Send changes
                </Button>
              </WhyDisabled>
            </>
          ) : mode === "decline" ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setMode("idle")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  decide({
                    action: "decline",
                    ...(reason.trim() ? { reason: reason.trim() } : {}),
                  })
                }
              >
                Decline
              </Button>
            </>
          ) : (
            <>
              <WhyDisabled reason={loading}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={streaming}
                  onClick={() => setMode("modify")}
                >
                  Request changes
                </Button>
              </WhyDisabled>
              <WhyDisabled reason={loading}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={streaming}
                  onClick={() => setMode("decline")}
                >
                  Decline
                </Button>
              </WhyDisabled>
              <WhyDisabled reason={loading}>
                <Button
                  size="sm"
                  disabled={streaming}
                  onClick={() => decide({ action: "approve" })}
                >
                  <CheckIcon aria-hidden />
                  Approve
                </Button>
              </WhyDisabled>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
