"use client"

import * as React from "react"

/**
 * The locale every component formats numbers, money, dates and lists with
 * (decision D40). A host sets it once, with the Renderer's `locale` prop or
 * by wrapping its app in `GenUILocaleProvider`, usually from the signed-in
 * user's setting or the request's Accept-Language. Without one, components
 * use DEFAULT_LOCALE, so the server and the browser always render the same
 * text and React never sees a hydration mismatch. Never format with the
 * runtime's default locale (`Intl.NumberFormat(undefined)`,
 * `toLocaleString()`): it differs between server and browser.
 */
export const DEFAULT_LOCALE = "en-US"

/** A valid BCP 47 tag in canonical form, or DEFAULT_LOCALE. */
export function resolveLocale(locale: string | undefined | null): string {
  if (!locale) return DEFAULT_LOCALE
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

const LocaleContext = React.createContext<string>(DEFAULT_LOCALE)

/** Sets the locale for every GenUI component inside it. */
export function GenUILocaleProvider({
  locale,
  children,
}: {
  /** BCP 47, e.g. "en-GB" or "he-IL". Invalid tags fall back to DEFAULT_LOCALE. */
  locale: string | undefined
  children: React.ReactNode
}) {
  return React.createElement(
    LocaleContext.Provider,
    { value: resolveLocale(locale) },
    children,
  )
}

/** The locale to format with: the nearest provider's, else DEFAULT_LOCALE. */
export function useGenUILocale(): string {
  return React.useContext(LocaleContext)
}

/**
 * A date range with its en dash set by one rule, not the ICU version's:
 * closed between single terms ("14–19 Nov"), spaced when a term has a space
 * ("28 Nov – 3 Dec"). ICU 78 (Node 26) puts thin spaces around every range
 * dash while older ICU closes some, so the raw `formatRange` differs between
 * Node versions and browsers and breaks tests and hydration. Use this for
 * every `Intl.DateTimeFormat` range.
 *
 * Only whitespace changes: around the dash, and ICU 78's thin spaces inside a
 * term (en-GB "5<thin>November"), which become plain spaces. Punctuation
 * beside the dash stays ("5. – 7. November"), and a separator that is not an
 * en dash (Japanese "～") is left as the locale wrote it. Throws what
 * `formatRange` throws, so callers with unvalidated dates keep their try/catch.
 */
export function formatRangeWithDash(
  fmt: Intl.DateTimeFormat,
  a: Date,
  b: Date,
): string {
  const plain = (text: string) => text.replace(/\u2009/g, " ")
  if (typeof fmt.formatRangeToParts !== "function") {
    return `${fmt.format(a)} – ${fmt.format(b)}`
  }
  const parts = fmt.formatRangeToParts(a, b)
  const lastStart = parts.findLastIndex((p) => p.source === "startRange")
  const firstEnd = parts.findIndex((p) => p.source === "endRange")
  if (lastStart < 0 || firstEnd <= lastStart) return plain(fmt.formatRange(a, b))
  const join = (from: number, to?: number) =>
    parts
      .slice(from, to)
      .map((p) => p.value)
      .join("")
  const sep = join(lastStart + 1, firstEnd)
  if (sep.split("–").length !== 2) return plain(fmt.formatRange(a, b))
  const term = (source: string) =>
    parts
      .filter((p) => p.source === source)
      .map((p) => p.value)
      .join("")
  const spaced = /\s/.test(term("startRange")) || /\s/.test(term("endRange"))
  return plain(
    join(0, lastStart + 1) +
      sep.replace(/\s*–\s*/, spaced ? " – " : "–") +
      join(firstEnd),
  )
}
