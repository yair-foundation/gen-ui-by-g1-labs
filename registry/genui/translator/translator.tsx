"use client"

import * as React from "react"
import {
  ArrowLeftRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  InfoIcon,
  LanguagesIcon,
  RepeatIcon,
  SquareIcon,
  Volume2Icon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { Segmented } from "@/components/genui/segmented"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import {
  type Formality,
  type TranslationBase,
  type TranslationDraft,
  baseDraft,
  canonicalLanguage,
  charCount,
  charCountLabel,
  deriveView,
  languageName,
  languageOptions,
  pickVoice,
  sameLanguage,
  swapDraft,
  textDirection,
} from "./translator-utils"
import type {
  TranslatorGlossaryEntry,
  TranslatorInput,
  TranslatorResult,
} from "./translator.schema"

export type TranslatorStatus = "streaming" | "ready" | "translating"

export type TranslatorProps = Partial<
  Omit<
    TranslatorInput,
    "source" | "target" | "alternatives" | "notes" | "glossary"
  >
> & {
  /** Fields may be partial while the tool call streams. */
  source?: Partial<TranslatorInput["source"]>
  target?: Partial<TranslatorInput["target"]>
  alternatives?: string[]
  notes?: string[]
  glossary?: Partial<TranslatorGlossaryEntry>[]
  /**
   * Lifecycle, controlled by the host. After the user presses Translate the
   * component shows "translating" until the props change.
   */
  status?: TranslatorStatus
  /**
   * Called with 'translate' (reply by re-rendering with the new translation)
   * or 'choose'. Any number of times: the translator never locks.
   */
  onResult?: (result: TranslatorResult) => void
  /**
   * The last result, from history. Restores the requested text or the chosen
   * phrasing; it is never sent again.
   */
  result?: TranslatorResult
  className?: string
}

const MAX_SOURCE = 5000
/** Language names follow the component's (English) UI copy. */
const DISPLAY_LOCALE = "en"

/** A fixed-text message in the footer's live region. */
function useAnnouncement() {
  const [message, setMessage] = React.useState("")
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const announce = React.useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(""), 3000)
  }, [])
  return [message, announce] as const
}

/** Speech synthesis in `lang`, when the browser has it (and a voice for it). */
function useSpeech(lang: string) {
  const [supported, setSupported] = React.useState(false)
  const [speaking, setSpeaking] = React.useState(false)

  React.useEffect(() => {
    const synth =
      typeof window === "undefined" ? undefined : window.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance === "undefined" || !lang) {
      setSupported(false)
      return
    }
    // Voices load asynchronously; an empty list means "not known yet".
    const check = () => {
      const voices = synth.getVoices()
      setSupported(voices.length === 0 || Boolean(pickVoice(voices, lang)))
    }
    check()
    synth.addEventListener?.("voiceschanged", check)
    return () => synth.removeEventListener?.("voiceschanged", check)
  }, [lang])

  // Stop talking when the card unmounts.
  React.useEffect(
    () => () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel()
    },
    [],
  )

  const speak = React.useCallback(
    (text: string) => {
      const synth = window.speechSynthesis
      if (!synth) return
      synth.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang
      const voice = pickVoice(synth.getVoices(), lang)
      if (voice) utterance.voice = voice
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      setSpeaking(true)
      synth.speak(utterance)
    },
    [lang],
  )
  const stop = React.useCallback(() => {
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }, [])

  return { supported, speaking, speak, stop }
}

function LanguageSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  disabled: boolean
  onChange: (code: string) => void
}) {
  const items = options.map((code) => ({
    value: code,
    label: languageName(code, DISPLAY_LOCALE),
  }))
  return (
    <Select
      value={value || null}
      onValueChange={(v) => {
        if (typeof v === "string" && v) onChange(v)
      }}
      items={items}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-0">
        <SelectValue placeholder="Language" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FormalityToggle({
  value,
  disabled,
  onChange,
}: {
  value: Formality
  disabled: boolean
  onChange: (value: Formality) => void
}) {
  return (
    <Segmented
      fit
      label="Formality"
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={[
        { value: "formal", label: "Formal" },
        { value: "informal", label: "Informal" },
      ]}
    />
  )
}

export function Translator({
  source,
  target,
  alternatives = [],
  formality,
  transliteration,
  notes = [],
  glossary = [],
  languages,
  status: statusProp,
  onResult,
  result,
  className,
}: TranslatorProps) {
  const locale = useGenUILocale()
  const ids = React.useId()
  const [message, announce] = useAnnouncement()

  // What the host rendered.
  const base: TranslationBase = {
    text: source?.text ?? "",
    from: source?.language ? canonicalLanguage(source.language) : "",
    to: target?.language ? canonicalLanguage(target.language) : "",
    translation: target?.text,
    formality: formality ?? null,
  }

  // The user's working copy; null follows the props.
  const [draft, setDraft] = React.useState<TranslationDraft | null>(() =>
    result?.action === "translate"
      ? {
          text: result.text,
          from: canonicalLanguage(result.from),
          to: canonicalLanguage(result.to),
          formality: result.formality ?? formality ?? null,
        }
      : null,
  )
  const [pending, setPending] = React.useState(false)
  const [requested, setRequested] = React.useState(
    result?.action === "translate",
  )
  const [picked, setPicked] = React.useState<string | null>(() =>
    result?.action === "choose" ? result.text : null,
  )
  const [chosen, setChosen] = React.useState<string | null>(() =>
    result?.action === "choose" ? result.text : null,
  )
  const [copied, setCopied] = React.useState(false)
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(copiedTimer.current), [])

  // A host-provided "ready" (or nothing) yields to the local wait.
  const status: TranslatorStatus =
    pending && (statusProp === undefined || statusProp === "ready")
      ? "translating"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const translating = status === "translating"
  const busy = streaming || translating

  // New props from the host end the wait and replace the working copy.
  const signature = JSON.stringify([
    base.text,
    base.from,
    base.to,
    base.translation ?? null,
    base.formality,
  ])
  const lastSignature = React.useRef(signature)
  React.useEffect(() => {
    if (streaming || lastSignature.current === signature) return
    lastSignature.current = signature
    setDraft(null)
    setPending(false)
    setRequested(false)
    setPicked(null)
    setChosen(null)
  }, [signature, streaming])

  const current = draft ?? baseDraft(base)
  const view = deriveView(base, current)
  const options = languageOptions(
    languages,
    base.from,
    base.to,
    current.from,
    current.to,
  )
  const alts = alternatives.filter(
    (a): a is string => typeof a === "string" && a.trim() !== "",
  )
  const readyGlossary = glossary.filter(
    (g): g is TranslatorGlossaryEntry =>
      typeof g.source === "string" && typeof g.target === "string",
  )
  const readyNotes = notes.filter(
    (n): n is string => typeof n === "string" && n.trim() !== "",
  )

  // Alternatives, transliteration and formality belong to the base direction.
  const showExtras = !view.swapped
  const shownText =
    showExtras && !view.outOfDate && picked && alts.includes(picked)
      ? picked
      : view.translation
  const translationLang = view.translationLang
  const speech = useSpeech(translationLang)
  const count = charCount(current.text)
  const fromName = languageName(current.from, DISPLAY_LOCALE)
  const toName = languageName(current.to, DISPLAY_LOCALE)
  const samePair =
    Boolean(current.from && current.to) &&
    sameLanguage(current.from, current.to)
  const needsTranslation = view.outOfDate || (view.missing && !streaming)

  const edit = (patch: Partial<TranslationDraft>) => {
    setDraft({ ...current, ...patch })
    setPicked(null)
  }

  const swap = () => {
    setDraft(swapDraft(current, view))
    setPicked(null)
    speech.stop()
    announce(`Swapped: ${toName} to ${fromName}.`)
  }

  const translate = () => {
    if (!current.text.trim() || samePair || busy) return
    const f = current.formality
    setPending(true)
    setRequested(true)
    speech.stop()
    onResult?.({
      action: "translate",
      text: current.text,
      from: current.from,
      to: current.to,
      ...(f ? { formality: f } : {}),
    })
  }

  const choose = (text: string) => {
    setChosen(text)
    onResult?.({ action: "choose", text })
    announce("Using this version.")
  }

  const copy = async () => {
    if (!shownText) return
    try {
      await navigator.clipboard.writeText(shownText)
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
      announce("Translation copied.")
    } catch {
      announce("Couldn't copy. Select the text and copy it instead.")
    }
  }

  const dir = textDirection(translationLang)
  const sourceDir = textDirection(current.from)
  const countId = `${ids}-count`
  const glossaryFrom = view.swapped ? base.to : base.from
  const glossaryTo = view.swapped ? base.from : base.to

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="translator"
        data-status={status}
        data-out-of-date={view.outOfDate || undefined}
        aria-busy={busy}
        aria-label={current.to ? `Translation into ${toName}` : "Translation"}
        className={className}
      >
        <SurfaceHeader className="flex-row flex-wrap items-center gap-3 pb-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400"
          >
            <LanguagesIcon className="size-5" />
          </span>
          <SurfaceTitle className="min-w-0 flex-1">
            {current.from && current.to ? (
              <>
                {fromName}
                <span className="text-muted-foreground"> to </span>
                {toName}
              </>
            ) : streaming ? undefined : (
              "Translation"
            )}
          </SurfaceTitle>
          {showExtras &&
            (formality === "formal" || formality === "informal") && (
              <FormalityToggle
                value={current.formality ?? formality}
                disabled={busy}
                onChange={(f) => edit({ formality: f })}
              />
            )}
        </SurfaceHeader>

        {/* Language bar: from, swap, to. */}
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="min-w-0 flex-1">
            <LanguageSelect
              label="Translate from"
              value={current.from}
              options={options}
              disabled={busy}
              onChange={(code) => edit({ from: code })}
            />
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Swap languages"
                  disabled={busy || !current.from || !current.to}
                  onClick={swap}
                  className="hover:bg-muted dark:hover:bg-white/10"
                />
              }
            >
              <ArrowLeftRightIcon aria-hidden />
            </TooltipTrigger>
            <TooltipContent>Swap languages</TooltipContent>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <LanguageSelect
              label="Translate to"
              value={current.to}
              options={options}
              disabled={busy}
              onChange={(code) => edit({ to: code })}
            />
          </div>
        </div>

        <div className="@container">
          <div className="grid grid-cols-1 @xl:grid-cols-2">
            {/* Source */}
            <div className="flex min-w-0 flex-col gap-2 border-t border-border px-3 py-3 transition-colors focus-within:bg-muted/50 dark:focus-within:bg-white/[0.03]">
              <p className={cn("flex items-center gap-2", genuiType.label)}>
                Original
                {source?.detected && sameLanguage(current.from, base.from) && (
                  <Badge variant="secondary">Detected</Badge>
                )}
              </p>
              {streaming && !source?.text ? (
                <div aria-hidden className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                <Textarea
                  aria-label={
                    fromName
                      ? `Text to translate, in ${fromName}`
                      : "Text to translate"
                  }
                  aria-describedby={countId}
                  lang={current.from || undefined}
                  dir={sourceDir}
                  value={current.text}
                  maxLength={MAX_SOURCE}
                  disabled={busy}
                  onChange={(e) => edit({ text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      translate()
                    }
                  }}
                  className="min-h-20 resize-none rounded-none border-0 bg-transparent p-0 text-[14px] leading-[1.6] text-muted-foreground shadow-none focus-visible:ring-0 md:text-[14px] dark:bg-transparent"
                />
              )}
              {/* Shown only near the limit; always read to screen readers. */}
              <p
                id={countId}
                className={cn(
                  "tabular-nums",
                  genuiType.meta,
                  count >= MAX_SOURCE && "text-destructive",
                  count < MAX_SOURCE * 0.9 && "sr-only",
                )}
              >
                {charCountLabel(count, undefined, locale)}
              </p>
            </div>

            {/* Target */}
            <div
              data-slot="translator-target"
              className="flex min-w-0 flex-col gap-3 border-t border-border px-3 py-3 @xl:border-l"
            >
              <p aria-hidden className={genuiType.label}>
                {toName || "Translation"}
              </p>
              {(view.outOfDate || translating) && (
                <div className="flex flex-wrap items-center gap-2">
                  {translating ? (
                    <span className="text-[13px] leading-4">
                      <ShimmeringText
                        text="Translating…"
                        color="var(--muted-foreground)"
                        shimmeringColor="var(--foreground)"
                      />
                    </span>
                  ) : (
                    <Badge variant="warning">Out of date</Badge>
                  )}
                </div>
              )}

              {shownText ? (
                <motion.div
                  key={`${translationLang}:${shownText}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex flex-col gap-1"
                >
                  <p
                    lang={translationLang || undefined}
                    dir={dir}
                    className={cn(
                      "whitespace-pre-wrap break-words transition-opacity",
                      // A short phrase is the answer itself: show it large.
                      shownText.length <= 80
                        ? "text-[24px] leading-8 font-semibold tracking-tight"
                        : "text-[15px] leading-[1.6] font-medium",
                      (view.outOfDate || translating) &&
                        "text-muted-foreground opacity-70",
                    )}
                  >
                    {shownText}
                  </p>
                  {showExtras &&
                    transliteration &&
                    shownText === view.translation && (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-[10px] bg-muted px-3 py-2 dark:bg-white/[0.04]">
                        <p className="flex min-w-0 flex-col">
                          <span className={genuiType.label}>Pronunciation</span>
                          <span
                            lang={
                              translationLang
                                ? `${translationLang}-Latn`
                                : undefined
                            }
                            className="text-[14px] leading-5"
                          >
                            {transliteration}
                          </span>
                        </p>
                        {speech.supported && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Listen in ${languageName(translationLang, DISPLAY_LOCALE)}`}
                            disabled={busy}
                            onClick={() =>
                              speech.speaking
                                ? speech.stop()
                                : speech.speak(shownText)
                            }
                            className="hover:bg-background dark:hover:bg-white/10"
                          >
                            {speech.speaking ? (
                              <SquareIcon aria-hidden />
                            ) : (
                              <Volume2Icon aria-hidden />
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                </motion.div>
              ) : streaming ? (
                <div aria-hidden className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : (
                <p className="text-[13px] leading-5 text-muted-foreground">
                  No translation yet.
                </p>
              )}

              {showExtras && alts.length > 0 && (
                <div className="flex flex-col gap-2">
                  <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                    <legend className={cn("mb-1.5 p-0", genuiType.label)}>
                      Other ways to say it
                    </legend>
                    <div className="flex flex-col gap-1">
                      {alts.map((alt, i) => (
                        <motion.button
                          key={alt}
                          type="button"
                          lang={translationLang || undefined}
                          dir={dir}
                          aria-pressed={picked === alt}
                          disabled={busy || view.outOfDate}
                          onClick={() =>
                            setPicked((p) => (p === alt ? null : alt))
                          }
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={genuiMotion.fade}
                          className="group/alt -mx-2 flex min-h-10 items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[14px] leading-5 break-words transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-pressed:ring-2 aria-pressed:ring-choice aria-pressed:ring-inset aria-pressed:hover:bg-transparent dark:aria-pressed:hover:bg-transparent dark:hover:bg-white/5"
                        >
                          <span
                            aria-hidden
                            className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground tabular-nums dark:bg-white/10"
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">{alt}</span>
                          <RepeatIcon
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/alt:opacity-100 group-focus-visible/alt:opacity-100 group-aria-pressed/alt:opacity-100"
                          />
                          {chosen === alt && (
                            <span className="sr-only"> (in use)</span>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  </fieldset>
                  {picked && alts.includes(picked) && !view.outOfDate && (
                    <div className="flex flex-wrap items-center gap-2">
                      {chosen === picked ? (
                        <p
                          className={cn(
                            "flex items-center gap-1.5",
                            genuiType.meta,
                          )}
                        >
                          <CheckIcon aria-hidden className="size-3.5" />
                          Using this version
                        </p>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => choose(picked)}
                        >
                          Use this version
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Side notes stay one tap away, so the translation leads. */}
        {(readyNotes.length > 0 || readyGlossary.length > 0) && (
          <details className="group/notes border-t border-border">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 text-[14px] font-medium outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset dark:hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden">
              <BookOpenIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="flex-1">
                {readyNotes.length > 0 && readyGlossary.length > 0
                  ? "Notes and glossary"
                  : readyNotes.length > 0
                    ? "Notes"
                    : "Glossary"}
                <span className="font-normal text-muted-foreground">
                  {` · ${readyNotes.length + readyGlossary.length}`}
                </span>
              </span>
              <ChevronRightIcon
                aria-hidden
                className="size-4 text-muted-foreground transition-transform group-open/notes:rotate-90 motion-reduce:transition-none"
              />
            </summary>
            <div className="flex flex-col divide-y divide-border border-t border-border">
              {readyNotes.map((note) => (
                <p
                  key={note}
                  className="flex items-start gap-2 px-3 py-2.5 text-[14px] leading-5"
                >
                  <InfoIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  {note}
                </p>
              ))}
              {readyGlossary.length > 0 && (
                <table
                  aria-label="Glossary"
                  className="w-full text-[14px] leading-5"
                >
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">
                        {languageName(glossaryFrom, DISPLAY_LOCALE)}
                      </th>
                      <th scope="col">
                        {languageName(glossaryTo, DISPLAY_LOCALE)}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {readyGlossary.map((g) => {
                      const [a, b] = view.swapped
                        ? [g.target, g.source]
                        : [g.source, g.target]
                      return (
                        <tr key={`${g.source}→${g.target}`}>
                          <td
                            lang={glossaryFrom || undefined}
                            className="w-1/2 py-2.5 pr-3 pl-3 align-top break-words text-muted-foreground"
                          >
                            {a}
                          </td>
                          <td
                            lang={glossaryTo || undefined}
                            className="w-1/2 py-2.5 pr-3 align-top font-medium break-words"
                          >
                            {b}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        )}

        <SurfaceFooter className="justify-between">
          <p
            aria-live="polite"
            className={cn("min-w-0 flex-1", genuiType.meta)}
          >
            {busy ? (
              <ShimmeringText
                text="Translating…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : message ? (
              message
            ) : requested && view.outOfDate ? (
              "Asked for a new translation."
            ) : samePair ? (
              "Pick two different languages."
            ) : null}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {speech.supported && (
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={speech.speaking}
                disabled={!shownText || busy}
                onClick={() =>
                  speech.speaking
                    ? speech.stop()
                    : shownText && speech.speak(shownText)
                }
              >
                {speech.speaking ? (
                  <SquareIcon aria-hidden />
                ) : (
                  <Volume2Icon aria-hidden />
                )}
                {speech.speaking ? "Stop" : "Listen"}
                <span className="sr-only">
                  {` in ${languageName(translationLang, DISPLAY_LOCALE)}`}
                </span>
              </Button>
            )}
            <WhyDisabled
              when={!shownText || busy}
              reason={busy ? "One moment…" : "Nothing to copy yet"}
            >
              <Button
                size="sm"
                variant={
                  needsTranslation || translating ? "secondary" : "default"
                }
                disabled={!shownText || busy}
                onClick={copy}
              >
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                Copy<span className="sr-only"> translation</span>
              </Button>
            </WhyDisabled>
            {(needsTranslation || translating) && (
              <WhyDisabled
                when={
                  busy ||
                  !current.text.trim() ||
                  samePair ||
                  !current.from ||
                  !current.to
                }
                reason={
                  busy
                    ? "One moment…"
                    : !current.text.trim()
                      ? "Enter some text first"
                      : samePair
                        ? "Pick two different languages"
                        : "Pick both languages"
                }
              >
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    !current.text.trim() ||
                    samePair ||
                    !current.from ||
                    !current.to
                  }
                  onClick={translate}
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                >
                  {translating ? "Translating…" : "Translate"}
                </Button>
              </WhyDisabled>
            )}
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
