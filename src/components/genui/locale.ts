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
