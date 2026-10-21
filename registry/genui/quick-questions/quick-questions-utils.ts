/**
 * Pure helpers for Quick Questions: selection, validation, the result and the
 * submitted summary. No React, so they can be unit-tested on their own.
 */

/** The answer id used when the user types their own answer. */
export const OTHER = "other"

export type QuestionLike = {
  id: string
  label: string
  header?: string
  type?: "single" | "multiple"
  options?: { id?: string; label?: string }[]
  required?: boolean
  allowOther?: boolean
}

/** The user's picks by question id (option ids, possibly OTHER). */
export type Selections = Record<string, string[]>
/** Text typed into "Other", by question id. */
export type OtherTexts = Record<string, string>
export type Defaults = Record<string, string | string[] | undefined>

export type Answers = {
  action: "submit"
  answers: Record<string, string | string[]>
  other?: Record<string, string>
}

const optionIds = (q: QuestionLike) =>
  (q.options ?? [])
    .map((o) => o.id)
    .filter((id): id is string => typeof id === "string")

/** A default answer cleaned up: known option ids only, one for 'single'. */
export function defaultSelection(
  q: QuestionLike,
  value: string | string[] | undefined,
): string[] {
  if (value === undefined) return []
  const ids = optionIds(q)
  const wanted = (Array.isArray(value) ? value : [value]).filter((v) =>
    ids.includes(v),
  )
  return q.type === "multiple" ? [...new Set(wanted)] : wanted.slice(0, 1)
}

/** The user's picks, falling back to the agent's defaults until they touch it. */
export function selectionFor(
  q: QuestionLike,
  selections: Selections,
  defaults?: Defaults,
): string[] {
  return selections[q.id] ?? defaultSelection(q, defaults?.[q.id])
}

/** Picks after the user chooses `id`: replaces for 'single', toggles for 'multiple'. */
export function choose(q: QuestionLike, current: string[], id: string) {
  if (q.type !== "multiple") return [id]
  return current.includes(id)
    ? current.filter((v) => v !== id)
    : [...current, id]
}

/** Picks that count: "Other" only counts once something is typed into it. */
function effective(selected: string[], otherText: string | undefined) {
  const typed = (otherText ?? "").trim() !== ""
  return selected.filter((v) => v !== OTHER || typed)
}

export function isAnswered(
  selected: string[],
  otherText: string | undefined,
): boolean {
  return effective(selected, otherText).length > 0
}

/** True when every required question (required unless set to false) is answered. */
export function canSubmit(
  questions: QuestionLike[],
  selections: Selections,
  others: OtherTexts,
  defaults?: Defaults,
): boolean {
  if (questions.length === 0) return false
  return questions.every(
    (q) =>
      q.required === false ||
      isAnswered(selectionFor(q, selections, defaults), others[q.id]),
  )
}

/** The result sent to the agent. Unanswered optional questions are left out. */
export function buildResult(
  questions: QuestionLike[],
  selections: Selections,
  others: OtherTexts,
  defaults?: Defaults,
): Answers {
  const answers: Answers["answers"] = {}
  const other: Record<string, string> = {}
  for (const q of questions) {
    const picked = effective(
      selectionFor(q, selections, defaults),
      others[q.id],
    )
    if (picked.length === 0) continue
    // Option order, with "Other" last, regardless of click order.
    const order = [...optionIds(q), OTHER]
    const sorted = [...picked].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    )
    answers[q.id] = q.type === "multiple" ? sorted : sorted[0]
    if (sorted.includes(OTHER)) other[q.id] = (others[q.id] ?? "").trim()
  }
  return Object.keys(other).length > 0
    ? { action: "submit", answers, other }
    : { action: "submit", answers }
}

/** Selections and "Other" text restored from a stored result. */
export function restore(result: Answers): {
  selections: Selections
  others: OtherTexts
} {
  const selections: Selections = {}
  for (const [id, v] of Object.entries(result.answers)) {
    selections[id] = Array.isArray(v) ? v : [v]
  }
  return { selections, others: { ...result.other } }
}

export type RecordSegment = { id: string; header?: string; value: string }

/** One segment per answered question: "When" + "September to October". */
export function recordSegments(
  questions: QuestionLike[],
  result: Answers,
): RecordSegment[] {
  const segments: RecordSegment[] = []
  for (const q of questions) {
    const answer = result.answers[q.id]
    if (answer === undefined) continue
    const ids = Array.isArray(answer) ? answer : [answer]
    const labels = ids
      .map((id) =>
        id === OTHER
          ? (result.other?.[q.id] ?? "")
          : (q.options?.find((o) => o.id === id)?.label ?? id),
      )
      .filter((l) => l !== "")
    if (labels.length === 0) continue
    segments.push({
      id: q.id,
      header: q.header?.trim() || undefined,
      value: labels.join(", "),
    })
  }
  return segments
}

/** "When: September to October · Where: Lake Como · Dress code: Cocktail". */
export function recordText(segments: RecordSegment[]): string {
  return segments
    .map((s) => (s.header ? `${s.header}: ${s.value}` : s.value))
    .join(" · ")
}
