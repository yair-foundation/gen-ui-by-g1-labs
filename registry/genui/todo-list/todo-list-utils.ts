/**
 * To-do List: pure helpers for due dates (time zone aware), quick-add
 * parsing, grouping, sorting and diffing the user's edits against the list
 * as it was loaded. No React, no Zod, so they run anywhere.
 *
 * Calendar days are handled as "YYYY-MM-DD" keys and all day arithmetic is
 * done in UTC, so daylight-saving changes never shift a date.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type TodoPriority = "high" | "medium" | "low"

export type TodoSubtaskData = { id: string; text: string; done: boolean }

export type TodoItemData = {
  id: string
  text: string
  done: boolean
  due?: string
  priority?: TodoPriority
  notes?: string
  tags?: string[]
  subtasks?: TodoSubtaskData[]
  assignee?: { name: string; initials: string }
}

/** Fields of an item that can change, besides `done`. null means cleared. */
export type TodoItemPatch = {
  [K in Exclude<keyof TodoItemData, "id" | "done">]?: TodoItemData[K] | null
}

export type TodoChanges = {
  /** New items, in full. */
  added: TodoItemData[]
  /** Changed fields per existing item. A cleared field is null. */
  updated: { id: string; fields: TodoItemPatch }[]
  /** Ids checked off. */
  completed: string[]
  /** Ids unchecked. */
  reopened: string[]
  deleted: string[]
  /** The fewest existing items whose move explains the new order. */
  reordered: string[]
  /** Every item id in the final order. Only present when `reordered` isn't empty. */
  order?: string[]
}

export type DueBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "week"
  | "later"
  | "none"

export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "none", label: "No date" },
]

export const PRIORITY_ORDER: TodoPriority[] = ["high", "medium", "low"]

