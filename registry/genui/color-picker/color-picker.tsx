"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, SearchIcon, XIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  ColorPickerInput,
  ColorPickerResult,
  PaletteColor,
  PickedColor,
} from "./color-picker.schema"
import {
  type Hsl,
  contrastLevel,
  contrastRatio,
  contrastVerdict,
  deltaE,
  formatDeltaE,
  formatRatio,
  hexToHsl,
  hslToHex,
  isValidHex,
  matchesColor,
  nearestColors,
  normalizeHex,
  readableTextOn,
} from "./color-picker-utils"

export type ColorPickerStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "selected"
  | "cancelled"

export type ColorPickerProps = Partial<Omit<ColorPickerInput, "palette">> & {
  /** Colors may be partial while the tool call is still streaming. */
  palette?: Partial<PaletteColor>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: ColorPickerStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: ColorPickerResult) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Renders the
   * chosen colors read-only and never calls onResult.
   */
  result?: ColorPickerResult
  className?: string
}

/** A palette color with a normalized "#rrggbb" hex and its position. */
type Swatch = PaletteColor & { index: number }
type Picked = PickedColor & { key: string }
type ShownColor = {
  id?: string
  name: string
  hex: string
  code?: string
  group?: string
}

/** Above this many colors, add a search filter and scroll the grid. */
const SEARCH_THRESHOLD = 24

const WHITE = "#ffffff"
const BLACK = "#000000"

/**
 * While streaming, a hex like "#3a6" may be the start of "#3a6ea5", so only
 * accept complete 6-digit values until the call finishes.
 */
function settledHex(value: string | undefined, streaming: boolean) {
  if (streaming && !/^#?[0-9a-f]{6}$/i.test(value?.trim() ?? "")) return null
  return normalizeHex(value)
}

const pickedKey = (c: PickedColor) => c.id ?? `custom:${c.hex}`
const pickedLabel = (c: PickedColor) =>
  c.name ?? `Custom ${c.hex.toUpperCase()}`

function groupBy(swatches: Swatch[]) {
  const map = new Map<string, Swatch[]>()
  for (const s of swatches) {
    const key = s.group ?? ""
    map.set(key, [...(map.get(key) ?? []), s])
  }
  return [...map.entries()]
}

/** A small color square. Decorative: the name is always next to it. */
function Chip({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 rounded-sm border border-foreground/10 dark:border-foreground/15",
        className,
      )}
      style={{ backgroundColor: hex }}
    />
  )
}

function SectionHeading({
  id,
  children,
}: {
  id?: string
  children: React.ReactNode
}) {
  return (
    <h4 id={id} className={genuiType.label}>
      {children}
    </h4>
  )
}

