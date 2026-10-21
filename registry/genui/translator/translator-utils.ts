/**
 * Pure helpers for the translator: language names and options, text
 * direction, character counts, the swap and out-of-date logic, and voice
 * matching for Listen. No DOM; safe on the server. Nothing here translates:
 * the translation always comes from the agent's tool.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type Formality = "formal" | "informal"

/** A sensible default set of BCP 47 codes the user can pick from. */
export const DEFAULT_LANGUAGES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "sv",
  "pl",
  "uk",
  "ru",
  "tr",
  "el",
  "ar",
  "he",
  "hi",
  "th",
  "vi",
  "id",
  "ja",
  "ko",
  "zh",
] as const

/** English names for the defaults, used when Intl.DisplayNames is missing. */
const FALLBACK_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  sv: "Swedish",
  pl: "Polish",
  uk: "Ukrainian",
  ru: "Russian",
  tr: "Turkish",
  el: "Greek",
  ar: "Arabic",
  he: "Hebrew",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
}

/** "en-us" → "en-US"; invalid tags come back trimmed as given. */
export function canonicalLanguage(code: string) {
  const trimmed = code.trim().replace(/_/g, "-")
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? trimmed
  } catch {
    return trimmed
  }
}

export const sameLanguage = (a: string, b: string) =>
  canonicalLanguage(a).toLowerCase() === canonicalLanguage(b).toLowerCase()

type DisplayNamesCtor = new (
  locales: string[],
  options: { type: "language"; fallback: "none" },
) => { of(code: string): string | undefined }

/**
 * "es" → "Spanish" (in `displayLocale`). Falls back to a built-in English
 * name, then to the code itself, when Intl.DisplayNames is unavailable or
 * doesn't know the tag. The last argument is injectable for tests (null =
 * unsupported runtime); the same goes for textDirection and charCount.
 */
export function languageName(
  code: string,
  displayLocale = "en",
  DisplayNames: DisplayNamesCtor | null = (
    Intl as { DisplayNames?: DisplayNamesCtor }
  ).DisplayNames ?? null,
) {
  const tag = canonicalLanguage(code)
  if (!tag) return ""
  if (DisplayNames) {
    try {
      const name = new DisplayNames([displayLocale], {
        type: "language",
        fallback: "none",
      }).of(tag)
      if (name && name.toLowerCase() !== tag.toLowerCase()) {
        return name.charAt(0).toLocaleUpperCase(displayLocale) + name.slice(1)
      }
    } catch {
      // Unknown or invalid tag: fall through.
    }
  }
  const base = tag.split("-")[0].toLowerCase()
  return FALLBACK_NAMES[tag.toLowerCase()] ?? FALLBACK_NAMES[base] ?? tag
}

/** "English · detected". */
export function sourceLanguageLabel(name: string, detected: boolean) {
  return detected ? `${name} · detected` : name
}

/**
 * The language options: the given list (or the defaults), canonical and
 * deduplicated, plus any `ensure` codes (the current pair) that are missing.
 */
export function languageOptions(
  languages: readonly string[] | undefined,
  ...ensure: (string | undefined)[]
) {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (code: string | undefined) => {
    if (!code?.trim()) return
    const tag = canonicalLanguage(code)
    const key = tag.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(tag)
  }
  for (const code of languages?.length ? languages : DEFAULT_LANGUAGES) {
    add(code)
  }
  for (const code of ensure) add(code)
  return out
}

type LocaleLike = {
  getTextInfo?: () => { direction?: string }
  textInfo?: { direction?: string }
}
type LocaleCtor = new (tag: string) => LocaleLike

/**
 * "rtl" or "ltr" from Intl.Locale's text info (getTextInfo() or the older
 * textInfo getter), or "auto" when the runtime can't tell.
 */
export function textDirection(
  lang: string,
  Locale: LocaleCtor | null = (Intl as { Locale?: LocaleCtor }).Locale ?? null,
): "rtl" | "ltr" | "auto" {
  if (!Locale || !lang.trim()) return "auto"
  try {
    const locale = new Locale(canonicalLanguage(lang))
    const info =
      typeof locale.getTextInfo === "function"
        ? locale.getTextInfo()
        : locale.textInfo
    const dir = info?.direction
    return dir === "rtl" || dir === "ltr" ? dir : "auto"
  } catch {
    return "auto"
  }
}

type SegmenterCtor = new (
  locale?: string,
  options?: { granularity: "grapheme" },
) => { segment(text: string): Iterable<unknown> }