export function pluralize(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

// ---- Time zones and day keys ----

/** The time zone when the runtime knows it, otherwise undefined. */
export function safeTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return timeZone
  } catch {
    return undefined
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function zonedParts(t: number, timeZone: string | undefined) {
  const key = timeZone ?? ""
  let f = partsCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsCache.set(key, f)
  }
  const out: Record<string, number> = {}
  for (const p of f.formatToParts(t)) {
    if (p.type !== "literal") out[p.type] = Number(p.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  }
}

const pad = (n: number) => String(n).padStart(2, "0")

function keyFrom(y: number, m: number, d: number) {
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`
}

/** The calendar day of an instant in a time zone (the runtime's when omitted). */
export function dayKeyOf(t: number, timeZone?: string): string {
  const p = zonedParts(t, timeZone)
  return keyFrom(p.year, p.month, p.day)
}

function keyToUTC(key: string) {
  const [y, m, d] = key.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

/** `key` plus `n` days. Pure calendar math, so DST never shifts it. */
export function addDays(key: string, n: number): string {
  const d = new Date(keyToUTC(key) + n * 86_400_000)
  return keyFrom(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((keyToUTC(b) - keyToUTC(a)) / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  return new Date(keyToUTC(key)).getUTCDay()
}

function offsetMinutes(t: number, timeZone: string | undefined) {
  const p = zonedParts(t, timeZone)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUTC - Math.floor(t / 1000) * 1000) / 60_000)
}

/** The instant a wall-clock time happens in a time zone. */
export function wallTimeToInstant(
  key: string,
  hour: number,
  minute: number,
  timeZone?: string,
): number {
  const guess = keyToUTC(key) + (hour * 60 + minute) * 60_000
  const first = offsetMinutes(guess, timeZone)
  const t = guess - first * 60_000
  const second = offsetMinutes(t, timeZone)
  return second === first ? t : guess - second * 60_000
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

function validKey(key: string) {
  const m = DATE_ONLY.exec(key)
  if (!m) return false
  const d = new Date(keyToUTC(key))
  return d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3])
}

export type ParsedDue = {
  /** The calendar day in the list's time zone. */
  dayKey: string
  /** The exact moment, for date-times. null for date-only values. */
  instant: number | null
}

/**
 * Reads a due value: a date ("2026-10-09"), a date-time with an offset
 * ("2026-10-09T15:00:00Z"), or a local date-time ("2026-10-09T15:00"), which
 * is read as wall time in `timeZone`.
 */
export function parseDue(
  due: string | undefined,
  timeZone?: string,
): ParsedDue | null {
  if (!due) return null
  const value = due.trim()
  if (DATE_ONLY.test(value)) {
    return validKey(value) ? { dayKey: value, instant: null } : null
  }
  const local = LOCAL_DATE_TIME.exec(value)
  if (local) {
    if (!validKey(local[1])) return null
    return {
      dayKey: local[1],
      instant: wallTimeToInstant(
        local[1],
        Number(local[2]),
        Number(local[3]),
        timeZone,
      ),
    }
  }
  const t = Date.parse(value)
  if (Number.isNaN(t)) return null
  return { dayKey: dayKeyOf(t, timeZone), instant: t }
}

/** Which due group an item falls in. Without `now`, everything dated is "later". */
export function dueBucket(
  due: string | undefined,
  now: number | null,
  timeZone?: string,
): DueBucket {
  const parsed = parseDue(due, timeZone)
  if (!parsed) return "none"
  if (now === null) return "later"
  if (parsed.instant !== null && parsed.instant < now) return "overdue"
  const days = diffDays(dayKeyOf(now, timeZone), parsed.dayKey)
  if (days < 0) return "overdue"
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  if (days <= 6) return "week"
  return "later"
}

export type DueDisplay = {
  /** "Today", "Tomorrow", "Fri", "Oct 20" or "Oct 20, 2027". */
  label: string
  /** "3:00 PM" for date-times. */
  time?: string
  overdue: boolean
  /** The full visible text, e.g. "Overdue · Oct 6" or "Today 3:00 PM". */
  text: string
  /** For screen readers, e.g. "Due Friday, October 9". */
  long: string
}

function formatKey(
  key: string,
  options: Intl.DateTimeFormatOptions,
  locale: string = DEFAULT_LOCALE,
) {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(keyToUTC(key))
}

/** How a due value reads in the list. */
export function dueDisplay(
  due: string | undefined,
  now: number | null,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): DueDisplay | null {
  const parsed = parseDue(due, timeZone)
  if (!parsed) return null
  const today = now === null ? null : dayKeyOf(now, timeZone)
  const days = today === null ? null : diffDays(today, parsed.dayKey)
  const sameYear =
    today === null || today.slice(0, 4) === parsed.dayKey.slice(0, 4)
  const dateLabel = formatKey(
    parsed.dayKey,
    {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    },
    locale,
  )
  const label =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days !== null && days > 1 && days <= 6
          ? formatKey(parsed.dayKey, { weekday: "short" }, locale)
          : dateLabel
  const time =
    parsed.instant === null
      ? undefined
      : new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        }).format(parsed.instant)
  const overdue =
    now !== null &&
    (parsed.instant !== null ? parsed.instant < now : (days ?? 0) < 0)
  const longDate = formatKey(
    parsed.dayKey,
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    },
    locale,
  )
  const when = time ? `${longDate}, ${time}` : longDate
  const shown = overdue
    ? days === 0 && time
      ? `Today ${time}`
      : dateLabel
    : time
      ? `${label} ${time}`
      : label
  return {
    label,
    time,
    overdue,
    text: overdue ? `Overdue · ${shown}` : shown,
    long: overdue ? `Overdue, was due ${when}` : `Due ${when}`,
  }
}

// ---- Quick add ----

const WEEKDAYS: Record<string, number> = {
  // "sun" and "sat" are left out: they're everyday words ("sun hat").
  sunday: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join("|")
const LEAD = "(?:(?:on|by|for|due|this|next)\\s+)?"
const DUE_PATTERN = new RegExp(
  `(^|\\s)${LEAD}(today|tonight|tomorrow|next\\s+week|in\\s+(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})\\s+(days?|weeks?)|(${WEEKDAY_NAMES}))(?=$|[\\s.,!?;:])`,
  "i",
)
const PRIORITY_PATTERN = /(^|\s)(!high|!medium|!med|!low|!!!?)(?=$|\s)/i

export type QuickAdd = {
  /** The task text with the parsed words taken out. */
  text: string
  due?: string
  /** The words the due date was read from, e.g. "for Friday". */
  dueSource?: string
  priority?: TodoPriority
  /** e.g. "!high" or "!!". */
  prioritySource?: string
}

/** The next given weekday strictly after `today` (so Friday on a Friday is a week out). */
export function nextWeekday(today: string, weekday: number): string {
  const diff = (weekday - weekdayOf(today) + 7) % 7
  return addDays(today, diff === 0 ? 7 : diff)
}

/**
 * Reads a due date and a priority out of a quick-add line, e.g.
 * "Call the bank friday !high". Recognizes today, tonight, tomorrow, weekday
 * names (the next one after today), "next week" (next Monday), "in 3 days",
 * "in 2 weeks", and !high / !medium / !low / !! for priority. A leading
 * "on", "by", "for", "due", "this" or "next" goes with the date. Pass `skip`
 * to leave a part in the text (when the user removed its chip).
 */
export function parseQuickAdd(
  input: string,
  today: string,
  skip: { due?: boolean; priority?: boolean } = {},
): QuickAdd {
  let text = input
  const out: QuickAdd = { text: "" }

  if (!skip.priority) {
    const m = PRIORITY_PATTERN.exec(text)
    if (m) {
      const token = m[2].toLowerCase()
      out.priority =
        token === "!low"
          ? "low"
          : token === "!medium" || token === "!med"
            ? "medium"
            : "high"
      out.prioritySource = m[2]
      text = text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length)
    }
  }

  if (!skip.due) {
    const m = DUE_PATTERN.exec(text)
    if (m) {
      const word = m[2].toLowerCase().replace(/\s+/g, " ")
      let due: string | undefined
      if (word === "today" || word === "tonight") due = today
      else if (word === "tomorrow") due = addDays(today, 1)
      else if (word === "next week") due = nextWeekday(today, 1)
      else if (word.startsWith("in ")) {
        const n = Number(m[3]) || NUMBER_WORDS[m[3].toLowerCase()] || 0
        const unit = m[4].toLowerCase().startsWith("week") ? 7 : 1
        if (n > 0) due = addDays(today, n * unit)
      } else if (m[5]) {
        due = nextWeekday(today, WEEKDAYS[m[5].toLowerCase()])
      }
      if (due) {
        out.due = due
        out.dueSource = m[0].slice(m[1].length).trim()
        text = text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length)
      }
    }
  }

  out.text = text.replace(/\s+/g, " ").trim()
  return out
}

// ---- Grouping and sorting ----

export type GroupBy = "none" | "due" | "priority" | "tag"

export type TodoGroup<T> = {
  key: string
  label: string
  items: T[]
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * Orders a group's items. "manual" keeps the list order (the user's own,
 * reorderable); "smart" puts done items last, then higher priority, then
 * earlier due, then the list order.
 */
export function sortWithinGroup<T extends TodoItemData>(
  items: T[],
  mode: "manual" | "smart",
  timeZone?: string,
): T[] {
  if (mode === "manual") return [...items]
  const index = new Map(items.map((item, i) => [item, i]))
  const dueValue = (item: T) => {
    const p = parseDue(item.due, timeZone)
    if (!p) return Number.POSITIVE_INFINITY
    return p.instant ?? keyToUTC(p.dayKey)
  }
  return [...items].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (PRIORITY_RANK[a.priority ?? ""] ?? 3) -
        (PRIORITY_RANK[b.priority ?? ""] ?? 3) ||
      dueValue(a) - dueValue(b) ||
      (index.get(a) ?? 0) - (index.get(b) ?? 0),
  )
}

/** Whether the user can reorder items by hand under this grouping. */
export function canReorder(groupBy: GroupBy) {
  return groupBy === "none" || groupBy === "priority"
}

/**
 * Splits items into groups, in display order. Empty groups are left out.
 * Due groups: Overdue, Today, Tomorrow, This week (2–6 days out), Later, No
 * date. Tag groups use each item's first tag, in order of appearance, then
 * "No tag". Without `now`, due grouping falls back to one group sorted by date.
 */
export function groupItems<T extends TodoItemData>(
  items: T[],
  groupBy: GroupBy,
  now: number | null,
  timeZone?: string,
): TodoGroup<T>[] {
  const mode = canReorder(groupBy) ? "manual" : "smart"
  const fill = (
    defs: { key: string; label: string }[],
    keyOf: (item: T) => string,
  ) => {
    const buckets = new Map<string, T[]>(defs.map((d) => [d.key, []]))
    for (const item of items) buckets.get(keyOf(item))?.push(item)
    return defs
      .map((d) => ({
        key: d.key,
        label: d.label,
        items: sortWithinGroup(buckets.get(d.key) ?? [], mode, timeZone),
      }))
      .filter((g) => g.items.length > 0)
  }

  if (groupBy === "due") {
    if (now === null) {
      return items.length
        ? [
            {
              key: "all",
              label: "Tasks",
              items: sortWithinGroup(items, "smart", timeZone),
            },
          ]
        : []
    }
    return fill(DUE_BUCKETS, (item) => dueBucket(item.due, now, timeZone))
  }
  if (groupBy === "priority") {
    return fill(
      [
        { key: "high", label: "High priority" },
        { key: "medium", label: "Medium priority" },
        { key: "low", label: "Low priority" },
        { key: "none", label: "No priority" },
      ],
      (item) => item.priority ?? "none",
    )
  }
  if (groupBy === "tag") {
    const defs: { key: string; label: string }[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const tag = item.tags?.find((t) => t.trim())?.trim()
      if (tag && !seen.has(tag)) {
        seen.add(tag)
        defs.push({ key: `tag:${tag}`, label: tag })
      }
    }
    defs.push({ key: "none", label: "No tag" })
    return fill(defs, (item) => {
      const tag = item.tags?.find((t) => t.trim())?.trim()
      return tag ? `tag:${tag}` : "none"
    })
  }
  return items.length ? [{ key: "all", label: "Tasks", items: [...items] }] : []
}

/**
 * Moves an item within its group. `groupIds` are the group's items in display
 * order; `toIndex` is the item's new position among them (clamped). Other
 * entries of `list` (other groups, done items, deleted placeholders) keep their
 * places.
 */
export function moveInGroup<T extends { id: string }>(
  list: T[],
  id: string,
  groupIds: string[],
  toIndex: number,
): T[] {
  const item = list.find((x) => x.id === id)
  const from = groupIds.indexOf(id)
  if (!item || from === -1) return list
  const others = groupIds.filter((x) => x !== id)
  const index = Math.max(0, Math.min(Math.trunc(toIndex), others.length))
  if (index === from) return list
  const rest = list.filter((x) => x !== item)
  const at =
    others.length === 0
      ? rest.length
      : index === others.length
        ? rest.findIndex((x) => x.id === others[others.length - 1]) + 1
        : rest.findIndex((x) => x.id === others[index])
  return [...rest.slice(0, at), item, ...rest.slice(at)]
}

/** Index where a dragged row lands, from the other rows' vertical midpoints. */
export function indexFromMidpoints(midpoints: number[], y: number): number {
  let i = 0
  while (i < midpoints.length && y > midpoints[i]) i++
  return i
}

/** A new id no item uses yet. */
export function uniqueId(list: { id: string }[], prefix = "new"): string {
  const taken = new Set(list.map((x) => x.id))
  let n = 1
  while (taken.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

// ---- Diffing ----

/** Ids of one longest common subsequence of two id lists. */
export function longestCommonSubsequence(
  a: string[],
  b: string[],
): Set<string> {
  const cols = b.length + 1
  const table = new Array<number>((a.length + 1) * cols).fill(0)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
    }
  }
  const kept = new Set<string>()
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept.add(a[i])
      i++
      j++
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++
    else j++
  }
  return kept
}

const FIELDS = [
  "text",
  "due",
  "priority",
  "notes",
  "tags",
  "subtasks",
  "assignee",
] as const

const empty = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0)

function sameValue(a: unknown, b: unknown) {
  if (empty(a) && empty(b)) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/** An item with only its known fields, and empty optional fields dropped. */
export function cleanItem(item: TodoItemData): TodoItemData {
  const out: TodoItemData = { id: item.id, text: item.text, done: item.done }
  for (const f of FIELDS) {
    if (f === "text") continue
    const v = item[f]
    if (!empty(v)) Object.assign(out, { [f]: v })
  }
  return out
}

/**
 * The smallest change set that turns `original` into `current`: new and
 * deleted items, changed fields, ticks, unticks, and the fewest items whose
 * move explains the new order (moving one item and back again counts zero).
 */
export function diffTodos(
  original: TodoItemData[],
  current: TodoItemData[],
): TodoChanges {
  const before = new Map(original.map((i) => [i.id, i]))
  const now = new Map(current.map((i) => [i.id, i]))
  const changes: TodoChanges = {
    added: [],
    updated: [],
    completed: [],
    reopened: [],
    deleted: [],
    reordered: [],
  }
  for (const item of current) {
    const o = before.get(item.id)
    if (!o) {
      changes.added.push(cleanItem(item))
      continue
    }
    if (item.done && !o.done) changes.completed.push(item.id)
    if (!item.done && o.done) changes.reopened.push(item.id)
    const fields: TodoItemPatch = {}
    for (const f of FIELDS) {
      if (!sameValue(o[f], item[f])) {
        Object.assign(fields, { [f]: empty(item[f]) ? null : item[f] })
      }
    }
    if (Object.keys(fields).length > 0)
      changes.updated.push({ id: item.id, fields })
  }
  for (const o of original) if (!now.has(o.id)) changes.deleted.push(o.id)

  const keptBefore = original.map((i) => i.id).filter((id) => now.has(id))
  const keptNow = current.map((i) => i.id).filter((id) => before.has(id))
  const stayed = longestCommonSubsequence(keptBefore, keptNow)
  changes.reordered = keptNow.filter((id) => !stayed.has(id))
  if (changes.reordered.length > 0) changes.order = current.map((i) => i.id)
  return changes
}

export function countChanges(changes: TodoChanges): number {
  return (
    changes.added.length +
    changes.updated.length +
    changes.completed.length +
    changes.reopened.length +
    changes.deleted.length +
    changes.reordered.length
  )
}

/** Replays a change set on the list it was made from (restoring history). */
export function applyTodoChanges(
  original: TodoItemData[],
  changes: TodoChanges,
): TodoItemData[] {
  const deleted = new Set(changes.deleted)
  const completed = new Set(changes.completed)
  const reopened = new Set(changes.reopened)
  const patches = new Map(changes.updated.map((u) => [u.id, u.fields]))
  const list: TodoItemData[] = original
    .filter((i) => !deleted.has(i.id))
    .map((i) => {
      let next: TodoItemData = { ...i }
      if (completed.has(i.id)) next.done = true
      if (reopened.has(i.id)) next.done = false
      const patch = patches.get(i.id)
      if (patch) {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete (next as Record<string, unknown>)[k]
          else next = { ...next, [k]: v }
        }
      }
      return next
    })
  const existing = new Set(list.map((i) => i.id))
  for (const a of changes.added) if (!existing.has(a.id)) list.push({ ...a })
  if (!changes.order) return list
  const byId = new Map(list.map((i) => [i.id, i]))
  const ordered = changes.order
    .map((id) => byId.get(id))
    .filter((i): i is TodoItemData => i !== undefined)
  const placed = new Set(ordered.map((i) => i.id))
  return [...ordered, ...list.filter((i) => !placed.has(i.id))]
}

// ---- Counts ----

export type TodoCounts = { open: number; done: number; overdue: number }

export function countItems(
  items: TodoItemData[],
  now: number | null,
  timeZone?: string,
): TodoCounts {
  let open = 0
  let done = 0
  let overdue = 0
  for (const item of items) {
    if (item.done) {
      done++
      continue
    }
    open++
    if (dueBucket(item.due, now, timeZone) === "overdue") overdue++
  }
  return { open, done, overdue }
}

/** e.g. "5 to do · 2 done · 1 overdue". Zero parts after the first are left out. */
export function countsText(counts: TodoCounts): string {
  const parts = [`${counts.open} to do`]
  if (counts.done > 0) parts.push(`${counts.done} done`)
  if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`)
  return parts.join(" · ")
}
