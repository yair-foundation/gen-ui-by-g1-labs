/**
 * Plan Review: pure helpers for editing an ordered plan, diffing it against
 * the proposal, checking dependencies and summing estimates. No React, no
 * Zod, so they run anywhere.
 *
 * A plan is an ordered list of items. Removed items stay in the list as
 * tombstones (`removed: true`) so Undo puts them back exactly where they
 * were. Every helper returns a new list and never mutates its input.
 */

export type PlanItem = {
  id: string
  title: string
  description?: string
  /** false when an optional step is switched off ("Skipped"). */
  enabled: boolean
  addedByUser?: boolean
  removed?: boolean
}

export type PlanChanges = {
  moved: string[]
  removed: string[]
  edited: string[]
  added: string[]
  disabled: string[]
}

export type DependencyIssue = {
  /** The step that needs another one. */
  stepId: string
  /** The step it needs. */
  dependsOnId: string
  reason: "order" | "removed" | "skipped"
}

export function pluralize(count: number, noun: string, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`
}

/** Builds plan items from the agent's steps. Repeat ids are skipped. */
export function toPlanItems(
  steps: { id: string; title: string; description?: string }[],
): PlanItem[] {
  const seen = new Set<string>()
  const items: PlanItem[] = []
  for (const s of steps) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    items.push({
      id: s.id,
      title: s.title,
      ...(s.description ? { description: s.description } : {}),
      enabled: true,
    })
  }
  return items
}

/** The steps that will run or be skipped, in order (tombstones left out). */
export function liveSteps(list: PlanItem[]): PlanItem[] {
  return list.filter((s) => !s.removed)
}

/** 0-based position among live steps, or -1. */
export function livePosition(list: PlanItem[], id: string): number {
  return liveSteps(list).findIndex((s) => s.id === id)
}

/**
 * Moves a live step. `toIndex` is its position among the live steps once it
 * has been taken out of its current place; it is clamped. Tombstones keep
 * their place relative to the steps around them.
 */
export function moveStep(
  list: PlanItem[],
  id: string,
  toIndex: number,
): PlanItem[] {
  const item = list.find((s) => s.id === id && !s.removed)
  if (!item) return list
  const rest = list.filter((s) => s !== item)
  const live = liveSteps(rest)
  if (live.length === 0) return list
  const index = Math.max(0, Math.min(Math.trunc(toIndex), live.length))
  if (index === livePosition(list, id)) return list
  const at =
    index === live.length
      ? rest.indexOf(live[live.length - 1]) + 1
      : rest.indexOf(live[index])
  return [...rest.slice(0, at), item, ...rest.slice(at)]
}

/** Moves a live step up (-1) or down (+1) past the next live step. */
export function moveStepBy(
  list: PlanItem[],
  id: string,
  delta: number,
): PlanItem[] {
  const from = livePosition(list, id)
  if (from === -1) return list
  const to = from + delta
  if (to < 0 || to >= liveSteps(list).length) return list
  return moveStep(list, id, to)
}

export function removeStep(list: PlanItem[], id: string): PlanItem[] {
  if (!list.some((s) => s.id === id && !s.removed)) return list
  return list.map((s) => (s.id === id ? { ...s, removed: true } : s))
}

/** Undo for removeStep: the step comes back where it was. */
export function restoreStep(list: PlanItem[], id: string): PlanItem[] {
  if (!list.some((s) => s.id === id && s.removed)) return list
  return list.map((s) => {
    if (s.id !== id) return s
    const { removed: _removed, ...rest } = s
    return rest
  })
}

/** Appends a step written by the user. Blank titles and taken ids are ignored. */
export function addStep(
  list: PlanItem[],
  step: { id: string; title: string; description?: string },
): PlanItem[] {
  const title = step.title.trim()
  const description = step.description?.trim()
  if (!title || list.some((s) => s.id === step.id)) return list
  return [
    ...list,
    {
      id: step.id,
      title,
      ...(description ? { description } : {}),
      enabled: true,
      addedByUser: true,
    },
  ]
}

/** Replaces a step's title and description. A blank title is ignored. */
export function editStep(
  list: PlanItem[],
  id: string,
  patch: { title: string; description?: string },
): PlanItem[] {
  const title = patch.title.trim()
  const description = patch.description?.trim()
  if (!title) return list
  return list.map((s) => {
    if (s.id !== id) return s
    const { description: _old, ...rest } = s
    return { ...rest, title, ...(description ? { description } : {}) }
  })
}

export function setStepEnabled(
  list: PlanItem[],
  id: string,
  enabled: boolean,
): PlanItem[] {
  return list.map((s) => (s.id === id ? { ...s, enabled } : s))
}

/** A new id for a user step that no item uses yet. */
export function uniqueStepId(list: PlanItem[], prefix = "added"): string {
  const taken = new Set(list.map((s) => s.id))
  let n = 1
  while (taken.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

/** One longest common subsequence of two id lists. */
export function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return out
}

/**
 * What changed between the proposal and the current plan. `moved` is the
 * smallest set of steps whose relocation explains the new order, so moving
 * one step counts once, and moving it back counts zero.
 */
export function diffPlan(
  original: PlanItem[],
  current: PlanItem[],
): PlanChanges {
  const byId = new Map(original.map((s) => [s.id, s]))
  const live = liveSteps(current)
  const liveIds = new Set(live.map((s) => s.id))

  const removed = original.filter((s) => !liveIds.has(s.id)).map((s) => s.id)
  const added = live.filter((s) => !byId.has(s.id)).map((s) => s.id)
  const edited = live
    .filter((s) => {
      const o = byId.get(s.id)
      return (
        !!o &&
        (s.title !== o.title || (s.description ?? "") !== (o.description ?? ""))
      )
    })
    .map((s) => s.id)
  const disabled = live
    .filter((s) => !s.enabled && byId.get(s.id)?.enabled === true)
    .map((s) => s.id)

  const originalKept = original.map((s) => s.id).filter((id) => liveIds.has(id))
  const currentKept = live.map((s) => s.id).filter((id) => byId.has(id))
  const stayed = new Set(longestCommonSubsequence(originalKept, currentKept))
  const moved = currentKept.filter((id) => !stayed.has(id))

  return { moved, removed, edited, added, disabled }
}

export function countChanges(changes: PlanChanges): number {
  return (
    changes.moved.length +
    changes.removed.length +
    changes.edited.length +
    changes.added.length +
    changes.disabled.length
  )
}

/** e.g. "2 changes: moved 1, removed 1", or "No changes". */
export function summarizeChanges(changes: PlanChanges): string {
  const total = countChanges(changes)
  if (total === 0) return "No changes"
  const parts = [
    ["moved", changes.moved.length],
    ["removed", changes.removed.length],
    ["edited", changes.edited.length],
    ["added", changes.added.length],
    ["skipped", changes.disabled.length],
  ] as const
  const detail = parts
    .filter(([, n]) => n > 0)
    .map(([verb, n]) => `${verb} ${n}`)
    .join(", ")
  return `${pluralize(total, "change")}: ${detail}`
}

/**
 * Steps that would run before (or without) a step they depend on. Skipped
 * and removed steps don't run, so their own dependencies don't matter.
 * Unknown ids and self-references are ignored.
 */
export function findDependencyIssues(
  list: PlanItem[],
  dependsOn: Record<string, string[] | undefined>,
): DependencyIssue[] {
  const live = liveSteps(list)
  const position = new Map(live.map((s, i) => [s.id, i]))
  const byId = new Map(list.map((s) => [s.id, s]))
  const issues: DependencyIssue[] = []
  for (const step of live) {
    if (!step.enabled) continue
    for (const dep of new Set(dependsOn[step.id] ?? [])) {
      const target = byId.get(dep)
      if (dep === step.id || !target) continue
      const reason = target.removed
        ? "removed"
        : !target.enabled
          ? "skipped"
          : (position.get(dep) ?? -1) > (position.get(step.id) ?? -1)
            ? "order"
            : null
      if (reason) issues.push({ stepId: step.id, dependsOnId: dep, reason })
    }
  }
  return issues
}

/** e.g. "Step 4 needs “Export contacts”, which now runs later." */
export function describeIssue(
  issue: DependencyIssue,
  list: PlanItem[],
): string {
  const n = livePosition(list, issue.stepId) + 1
  const dep = list.find((s) => s.id === issue.dependsOnId)?.title ?? "a step"
  const tail =
    issue.reason === "order"
      ? "which now runs later"
      : issue.reason === "removed"
        ? "which was removed"
        : "which is skipped"
  return `Step ${n} needs “${dep}”, ${tail}.`
}

const UNIT_MINUTES: Record<string, number> = {
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
}

/**
 * Minutes in an estimate such as "~2 min", "1 h", "1.5 hours" or
 * "1 h 30 min". Anything else (ranges, days, free text) returns null.
 */
export function parseEstimate(text: string | undefined): number | null {
  if (!text) return null
  let rest = text
    .trim()
    .toLowerCase()
    .replace(/^(~|≈|about|around|approx\.?|approximately)\s*/, "")
  if (!rest) return null
  let total = 0
  let matched = false
  const token = /^(\d+(?:\.\d+)?)\s*([a-z]+)\s*(?:,|and)?\s*/
  while (rest) {
    const m = token.exec(rest)
    const unit = m ? UNIT_MINUTES[m[2]] : undefined
    if (!m || unit === undefined) return null
    total += Number(m[1]) * unit
    matched = true
    rest = rest.slice(m[0].length)
  }
  return matched && Number.isFinite(total) ? Math.round(total) : null
}

/** Sum of the estimates in minutes, or null if any is missing or unparseable. */
export function sumEstimates(estimates: (string | undefined)[]): number | null {
  if (estimates.length === 0) return null
  let total = 0
  for (const e of estimates) {
    const minutes = parseEstimate(e)
    if (minutes === null) return null
    total += minutes
  }
  return total
}

/** e.g. "25 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h} h ${rem} min` : `${h} h`
}

