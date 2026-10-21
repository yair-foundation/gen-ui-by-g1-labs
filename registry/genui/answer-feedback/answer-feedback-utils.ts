import type {
  AnswerFeedbackResult,
  FeedbackReason,
} from "./answer-feedback.schema"
import { defaultFeedbackReasons } from "./answer-feedback.schema"

/** The reasons to offer: the agent's, or the defaults. */
export function resolveReasons(
  reasons: Partial<FeedbackReason>[] | undefined,
): FeedbackReason[] {
  const ready = (reasons ?? []).filter(
    (r): r is FeedbackReason =>
      typeof r.id === "string" && typeof r.label === "string" && r.label !== "",
  )
  return ready.length >= 2 ? ready : [...defaultFeedbackReasons]
}

/** The line shown after a rating, e.g. "Thanks. Too long, Out of date." */
export function ratingRecord(
  result: Extract<AnswerFeedbackResult, { action: "rate" }>,
  reasons: FeedbackReason[],
): string {
  if (result.rating === "up") return "Thanks for the feedback."
  const labels = result.reasons
    .map((id) => reasons.find((r) => r.id === id)?.label)
    .filter((l): l is string => Boolean(l))
  return labels.length ? `Thanks. ${labels.join(", ")}.` : "Thanks for the feedback."
}

/** Toggles one reason id in a selection, keeping the offered order. */
export function toggleReason(
  selected: string[],
  id: string,
  offered: FeedbackReason[],
): string[] {
  const next = selected.includes(id)
    ? selected.filter((s) => s !== id)
    : [...selected, id]
  return offered.map((r) => r.id).filter((rid) => next.includes(rid))
}
