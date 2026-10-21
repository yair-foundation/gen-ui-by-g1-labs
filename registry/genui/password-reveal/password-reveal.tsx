"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import {
  MASK,
  MAX_LENGTH,
  MIN_LENGTH,
  charset,
  clampLength,
  clipboardText,
  codeGrid,
  countdownText,
  entropyBits,
  expiryText,
  type GenerateOptions,
  generatePassword,
  strengthLabel,
  strengthLevel,
  toCodes,
} from "./password-reveal-utils"
import type {
  PasswordGenerateInput,
  PasswordRevealInput,
  PasswordRevealResult,
  SecretKind,
} from "./password-reveal.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type PasswordRevealStatus =
  | "streaming"
  | "ready"
  | "consumed"
  | "dismissed"
  | "rotation-requested"

export type PasswordRevealProps = Partial<
  Omit<PasswordRevealInput, "value" | "generate">
> & {
  /** May be a partial list while the tool call streams. */
  value?: string | string[]
  generate?: Partial<PasswordGenerateInput>
  /** Lifecycle, controlled by the host. */
  status?: PasswordRevealStatus
  /**
   * Called with what the user did. Never carries the secret. 'revealed' and
   * 'copied' can repeat; 'rotated-request' and 'dismiss' end the card.
   */
  onResult?: (result: PasswordRevealResult) => void
  /**
   * A result from history. 'dismiss' and 'rotated-request' restore the closed
   * card; 'revealed' on a one-time secret restores it as already shown.
   * Never calls onResult.
   */
  result?: PasswordRevealResult
  className?: string
}

const KIND_LABEL: Record<SecretKind, string> = {
  password: "Password",
  code: "Code",
  codes: "Codes",
  "api-key": "API key",
  pin: "PIN",
  generated: "Generated password",
}

const NOUN: Record<SecretKind, string> = {
  password: "password",
  code: "code",
  codes: "codes",
  "api-key": "key",
  pin: "PIN",
  generated: "password",
}

/**
 * Applied to every element that holds the secret: excluded from translation,
 * spellcheck, autofill and password-manager capture, and marked private for
 * session-replay and analytics tools that honor `data-private`.
 */
const PRIVATE_ATTRS = {
  "data-private": "",
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  translate: "no",
  spellCheck: false,
  autoComplete: "off",
} as const

/** The clipboard is read only when the browser already allows it; never prompts. */
async function clipboardReadGranted() {
  try {
    const p = await navigator.permissions?.query({
      name: "clipboard-read" as PermissionName,
    })
    return p?.state === "granted"
  } catch {
    return false
  }
}

/**
 * Best effort: after `seconds`, if the clipboard can be read without a prompt
 * and still holds `text`, overwrite it with an empty string. Otherwise skip.
 * Runs even if the card unmounts.
 */
function scheduleClipboardClear(text: string, seconds: number) {
  window.setTimeout(async () => {
    if (!(await clipboardReadGranted())) return
    try {
      if ((await navigator.clipboard.readText()) === text) {
        await navigator.clipboard.writeText("")
      }
    } catch {
      // Not focused or not allowed: leave the clipboard alone.
    }
  }, seconds * 1000)
}

/** A fixed-text message in the footer's live region. Never the secret. */
function useAnnouncement() {
  const [message, setMessage] = React.useState("")
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const announce = React.useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(""), 4000)
  }, [])
  return [message, announce] as const
}

/** Current time, ticking while `active`; null until mounted (no SSR mismatch). */
function useNow(active: boolean, everyMs: number) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(t)
  }, [active, everyMs])
  return now
}

function toOptions(
  g: Partial<PasswordGenerateInput> | undefined,
): GenerateOptions {
  return {
    length: clampLength(g?.length ?? 20),
    symbols: g?.symbols ?? true,
    numbers: g?.numbers ?? true,
    uppercase: g?.uppercase ?? true,
    exclude: g?.exclude,
  }
}

function initialDecision(
  result: PasswordRevealResult | undefined,
  oneTime: boolean,
) {
  if (result?.action === "dismiss") return "dismissed" as const
  if (result?.action === "rotated-request") return "rotation-requested" as const
  if (result && oneTime) return "consumed" as const
  return null
}