/** "about 25 min" when the steps can be summed, otherwise the agent's total. */
export function estimateLabel(
  estimates: (string | undefined)[],
  totalEstimate?: string,
): string | undefined {
  const sum = sumEstimates(estimates)
  if (sum !== null) return `about ${formatMinutes(sum)}`
  return totalEstimate?.trim() || undefined
}

/** Index where a dragged row lands, from the other rows' vertical midpoints. */
export function indexFromMidpoints(midpoints: number[], y: number): number {
  let i = 0
  while (i < midpoints.length && y > midpoints[i]) i++
  return i
}

/** The live steps in result form, final order. */
export function toResultSteps(list: PlanItem[]) {
  return liveSteps(list).map((s) => ({
    id: s.id,
    title: s.title,
    ...(s.description ? { description: s.description } : {}),
    enabled: s.enabled,
    ...(s.addedByUser ? { addedByUser: true } : {}),
  }))
}

/** Rebuilds plan items from a stored result. */
export function fromResultSteps(
  steps: {
    id: string
    title: string
    description?: string
    enabled: boolean
    addedByUser?: boolean
  }[],
): PlanItem[] {
  return steps.map((s) => ({
    id: s.id,
    title: s.title,
    ...(s.description ? { description: s.description } : {}),
    enabled: s.enabled !== false,
    ...(s.addedByUser ? { addedByUser: true } : {}),
  }))
}
