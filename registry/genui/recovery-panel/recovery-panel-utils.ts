/**
 * Recovery Panel: pure helpers (no React, no imports), so they can be unit
 * tested and reused by the host.
 *
 * - Fields: a fix-input field is invalid while it still holds the value that
 *   failed (its previous `error` is shown), or when it fails its type check.
 * - Primary label: the footer button names the action of the selected option,
 *   e.g. "Try again", "Send request", "Book 7:30 PM".
 * - Countdown: a retry with `availableAt` stays disabled until then; the text
 *   reads "Available in 1:52".
 * - Partial counts: done = completed.count (or its items), failed =
 *   failed.count (or its items).
 */

export type RecoveryKind =
  | "access"
  | "input"
  | "unavailable"
  | "partial"
  | "limit"
  | "conflict"

export type RecoveryOptionType =
  | "retry"
  | "reconnect"
  | "request-access"
  | "fix-input"
  | "alternative"
  | "skip"
  | "contact"
  | "cancel"

export type RecoveryFieldType = "text" | "email" | "number" | "date"

export type FieldLike = {
  label?: string
  type?: RecoveryFieldType
  value?: string
  error?: string
  required?: boolean
}

/** Any option, possibly partial while streaming. */
export type OptionLike = {
  id?: string
  type?: RecoveryOptionType
  label?: string
  actionLabel?: string
  verb?: string
  service?: string
  to?: string
  availableAt?: string
  choices?: { id?: string; label?: string }[]
  fields?: unknown[]
}

export type ResultLike =
  | {
      action: "recover"
      optionId: string
      type: RecoveryOptionType
      values?: Record<string, string>
      choiceId?: string
      message?: string
    }
  | { action: "cancel" }

export const kindLabel: Record<RecoveryKind, string> = {
  access: "Access needed",
  input: "Input needs fixing",
  unavailable: "Not available",
  partial: "Partly done",
  limit: "Limit reached",
  conflict: "Conflict",
}

/* ------------------------------------------------------------------------ */
/* Field validation                                                         */
/* ------------------------------------------------------------------------ */

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 'YYYY-MM-DD' that is a real calendar date. */
export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  )
}

/** Type and required checks only. */
export function validateFieldValue(
  field: FieldLike,
  raw: string | undefined,
): string | null {
  const value = (raw ?? "").trim()
  const label = field.label ?? "This field"
  if (value === "") return field.required ? `${label} is required.` : null
  switch (field.type ?? "text") {
    case "email":
      return emailPattern.test(value) ? null : "Enter a valid email address."
    case "number":
      return Number.isFinite(Number(value)) ? null : "Enter a number."
    case "date":
      return isValidIsoDate(value) ? null : "Enter a valid date."
    default:
      return null
  }
}

/** The previous failure, while the field still holds the value that failed. */
export function previousError(
  field: FieldLike,
  raw: string | undefined,
): string | null {
  if (!field.error) return null
  return (raw ?? "").trim() === (field.value ?? "").trim() ? field.error : null
}

/** Why a fix-input field can't be sent as is, or null when it can. */
export function fieldError(
  field: FieldLike,
  raw: string | undefined,
): string | null {
  return previousError(field, raw) ?? validateFieldValue(field, raw)
}

/* ------------------------------------------------------------------------ */
/* Options                                                                  */
/* ------------------------------------------------------------------------ */

/** The first option that isn't cancel: the one marked "Recommended". */
export function recommendedOption<T extends { type?: string }>(
  options: T[],
): T | undefined {
  return options.find((o) => o.type !== undefined && o.type !== "cancel")
}

/** The footer's primary button label for the selected option. */
export function primaryLabel(option: OptionLike, choiceId?: string): string {
  if (option.actionLabel) return option.actionLabel
  switch (option.type) {
    case "retry":
      return "Try again"
    case "reconnect":
      return (
        option.label ??
        (option.service ? `Reconnect ${option.service}` : "Reconnect")
      )
    case "request-access":
      return "Send request"
    case "fix-input":
      return "Save and retry"
    case "alternative": {
      const choices = option.choices ?? []
      const choice =
        choices.find((c) => c.id === choiceId) ??
        (choices.length === 1 ? choices[0] : undefined)
      if (!choice?.label) return option.label ?? "Choose"
      return option.verb ? `${option.verb} ${choice.label}` : choice.label
    }
    case "skip":
      return option.label ?? "Continue"
    case "contact":
      return option.label ?? "Contact support"
    case "cancel":
      return option.label ?? "Cancel"
    default:
      return option.label ?? "Continue"
  }
}