/** User-perceived characters (graphemes), so emoji and accents count as one. */
export function charCount(
  text: string,
  Segmenter: SegmenterCtor | null = (Intl as { Segmenter?: SegmenterCtor })
    .Segmenter ?? null,
) {
  if (!text) return 0
  if (Segmenter) {
    let n = 0
    for (const _ of new Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(text)) {
      n++
    }
    return n
  }
  return Array.from(text).length
}

/** "1 character", "1,234 characters", "1,234 / 5,000 characters". */
export function charCountLabel(
  n: number,
  max?: number,
  locale: string = DEFAULT_LOCALE,
) {
  const f = (x: number) => new Intl.NumberFormat(locale).format(x)
  if (max !== undefined) return `${f(n)} / ${f(max)} characters`
  return `${f(n)} ${n === 1 ? "character" : "characters"}`
}

// ---- Swap and out-of-date --------------------------------------------------------

/** What the host last rendered: the source, the pair, and its translation. */
export type TranslationBase = {
  text: string
  from: string
  to: string
  translation?: string
  formality?: Formality | null
}

/** What the user has in the card now. */
export type TranslationDraft = {
  text: string
  from: string
  to: string
  formality?: Formality | null
}

export type TranslationView = {
  /** The translation to show (possibly out of date), if any. */
  translation?: string
  /** The language the shown translation is in. */
  translationLang: string
  /** The user changed the text, a language or the formality since. */
  outOfDate: boolean
  /** The draft is the base flipped, so the original is the translation. */
  swapped: boolean
  /** There's no translation to show yet. */
  missing: boolean
}

/** Edits that only add or remove surrounding whitespace don't count. */
export const sameText = (a: string, b: string) =>
  a.replace(/\r\n?/g, "\n").trim() === b.replace(/\r\n?/g, "\n").trim()

const sameFormality = (
  a: Formality | null | undefined,
  b: Formality | null | undefined,
) => (a ?? null) === (b ?? null)

export function baseDraft(base: TranslationBase): TranslationDraft {
  return {
    text: base.text,
    from: base.from,
    to: base.to,
    formality: base.formality ?? null,
  }
}

/**
 * Compares the draft with the base. A pure swap (the translation as source,
 * the pair flipped) shows the original as the translation and is up to date.
 */
export function deriveView(
  base: TranslationBase,
  draft: TranslationDraft,
): TranslationView {
  const hasTranslation = Boolean(base.translation?.trim())
  if (
    sameText(draft.text, base.text) &&
    sameLanguage(draft.from, base.from) &&
    sameLanguage(draft.to, base.to) &&
    sameFormality(draft.formality, base.formality)
  ) {
    return {
      translation: base.translation,
      translationLang: base.to,
      outOfDate: false,
      swapped: false,
      missing: !hasTranslation,
    }
  }
  if (
    hasTranslation &&
    base.text.trim() &&
    sameText(draft.text, base.translation ?? "") &&
    sameLanguage(draft.from, base.to) &&
    sameLanguage(draft.to, base.from)
  ) {
    return {
      translation: base.text,
      translationLang: base.from,
      outOfDate: false,
      swapped: true,
      missing: false,
    }
  }
  return {
    translation: base.translation,
    translationLang: base.to,
    outOfDate: true,
    swapped: false,
    missing: !hasTranslation,
  }
}

export const isOutOfDate = (base: TranslationBase, draft: TranslationDraft) =>
  deriveView(base, draft).outOfDate

/**
 * Flip the pair. When the shown translation is current, it becomes the new
 * source text (so the view is a pure swap); otherwise the text stays.
 */
export function swapDraft(
  draft: TranslationDraft,
  view: TranslationView,
): TranslationDraft {
  const useTranslation =
    !view.outOfDate && !view.missing && Boolean(view.translation)
  return {
    text: useTranslation ? (view.translation ?? draft.text) : draft.text,
    from: draft.to,
    to: draft.from,
    formality: draft.formality ?? null,
  }
}

// ---- Listen --------------------------------------------------------------------

/** A voice for `lang`: exact tag first, then the same base language. */
export function pickVoice<T extends { lang: string }>(
  voices: readonly T[],
  lang: string,
): T | undefined {
  const norm = (s: string) => s.replace(/_/g, "-").toLowerCase()
  const want = norm(canonicalLanguage(lang))
  const base = want.split("-")[0]
  return (
    voices.find((v) => norm(v.lang) === want) ??
    voices.find((v) => norm(v.lang).split("-")[0] === base)
  )
}