function StrengthMeter({ bits }: { bits: number }) {
  const level = strengthLevel(bits)
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full bg-muted transition-colors dark:bg-white/15",
              i <= level &&
                (level === 1
                  ? "bg-red-500 dark:bg-red-400"
                  : level === 2
                    ? "bg-orange-500 dark:bg-orange-400"
                    : "bg-emerald-500 dark:bg-emerald-400"),
            )}
          />
        ))}
      </div>
      <span className={cn("shrink-0 tabular-nums", genuiType.meta)}>
        {strengthLabel(bits)}
      </span>
    </div>
  )
}

function GeneratorOptions({
  options,
  disabled,
  onChange,
}: {
  options: GenerateOptions
  disabled: boolean
  onChange: (next: GenerateOptions) => void
}) {
  const id = React.useId()
  const toggles = [
    { key: "uppercase", label: "Uppercase" },
    { key: "numbers", label: "Numbers" },
    { key: "symbols", label: "Symbols" },
  ] as const
  return (
    <fieldset
      disabled={disabled}
      className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
    >
      <legend className="sr-only">Password options</legend>
      {/* Label above, slider with its live value to the right (Halaska UI layout). */}
      <div className="flex flex-col gap-2">
        <span id={`${id}-length`} className={genuiType.label}>
          Length
        </span>
        <div className="flex items-center gap-3">
          <SliderPrimitive.Root
            className="min-w-0 flex-1"
            aria-labelledby={`${id}-length`}
            value={[options.length]}
            min={MIN_LENGTH}
            max={MAX_LENGTH}
            step={1}
            disabled={disabled}
            thumbAlignment="edge"
            onValueChange={(v) =>
              onChange({
                ...options,
                length: clampLength(Array.isArray(v) ? v[0] : v),
              })
            }
          >
            <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1.5 select-none data-disabled:opacity-50">
              <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
                <SliderPrimitive.Indicator className="h-full bg-choice" />
              </SliderPrimitive.Track>
              <SliderPrimitive.Thumb
                getAriaLabel={() => "Password length"}
                getAriaValueText={(_, n) => `${n} characters`}
                className="relative block h-6 w-3 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
              />
            </SliderPrimitive.Control>
          </SliderPrimitive.Root>
          <span className={cn(genuiType.value, "min-w-6 text-right")}>
            <span className="sr-only">{options.length}</span>
            <span aria-hidden className="inline-flex">
              <SlidingNumber number={options.length} initiallyStable />
            </span>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {toggles.map((t) => (
          <div key={t.key} className="flex items-center gap-2">
            <Switch
              id={`${id}-${t.key}`}
              nativeButton
              checked={options[t.key]}
              disabled={disabled}
              onCheckedChange={(on) => onChange({ ...options, [t.key]: on })}
            />
            <label htmlFor={`${id}-${t.key}`} className="text-[13px]">
              {t.label}
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  )
}

export function PasswordReveal({
  label,
  kind = "password",
  value,
  hint,
  revealSeconds = 30,
  oneTime = false,
  clearClipboardAfter = 60,
  generate,
  rotatable = false,
  expiresAt,
  status: statusProp,
  onResult,
  result,
  className,
}: PasswordRevealProps) {
  const [decision, setDecision] = React.useState(() =>
    initialDecision(result, oneTime),
  )
  const [options, setOptions] = React.useState(() => toOptions(generate))
  const [generated, setGenerated] = React.useState<string | null>(null)
  const [hideAt, setHideAt] = React.useState<number | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [message, announce] = useAnnouncement()
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(copiedTimer.current), [])

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: PasswordRevealStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const open = status === "ready"
  const isGenerated = kind === "generated"
  const noun = NOUN[kind] ?? "secret"

  // The secret is only held while the card is open.
  const isList = kind === "codes" || Array.isArray(value)
  const codes = open && isList ? toCodes(value) : []
  const secret: string | string[] | null = !open
    ? null
    : isGenerated
      ? generated
      : isList
        ? codes.length
          ? codes
          : null
        : typeof value === "string" && value
          ? value
          : null
  const shown = hideAt !== null && secret !== null
  const now = useNow(shown || expiresAt !== undefined, shown ? 250 : 30_000)

  // Generate in the browser, on the client only, whenever the options change.
  const optionsKey = JSON.stringify(options)
  React.useEffect(() => {
    if (!isGenerated || !open) return
    try {
      setGenerated(generatePassword(JSON.parse(optionsKey)))
    } catch {
      setGenerated(null)
    }
  }, [isGenerated, open, optionsKey])

  const report = (r: PasswordRevealResult) => {
    // A result from history never reports again.
    if (result === undefined) onResult?.(r)
  }

  const hide = React.useCallback(
    (why: "timer" | "tab" | "user") => {
      setHideAt(null)
      if (oneTime && !isGenerated) {
        setDecision((d) => d ?? "consumed")
        announce("Hidden. It was shown once and is gone now.")
        return
      }
      announce(
        why === "timer"
          ? "Hidden again."
          : why === "tab"
            ? "Hidden because you left the tab."
            : "Hidden.",
      )
    },
    [announce, oneTime, isGenerated],
  )

  // Auto-hide after revealSeconds.
  React.useEffect(() => {
    if (hideAt === null) return
    const t = window.setTimeout(
      () => hide("timer"),
      Math.max(0, hideAt - Date.now()),
    )
    return () => window.clearTimeout(t)
  }, [hideAt, hide])

  // Hide when the tab is hidden.
  React.useEffect(() => {
    if (hideAt === null) return
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hide("tab")
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [hideAt, hide])

  // Closing the card drops any reveal and the generated value.
  React.useEffect(() => {
    if (open) return
    setHideAt(null)
    setGenerated(null)
  }, [open])

  const seconds = Math.min(300, Math.max(5, revealSeconds))
  const toggleReveal = () => {
    if (!secret) return
    if (shown) {
      hide("user")
      return
    }
    setHideAt(Date.now() + seconds * 1000)
    announce(`Shown. Hides in ${seconds} seconds.`)
    report({ action: "revealed" })
  }

  const copy = async () => {
    if (!secret) return
    const text = clipboardText(secret)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      announce("Couldn't copy. Reveal it and select the text instead.")
      return
    }
    report({ action: "copied" })
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    const clearAfter = Math.max(0, clearClipboardAfter)
    if (clearAfter === 0) {
      announce("Copied.")
      return
    }
    scheduleClipboardClear(text, clearAfter)
    announce(
      (await clipboardReadGranted())
        ? `Copied. The clipboard clears in ${clearAfter} seconds.`
        : "Copied. Clear your clipboard when you're done.",
    )
  }

  const regenerate = () => {
    if (!isGenerated || !open) return
    try {
      setGenerated(generatePassword(options))
      announce("New password generated.")
    } catch {
      announce("Couldn't generate with these options.")
    }
  }

  const requestNew = () => {
    setHideAt(null)
    setDecision("rotation-requested")
    report({ action: "rotated-request" })
  }

  const dismiss = () => {
    setHideAt(null)
    setDecision("dismissed")
    report({ action: "dismiss" })
  }

  const secondsLeft =
    shown && hideAt !== null && now !== null ? (hideAt - now) / 1000 : seconds
  const expiry = now !== null ? expiryText(expiresAt, now) : null
  const bits = entropyBits(options.length, charset(options).length)
  const canRotate =
    rotatable && (open || status === "consumed") && result === undefined

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="password-reveal"
        data-status={status}
        data-kind={kind}
        aria-busy={streaming}
        aria-label={label ?? "Secret"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle className="min-w-0 break-words">{label}</SurfaceTitle>
          <span className="sr-only">{KIND_LABEL[kind] ?? "Secret"}</span>
          {(hint || expiry) && (
            <SurfaceDescription className="flex flex-wrap gap-x-2">
              {hint && <span>{hint}</span>}
              {hint && expiry && <span aria-hidden>·</span>}
              {expiry && <span>{expiry}</span>}
            </SurfaceDescription>
          )}
        </SurfaceHeader>

        <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
          {streaming && !secret ? (
            <div aria-hidden className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full rounded-[10px]" />
              <Skeleton className="h-3 w-24" />
            </div>
          ) : status === "consumed" ? (
            <p className="text-[13px] text-muted-foreground">
              {isList
                ? "These codes were shown once."
                : `This ${noun} was shown once.`}
            </p>
          ) : status === "dismissed" ? (
            <p className="text-[13px] text-muted-foreground">
              Hidden and closed.
            </p>
          ) : status === "rotation-requested" ? (
            <p className="text-[13px] text-muted-foreground">
              New {noun === "codes" ? "codes" : noun} requested.
            </p>
          ) : (
            <>
              <div className="flex min-h-14 items-center rounded-[10px] border border-border bg-transparent px-4 py-3">
                {shown && secret !== null ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    className="w-full"
                  >
                    {Array.isArray(secret) ? (
                      <ol
                        {...PRIVATE_ATTRS}
                        aria-label={label ?? "Codes"}
                        className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[13px]"
                      >
                        {codeGrid(secret, 2)
                          .flat()
                          .map(({ n, code }) => (
                            <li key={n} className="flex gap-2">
                              <span
                                aria-hidden
                                className="w-5 shrink-0 text-right tabular-nums text-muted-foreground"
                              >
                                {n}.
                              </span>
                              <span className="break-all">{code}</span>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <span
                        {...PRIVATE_ATTRS}
                        className={cn(
                          "block font-mono text-[16px] font-medium break-all select-all",
                          kind === "pin" && "text-2xl tracking-[0.3em]",
                        )}
                      >
                        {secret}
                      </span>
                    )}
                  </motion.div>
                ) : (
                  // Masked: the secret isn't in the DOM, and the mask has a
                  // fixed length so it doesn't reveal the real one.
                  <span className="flex items-baseline gap-3">
                    <span
                      aria-hidden
                      className="font-mono text-[16px] tracking-widest text-muted-foreground"
                    >
                      {MASK}
                    </span>
                    <span className="sr-only">Hidden</span>
                    {isList && codes.length > 0 && (
                      <span className={genuiType.meta}>
                        {codes.length} codes
                      </span>
                    )}
                  </span>
                )}
              </div>
              {(shown || (oneTime && !isGenerated)) && (
                <p className={cn("tabular-nums", genuiType.meta)}>
                  {shown ? (
                    <span aria-hidden>{countdownText(secondsLeft)}</span>
                  ) : isList ? (
                    "Shown once. Save them before they hide."
                  ) : (
                    "Shown once. Save it before it hides."
                  )}
                </p>
              )}
            </>
          )}
        </div>

        {isGenerated && open && (
          <div className="flex flex-col gap-5 border-t border-border px-3 py-3">
            <StrengthMeter bits={bits} />
            <GeneratorOptions
              options={options}
              disabled={streaming}
              onChange={setOptions}
            />
          </div>
        )}

        <SurfaceFooter className="justify-between">
          <p
            aria-live="polite"
            className={cn("min-w-0 flex-1", genuiType.meta)}
          >
            {streaming ? (
              <ShimmeringText
                text={isGenerated ? "Preparing…" : "Getting it…"}
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : (
              message
            )}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {open && (
              <>
                <WhyDisabled reason={!streaming && !secret && "Nothing here yet"}>
                  <IconTip label={`Reveal ${label ?? noun}`}>
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      aria-pressed={shown}
                      aria-label={`Reveal ${label ?? noun}`}
                      disabled={!secret}
                      onClick={toggleReveal}
                      className="aria-pressed:bg-muted"
                    >
                      {shown ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
                    </Button>
                  </IconTip>
                </WhyDisabled>
                {isGenerated && (
                  <WhyDisabled reason={!streaming && !secret && "Nothing here yet"}>
                    <IconTip label="Regenerate">
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Regenerate"
                        disabled={!secret}
                        onClick={regenerate}
                      >
                        <RefreshCwIcon aria-hidden />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                )}
              </>
            )}
            {canRotate && (
              <Button
                size="sm"
                variant={open ? "secondary" : "default"}
                onClick={requestNew}
              >
                <RotateCwIcon aria-hidden />
                Request new<span className="sr-only"> {noun}</span>
              </Button>
            )}
            {open && (
              <>
                <WhyDisabled reason={!streaming && !secret && "Nothing here yet"}>
                  <Button size="sm" disabled={!secret} onClick={copy}>
                    {copied ? (
                      <CheckIcon aria-hidden />
                    ) : (
                      <CopyIcon aria-hidden />
                    )}
                    Copy<span className="sr-only"> {noun}</span>
                  </Button>
                </WhyDisabled>
                <IconTip label="Done">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Done"
                    disabled={streaming}
                    onClick={dismiss}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </IconTip>
              </>
            )}
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