/** Screen-reader text when an option is selected and its inline UI appears. */
export function revealAnnouncement(
  option: OptionLike,
  waitText?: string | null,
): string {
  const label = option.label ?? "Option"
  const extra = (() => {
    switch (option.type) {
      case "fix-input": {
        const n = option.fields?.length ?? 0
        return n === 1 ? "1 field to fix below." : `${n} fields to fix below.`
      }
      case "alternative": {
        const n = option.choices?.length ?? 0
        return n === 1 ? "1 choice below." : `Choose one of ${n} choices below.`
      }
      case "request-access":
        return "You can edit the message below."
      case "reconnect":
        return `You'll sign in to ${option.service ?? "the service"} next.`
      case "retry":
        return waitText ?? ""
      default:
        return ""
    }
  })()
  return `${label} selected.${extra ? ` ${extra}` : ""}`
}

/** The compact record shown after the user chose. */
export function recordText(
  result: ResultLike,
  option?: OptionLike,
  choiceLabel?: string,
): string {
  if (result.action === "cancel") return "Cancelled"
  switch (result.type) {
    case "retry":
      return "Retrying…"
    case "reconnect":
      return option?.service
        ? `Reconnecting ${option.service}…`
        : "Reconnecting…"
    case "request-access":
      return option?.to ? `Asked ${option.to} for access` : "Requested access"
    case "fix-input":
      return "Sent the corrected details"
    case "alternative":
      return choiceLabel ? `Chose ${choiceLabel}` : "Chose another option"
    default:
      return option?.label ? `Chose: ${option.label}` : "Chose how to continue"
  }
}

/* ------------------------------------------------------------------------ */
/* Countdown                                                                */
/* ------------------------------------------------------------------------ */

/** Milliseconds until `availableAt`; 0 when it has passed or is invalid. */
export function msUntil(availableAt: string | undefined, now: number): number {
  if (!availableAt) return 0
  const at = Date.parse(availableAt)
  if (Number.isNaN(at)) return 0
  return Math.max(0, at - now)
}

/** "0:45", "1:52", "1:05:09". Rounds up so it never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** "Available in 1:52", or null once it's available. */
export function countdownText(
  availableAt: string | undefined,
  now: number,
): string | null {
  const ms = msUntil(availableAt, now)
  return ms > 0 ? `Available in ${formatCountdown(ms)}` : null
}

/* ------------------------------------------------------------------------ */
/* Partial results                                                          */
/* ------------------------------------------------------------------------ */

const count = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0
    ? Math.floor(n)
    : fallback

export function partialCounts(
  completed?: { count?: number; items?: unknown[] },
  failed?: { count?: number; items?: unknown[] },
) {
  const done = completed
    ? count(completed.count, completed.items?.length ?? 0)
    : 0
  const failedN = failed ? count(failed.count, failed.items?.length ?? 0) : 0
  const total = done + failedN
  return {
    done,
    failed: failedN,
    total,
    donePercent: total ? Math.round((done / total) * 100) : 0,
  }
}

/** "8 sent · 2 failed". */
export function splitText(
  counts: { done: number; failed: number },
  verb?: string,
): string {
  return `${counts.done} ${verb?.trim() || "done"} · ${counts.failed} failed`
}

/** How many completed items aren't listed: "and 3 more". */
export function moreCount(total: number | undefined, shown: number): number {
  return typeof total === "number" && total > shown ? total - shown : 0
}

/* ------------------------------------------------------------------------ */
/* Links                                                                    */
/* ------------------------------------------------------------------------ */

/** Only absolute http(s) URLs; anything else is dropped. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}