/** The hex value with one copy button. */
function CopyHex({ hex }: { hex: string }) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const value = hex.toUpperCase()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span className={cn(genuiType.body, "font-mono tabular-nums")}>
        {value}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Copy hex value ${value}`}
        onClick={copy}
        className="-mr-2"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied hex value" : ""}
      </span>
    </span>
  )
}

/** One compact row: an "Aa" sample on each background, its ratio and level. */
function ContrastList({ hex, compare }: { hex: string; compare?: string }) {
  const rows: [string, string][] = [
    ["white", WHITE],
    ["black", BLACK],
  ]
  if (compare) rows.push([`the current ${compare.toUpperCase()}`, compare])
  return (
    <ul aria-label="Contrast" className="flex flex-wrap gap-x-4 gap-y-2">
      {rows.map(([label, against]) => {
        const ratio = contrastRatio(hex, against)
        const level = contrastLevel(ratio)
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-6 w-8 shrink-0 items-center justify-center rounded border border-foreground/10 text-[13px] font-semibold dark:border-foreground/15"
              style={{ backgroundColor: against, color: hex }}
            >
              Aa
            </span>
            <span className="sr-only">
              {`Against ${label}: ${formatRatio(ratio)}, ${contrastVerdict(ratio)}`}
            </span>
            <span aria-hidden className={cn(genuiType.body, "tabular-nums")}>
              {formatRatio(ratio)}
            </span>
            <span
              aria-hidden
              className={cn(
                genuiType.label,
                level !== "fail" && "text-foreground",
              )}
            >
              {level === "fail" ? "Fail" : level}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Preview({
  mode,
  color,
  compare,
}: {
  mode: "swatch" | "text" | "ui"
  color: ShownColor
  compare?: string
}) {
  const fg = readableTextOn(color.hex)
  const fgName = fg === BLACK ? "Black" : "White"

  if (mode === "text") {
    return (
      <figure className="m-0 grid gap-2 @md:grid-cols-2">
        <figcaption className="sr-only">
          {`Sample text on ${color.name} (${fgName.toLowerCase()} text, ${formatRatio(contrastRatio(color.hex, fg))}), and ${color.name} as text on the card background.`}
        </figcaption>
        <div
          aria-hidden
          className="flex flex-col gap-1 rounded-[10px] border border-foreground/10 p-3 dark:border-foreground/15"
          style={{ backgroundColor: color.hex, color: fg }}
        >
          <span className={genuiType.title}>Quarterly results</span>
          <span className={genuiType.body}>Revenue grew 12%.</span>
        </div>
        <div
          aria-hidden
          className="flex flex-col gap-1 rounded-[10px] border p-3"
          style={{ color: color.hex }}
        >
          <span className={genuiType.title}>Quarterly results</span>
          <span className={genuiType.body}>Revenue grew 12%.</span>
        </div>
      </figure>
    )
  }

  if (mode === "ui") {
    const bars = [
      { label: "North", value: 72, accent: false },
      { label: "South", value: 90, accent: true },
      { label: "West", value: 48, accent: false },
    ]
    return (
      <figure className="m-0">
        <figcaption className="sr-only">
          {`${color.name} on a button, a badge, a link and a chart bar.`}
        </figcaption>
        <div
          aria-hidden
          className="flex flex-col gap-4 rounded-[10px] border p-3 text-[13px]"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex h-9 items-center rounded-full px-3.5 font-medium"
              style={{ backgroundColor: color.hex, color: fg }}
            >
              Save changes
            </span>
            <span
              className="inline-flex h-6 items-center rounded-full border px-2.5 text-[13px] font-medium"
              style={{ borderColor: color.hex, color: color.hex }}
            >
              New
            </span>
            <span
              className="underline underline-offset-2"
              style={{ color: color.hex }}
            >
              View invoice
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {bars.map((b) => (
              <div key={b.label} className="flex items-center">
                <span
                  className={cn(
                    "h-3 rounded-sm",
                    !b.accent && "bg-muted dark:bg-white/15",
                  )}
                  style={{
                    width: `${b.value}%`,
                    backgroundColor: b.accent ? color.hex : undefined,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </figure>
    )
  }

  // Swatch: side by side with the current color, when there is one.
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <figcaption className="sr-only">
        {compare
          ? `${color.name} next to the current color ${compare.toUpperCase()}, ΔE ${formatDeltaE(deltaE(color.hex, compare))}.`
          : `${color.name} at a larger size.`}
      </figcaption>
      <div
        aria-hidden
        className="grid h-16 overflow-hidden rounded-lg border border-foreground/10 dark:border-foreground/15"
        style={{ gridTemplateColumns: compare ? "1fr 1fr" : "1fr" }}
      >
        {compare && <span style={{ backgroundColor: compare }} />}
        <span style={{ backgroundColor: color.hex }} />
      </div>
      {compare && (
        <div
          aria-hidden
          className={cn(genuiType.label, "grid grid-cols-2 gap-2")}
        >
          <span>Current</span>
          <span className="truncate">{color.name}</span>
        </div>
      )}
    </figure>
  )
}

const HSL_CHANNELS = [
  {
    key: "h",
    label: "Hue",
    max: 360,
    unit: "°",
    format: { style: "unit", unit: "degree" },
  },
  {
    key: "s",
    label: "Saturation",
    max: 100,
    unit: "%",
    format: { style: "unit", unit: "percent" },
  },
  {
    key: "l",
    label: "Lightness",
    max: 100,
    unit: "%",
    format: { style: "unit", unit: "percent" },
  },
] as const satisfies readonly {
  key: keyof Hsl
  label: string
  max: number
  unit: string
  format: Intl.NumberFormatOptions
}[]

export function ColorPicker({
  title,
  palette = [],
  selection = "single",
  max,
  allowCustom = false,
  preview = "swatch",
  compareAgainst,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: ColorPickerProps) {
  const [selected, setSelected] = React.useState<Picked[]>(() =>
    result?.action === "select"
      ? result.colors.map((c) => ({ ...c, key: pickedKey(c) }))
      : [],
  )
  const [decision, setDecision] = React.useState<
    "selected" | "cancelled" | null
  >(() =>
    result ? (result.action === "select" ? "selected" : "cancelled") : null,
  )
  const [query, setQuery] = React.useState("")
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<"swatch" | "custom">("swatch")
  const [custom, setCustom] = React.useState<{ hex: string; hsl: Hsl } | null>(
    null,
  )
  const [hexDraft, setHexDraft] = React.useState<string | null>(null)
  const optionRefs = React.useRef(new Map<string, HTMLElement>())
  const pendingFocus = React.useRef<string | null>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const listId = `${baseId}-list`
  const detailId = `${baseId}-detail`
  const customId = `${baseId}-custom`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: ColorPickerStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready" && status !== "streaming"
  const done = status === "selected" || status === "cancelled"
  const multiple = selection === "multiple"
  const heading = title ?? (streaming ? undefined : "Pick a color")

  const ready: Swatch[] = []
  palette.forEach((c, index) => {
    const hex = settledHex(c.hex, streaming)
    if (typeof c.id !== "string" || typeof c.name !== "string" || !hex) return
    ready.push({ ...c, id: c.id, name: c.name, hex, index })
  })
  const compare = settledHex(compareAgainst, streaming) ?? undefined

  const showSearch = ready.length > SEARCH_THRESHOLD
  const visible = showSearch
    ? ready.filter((s) => matchesColor(s, query))
    : ready
  const groups = groupBy(visible)
  // Keyboard order follows the rendered (grouped) order.
  const ordered = groups.flatMap(([, items]) => items)
  const active = ordered.find((s) => s.id === activeId) ?? ordered[0]

  const maxPicks = multiple ? max : 1
  const count = selected.length
  const atMax = multiple && maxPicks !== undefined && count >= maxPicks
  const canSubmit = !streaming && !locked && count >= 1
  const isSelected = (key: string) => selected.some((p) => p.key === key)
  const isDisabled = (id: string) => atMax && !isSelected(id)

  const customColor = custom ?? fromHex(compare ?? ready[0]?.hex ?? "#808080")
  const customKey = `custom:${customColor.hex}`
  const customClosest = nearestColors(customColor.hex, ready, 1)[0]
  const hexInvalid =
    hexDraft !== null && hexDraft.trim() !== "" && !isValidHex(hexDraft)

  // The color the detail panel and preview describe.
  const detailSwatch =
    ready.find((s) => s.id === activeId) ??
    ready.find((s) => isSelected(s.id)) ??
    ordered[0] ??
    ready[0]
  const shown: ShownColor | undefined =
    allowCustom && detail === "custom"
      ? { name: "Custom color", hex: customColor.hex }
      : detailSwatch

  // Focus an option that only exists after a render (e.g. after clearing search).
  React.useEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    optionRefs.current.get(id)?.focus()
  })

  const focusSwatch = (id: string) => {
    setActiveId(id)
    setDetail("swatch")
    const el = optionRefs.current.get(id)
    if (el) {
      el.focus()
    } else {
      setQuery("")
      pendingFocus.current = id
    }
  }

  const toggle = (s: Swatch) => {
    if (locked) return
    setActiveId(s.id)
    setDetail("swatch")
    const picked: Picked = {
      key: s.id,
      id: s.id,
      name: s.name,
      hex: s.hex,
      code: s.code,
    }
    setSelected((prev) => {
      if (!multiple) return [picked]
      if (prev.some((p) => p.key === s.id))
        return prev.filter((p) => p.key !== s.id)
      if (maxPicks !== undefined && prev.length >= maxPicks) return prev
      return [...prev, picked]
    })
  }

  const addCustom = () => {
    if (locked) return
    const picked: Picked = { key: customKey, hex: customColor.hex }
    setSelected((prev) => {
      if (!multiple) return [picked]
      if (prev.some((p) => p.key === customKey)) return prev
      if (maxPicks !== undefined && prev.length >= maxPicks) return prev
      return [...prev, picked]
    })
  }

  const remove = (key: string) => {
    if (locked) return
    setSelected((prev) => prev.filter((p) => p.key !== key))
  }

  const setChannel = (key: keyof Hsl, value: number) => {
    const hsl = { ...customColor.hsl, [key]: value }
    setCustom({ hsl, hex: hslToHex(hsl) })
    setHexDraft(null)
    setDetail("custom")
  }

  const onHexChange = (value: string) => {
    setHexDraft(value)
    setDetail("custom")
    const hex = normalizeHex(value)
    if (hex) setCustom(fromHex(hex))
  }

  /** Moves to the option in the next row up or down, nearest horizontally. */
  const moveVertical = (from: Swatch, dir: 1 | -1) => {
    const rectOf = (id: string) =>
      optionRefs.current.get(id)?.getBoundingClientRect()
    const here = rectOf(from.id)
    if (!here) return false
    const cx = here.left + here.width / 2
    const others = ordered
      .map((s) => ({ s, r: rectOf(s.id) }))
      .filter(
        (o): o is { s: Swatch; r: DOMRect } =>
          o.r !== undefined &&
          (dir === 1 ? o.r.top > here.top + 2 : o.r.top < here.top - 2),
      )
    if (!others.length) return false
    const rowTop =
      dir === 1
        ? Math.min(...others.map((o) => o.r.top))
        : Math.max(...others.map((o) => o.r.top))
    const row = others.filter((o) => Math.abs(o.r.top - rowTop) <= 2)
    const target = row.reduce((best, o) =>
      Math.abs(o.r.left + o.r.width / 2 - cx) <
      Math.abs(best.r.left + best.r.width / 2 - cx)
        ? o
        : best,
    )
    focusSwatch(target.s.id)
    return true
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (!ordered.length || !active || e.metaKey || e.ctrlKey || e.altKey) return
    const i = ordered.indexOf(active)
    const moveTo = (next: number) => {
      e.preventDefault()
      focusSwatch(ordered[Math.max(0, Math.min(ordered.length - 1, next))].id)
    }
    switch (e.key) {
      case "ArrowRight":
        return moveTo(i + 1)
      case "ArrowLeft":
        return moveTo(i - 1)
      case "ArrowDown":
        e.preventDefault()
        moveVertical(active, 1)
        return
      case "ArrowUp":
        e.preventDefault()
        if (!moveVertical(active, -1) && showSearch) searchRef.current?.focus()
        return
      case "Home":
        return moveTo(0)
      case "End":
        return moveTo(ordered.length - 1)
      case " ":
      case "Enter":
        e.preventDefault()
        if (!isDisabled(active.id)) toggle(active)
        return
    }
  }

  const submit = () => {
    if (!canSubmit) return
    setDecision("selected")
    onResult?.({
      action: "select",
      colors: selected.map(
        ({ key: _key, ...c }) =>
          Object.fromEntries(
            Object.entries(c).filter(([, v]) => v !== undefined),
          ) as PickedColor,
      ),
    })
  }

  const cancel = () => {
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  // Selected or cancelled: a compact record for the chat history.
  if (done) {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="color-picker"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader
            className={cn(
              "flex-row items-start justify-between gap-3",
              status === "selected" && selected.length > 0 ? "pb-3" : "pb-3",
            )}
          >
            <SurfaceTitle id={titleId}>{title ?? "Pick a color"}</SurfaceTitle>
            <p aria-live="polite" className="shrink-0 pt-0.5">
              {status === "selected" ? (
                <Badge variant="success">
                  <CheckIcon aria-hidden />
                  Selected
                  <span className="sr-only">
                    {" "}
                    {selected.length === 1
                      ? "1 color"
                      : `${selected.length} colors`}
                  </span>
                </Badge>
              ) : (
                <Badge variant="outline">
                  <XIcon aria-hidden />
                  Cancelled
                  <span className="sr-only">. No color was picked.</span>
                </Badge>
              )}
            </p>
          </SurfaceHeader>
          {status === "selected" && selected.length > 0 && (
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-3 border-t border-border px-3 py-3"
            >
              {selected.map((c) => (
                <li key={c.key} className="flex items-center gap-3">
                  <Chip hex={c.hex} className="size-10 rounded-md" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={cn(
                        genuiType.body,
                        "font-semibold break-words",
                      )}
                    >
                      {pickedLabel(c)}
                    </span>
                    <span className={cn(genuiType.meta, "font-mono")}>
                      {[c.code, c.hex.toUpperCase()]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </motion.ul>
          )}
        </Surface>
      </MotionConfig>
    )
  }

  const scrolls = showSearch
  const customSelected = isSelected(customKey)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="color-picker"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={cn("@container", className)}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{heading}</SurfaceTitle>
        </SurfaceHeader>

        {showSearch && (
          <div className="relative border-t border-border px-3 pt-3 pb-3">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-8.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              aria-label={`Search colors: ${heading ?? ""}`}
              aria-controls={listId}
              placeholder="Search by name or code"
              value={query}
              disabled={locked}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && ordered.length) {
                  e.preventDefault()
                  focusSwatch(ordered[0].id)
                }
              }}
              className="pl-10"
            />
            {/* Announces the result count as the user types. */}
            <p aria-live="polite" className="sr-only">
              {query.trim()
                ? `${visible.length} ${visible.length === 1 ? "color" : "colors"}`
                : ""}
            </p>
          </div>
        )}

        <AutoHeight>
          <ScrollFade
            className={cn(
              !showSearch && "border-t border-border",
              scrolls && "max-h-[28rem]",
            )}
            viewportClassName="overflow-y-auto"
          >
            <div
              id={listId}
              role="listbox"
              aria-labelledby={titleId}
              aria-multiselectable={multiple || undefined}
              aria-disabled={locked || undefined}
              onKeyDown={onListKeyDown}
              className={cn(
                "flex flex-col gap-3 px-3 pb-3",
                !showSearch && "pt-3",
              )}
            >
              {groups.map(([group, items]) => {
                const headingId = `${baseId}-group-${items[0].index}`
                const options = (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2">
                    {items.map((s) => {
                      const checked = isSelected(s.id)
                      const disabled = isDisabled(s.id)
                      const mark = readableTextOn(s.hex)
                      return (
                        <motion.div
                          key={s.id}
                          ref={(el: HTMLDivElement | null) => {
                            if (el) optionRefs.current.set(s.id, el)
                            else optionRefs.current.delete(s.id)
                          }}
                          role="option"
                          tabIndex={active?.id === s.id ? 0 : -1}
                          aria-selected={checked}
                          aria-disabled={disabled || locked || undefined}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={genuiMotion.fade}
                          onFocus={() => {
                            setActiveId(s.id)
                            setDetail("swatch")
                          }}
                          onClick={() => !disabled && toggle(s)}
                          className={cn(
                            "flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-transparent p-1.5 outline-none hover:bg-muted dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/50",
                            (disabled || locked) &&
                              "cursor-not-allowed opacity-50",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "relative block aspect-[3/2] w-full rounded-md border border-foreground/10 dark:border-foreground/15",
                              checked &&
                                "ring-2 ring-choice ring-offset-2 ring-offset-(--surface-bg)",
                            )}
                            style={{ backgroundColor: s.hex }}
                          >
                            {checked && (
                              <span
                                className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full"
                                style={{
                                  backgroundColor: mark,
                                  color: mark === BLACK ? WHITE : BLACK,
                                }}
                              >
                                <CheckIcon className="size-3.5" />
                              </span>
                            )}
                          </span>
                          <span className="line-clamp-2 px-0.5 text-[13px] font-medium break-words">
                            {s.name}
                            {s.code && (
                              <span className="sr-only">, {s.code}</span>
                            )}
                          </span>
                        </motion.div>
                      )
                    })}
                  </div>
                )
                if (!group)
                  return <React.Fragment key="_">{options}</React.Fragment>
                return (
                  // biome-ignore lint/a11y/useSemanticElements: ARIA listbox group; fieldset isn't allowed inside a listbox
                  <div
                    key={group}
                    role="group"
                    aria-labelledby={headingId}
                    className="flex flex-col gap-2"
                  >
                    <div
                      id={headingId}
                      role="presentation"
                      className={genuiType.label}
                    >
                      {group}
                    </div>
                    {options}
                  </div>
                )
              })}

              {showSearch && query.trim() && visible.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-3 text-center">
                  <p className={cn(genuiType.body, "text-muted-foreground")}>
                    No matches
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setQuery("")
                      searchRef.current?.focus()
                    }}
                  >
                    Clear search
                  </Button>
                </div>
              )}
            </div>
          </ScrollFade>

          {streaming && (
            <div
              aria-hidden
              className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2 px-3 pb-3"
            >
              {Array.from({ length: ready.length ? 2 : 8 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                <div key={i} className="flex flex-col gap-1.5 p-1.5">
                  <Skeleton className="aspect-square w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          )}
        </AutoHeight>

        {shown && (
          <section
            aria-labelledby={detailId}
            className="flex flex-col gap-3 border-t border-border px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h4 id={detailId} className={genuiType.title}>
                  {shown.name}
                </h4>
                {(shown.id ? shown.code || shown.group : true) && (
                  <p className={genuiType.meta}>
                    {shown.id
                      ? [shown.code, shown.group].filter(Boolean).join(" · ")
                      : "Not in the palette"}
                  </p>
                )}
              </div>
              <CopyHex key={shown.hex} hex={shown.hex} />
            </div>
            <Preview mode={preview} color={shown} compare={compare} />
            <ContrastList hex={shown.hex} compare={compare} />
          </section>
        )}

        {allowCustom && (
          <section
            aria-labelledby={customId}
            className="flex flex-col gap-3 border-t border-border px-3 py-3"
          >
            <SectionHeading id={customId}>Custom color</SectionHeading>
            <div className="flex items-start gap-4">
              <Chip hex={customColor.hex} className="size-16 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="grid gap-3 @md:grid-cols-3 @md:gap-4">
                  {HSL_CHANNELS.map((c) => {
                    const labelId = `${baseId}-custom-${c.key}`
                    return (
                      <div key={c.key} className="flex flex-col gap-2">
                        <span id={labelId} className={genuiType.label}>
                          {c.label}
                        </span>
                        <div className="flex items-center gap-3">
                          <Slider
                            aria-labelledby={labelId}
                            value={[customColor.hsl[c.key]]}
                            min={0}
                            max={c.max}
                            step={1}
                            format={c.format}
                            disabled={locked}
                            onValueChange={(v) =>
                              setChannel(c.key, Array.isArray(v) ? v[0] : v)
                            }
                            className="flex-1 py-1.5"
                          />
                          <span
                            aria-hidden
                            className={cn(
                              genuiType.value,
                              "inline-flex min-w-9 shrink-0 justify-end",
                            )}
                          >
                            <SlidingNumber
                              number={customColor.hsl[c.key]}
                              initiallyStable
                            />
                            {c.unit}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`${customId}-hex`}
                      className={cn(genuiType.label, "w-9")}
                    >
                      Hex
                    </label>
                    <Input
                      id={`${customId}-hex`}
                      value={hexDraft ?? customColor.hex.toUpperCase()}
                      disabled={locked}
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={hexInvalid || undefined}
                      aria-describedby={
                        hexInvalid ? `${customId}-hex-error` : undefined
                      }
                      onChange={(e) => onHexChange(e.target.value)}
                      onBlur={() => {
                        if (hexDraft !== null && isValidHex(hexDraft))
                          setHexDraft(null)
                      }}
                      className="w-28 font-mono"
                    />
                  </div>
                  {hexInvalid && (
                    <p
                      id={`${customId}-hex-error`}
                      className="text-[13px] text-destructive"
                    >
                      Enter a hex color like #3A6EA5.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={genuiType.meta} aria-live="polite">
                {customClosest && (
                  <>
                    Closest:{" "}
                    <button
                      type="button"
                      onClick={() => focusSwatch(customClosest.id)}
                      className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {customClosest.name}
                    </button>
                    <span className="sr-only">
                      , ΔE {formatDeltaE(customClosest.deltaE)}
                    </span>
                  </>
                )}
              </p>
              <WhyDisabled
                when={hexInvalid || customSelected || (atMax && multiple)}
                reason={
                  hexInvalid
                    ? "Enter a valid hex code"
                    : customSelected
                      ? "Already added"
                      : "Limit reached"
                }
              >
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={addCustom}
                  disabled={
                    locked ||
                    hexInvalid ||
                    customSelected ||
                    (atMax && multiple)
                  }
                >
                  {customSelected && <CheckIcon aria-hidden />}
                  {customSelected
                    ? "Custom color added"
                    : multiple
                      ? "Add custom color"
                      : "Use custom color"}
                </Button>
              </WhyDisabled>
            </div>
          </section>
        )}

        <SurfaceFooter className="flex-col items-stretch gap-3">
          {selected.length > 0 && (
            <ul aria-label="Selected colors" className="flex flex-wrap gap-2">
              {selected.map((p) => (
                <motion.li
                  key={p.key}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-transparent pr-1 pl-2.5 text-[13px]"
                >
                  <Chip hex={p.hex} className="size-4 rounded-full" />
                  {pickedLabel(p)}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Remove ${pickedLabel(p)}`}
                          disabled={locked}
                          onClick={() => remove(p.key)}
                          className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                        />
                      }
                    >
                      <XIcon aria-hidden className="size-3" />
                    </TooltipTrigger>
                    <TooltipContent>{`Remove ${pickedLabel(p)}`}</TooltipContent>
                  </Tooltip>
                </motion.li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              aria-live="polite"
              className={cn(genuiType.meta, "tabular-nums")}
            >
              {streaming ? (
                <ShimmeringText
                  text="Loading colors…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "submitting" ? (
                "Saving…"
              ) : multiple && maxPicks !== undefined ? (
                `${count} of ${maxPicks} selected`
              ) : count === 0 ? null : (
                <span className="sr-only">{count} selected</span>
              )}
            </p>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={cancel}
                disabled={locked}
              >
                Cancel
              </Button>
              <WhyDisabled
                when={!canSubmit && status !== "submitting" && !locked}
                reason="Pick a color first"
              >
                <Button size="sm" onClick={submit} disabled={!canSubmit}>
                  {status === "submitting"
                    ? "Saving…"
                    : (submitLabel ??
                      (multiple ? "Use these colors" : "Use this color"))}
                </Button>
              </WhyDisabled>
            </div>
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

function fromHex(hex: string): { hex: string; hsl: Hsl } {
  return { hex, hsl: hexToHsl(hex) ?? { h: 0, s: 0, l: 50 } }
}
