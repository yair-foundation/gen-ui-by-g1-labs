"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import {
  CheckIcon,
  LayoutGridIcon,
  ListIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { RadioMark, RollingDigits } from "@/components/genui/genui-motion"
import { ScrollFade } from "@/components/genui/scroll-fade"

import type {
  SearchFacet,
  SearchResultItem,
  SearchResultsInput,
  SearchResultsResult,
  SearchSortOption,
} from "./search-results.schema"
import {
  type FacetDef,
  type FacetOption,
  type FilterState,
  activeFilterCount,
  countText,
  effectiveRange,
  facetOptions,
  filterChips,
  filterResults,
  formatFacetNumber,
  matchText,
  parseHighlights,
  rangeBounds,
  rangeStep,
  removeChip,
  sortResults,
  toRangeFilter,
  toSearchFilters,
  toggleCount,
} from "./search-results-utils"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { Segmented } from "@/components/genui/segmented"

export type SearchResultsStatus = "streaming" | "ready" | "selected"

type PartialResult = Partial<SearchResultItem>
type ReadyResult = PartialResult & { id: string; title: string }
type ReadySort = SearchSortOption
type SelectMode = "none" | "single" | "multiple"

export type SearchResultsProps = Partial<
  Omit<SearchResultsInput, "results" | "facets" | "sort">
> & {
  /** Results, facets and sort options may be partial while streaming. */
  results?: PartialResult[]
  facets?: Partial<SearchFacet>[]
  sort?: Partial<SearchSortOption>[]
  /**
   * Lifecycle, controlled by the host. When omitted, the component tracks the
   * user's selection itself.
   */
  status?: SearchResultsStatus
  /**
   * Called with 'search', 'load-more', 'open', 'dismiss' or 'select'. Only
   * 'select' locks the component. After 'load-more', pass the same component
   * the longer `results`; "Loading…" shows until they arrive.
   */
  onResult?: (result: SearchResultsResult) => void
  /**
   * A result from history. 'select' restores the read-only record; the other
   * actions show what was asked. Never calls onResult.
   */
  result?: SearchResultsResult
  className?: string
}

const FACET_TYPES = new Set(["checkbox", "range", "toggle"])
/** Stable keys for loading placeholders. */
const PLACEHOLDERS = ["a", "b", "c"]

function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

function resultNote(
  result: SearchResultsResult | undefined,
  items: ReadyResult[],
) {
  switch (result?.action) {
    case "search":
      return `Searched again for “${result.query}”`
    case "load-more":
      return "Asked for more results"
    case "open":
      return `Asked to open “${items.find((r) => r.id === result.id)?.title ?? result.id}”`
    case "dismiss":
      return "None of these fit"
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Result parts

function ResultTitle({
  item,
  onOpen,
}: {
  item: ReadyResult
  /** Asks the agent to open the record. Only used when there's no url. */
  onOpen?: () => void
}) {
  const href = safeUrl(item.url)
  const linkClass =
    "inline-block rounded-sm py-0.5 text-left text-[13px] font-semibold break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={linkClass}
      >
        {item.title}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  }
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={linkClass}>
        {item.title}
      </button>
    )
  }
  return (
    <span className="py-0.5 text-[13px] font-semibold break-words">
      {item.title}
    </span>
  )
}

function Snippet({ text }: { text: string }) {
  // Offsets make stable keys: the parts never reorder.
  let offset = 0
  const parts = parseHighlights(text).map((part) => {
    const key = offset
    offset += part.text.length + (part.match ? 4 : 0)
    return part.match ? (
      <mark key={key} className="bg-transparent font-medium text-foreground">
        {part.text}
      </mark>
    ) : (
      <React.Fragment key={key}>{part.text}</React.Fragment>
    )
  })
  return (
    <p className="text-[13px] break-words text-muted-foreground">{parts}</p>
  )
}

function Meta({ meta, grid }: { meta: PartialResult["meta"]; grid?: boolean }) {
  const pairs = (meta ?? []).filter(
    (m) => typeof m?.label === "string" && typeof m?.value === "string",
  )
  if (pairs.length === 0) return null
  return (
    <dl
      className={cn(
        "text-[13px] leading-4",
        grid
          ? "grid grid-cols-2 gap-x-8 gap-y-1"
          : "flex flex-wrap gap-x-8 gap-y-1",
      )}
    >
      {pairs.map((m) => (
        <div key={m.label} className="flex min-w-0 gap-1">
          <dt className="shrink-0 text-muted-foreground">{m.label}</dt>
          <dd className="truncate tabular-nums">{m.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** http(s) or a same-origin path with a single leading "/"; else null. */
function safeImageSrc(src?: string) {
  const value = src?.trim()
  if (value && /^\/(?![/\\])/.test(value)) return value
  return safeUrl(value)
}

function ResultImage({
  image,
  className,
}: {
  image: PartialResult["image"]
  className?: string
}) {
  const src = safeImageSrc(image?.src)
  const [failed, setFailed] = React.useState<string | null>(null)
  if (!src || failed === src) {
    return (
      <span
        aria-hidden
        className={cn(
          "block border border-border bg-transparent",
          className,
        )}
      />
    )
  }
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={image?.alt ?? ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn("bg-transparent object-cover", className)}
    />
  )
}

function SelectControl({
  mode,
  name,
  title,
  checked,
  disabled,
  onChange,
}: {
  mode: SelectMode
  name: string
  title: string
  checked: boolean
  disabled: boolean
  onChange: (on: boolean) => void
}) {
  if (mode === "multiple") {
    return (
      <Checkbox
        nativeButton
        size="sm"
        aria-label={`Select ${title}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(on) => onChange(Boolean(on))}
        // Larger tap area than the 18px box, without changing its look.
        className="relative mt-1 shrink-0 after:absolute after:-inset-2"
      />
    )
  }
  return (
    // A 24px tap target: an sr-only native radio and its visible mark.
    <label className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
      <input
        type="radio"
        name={name}
        aria-label={`Select ${title}`}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(true)}
        className="sr-only"
      />
      <RadioMark checked={checked} />
    </label>
  )
}

// ---------------------------------------------------------------------------
// Filters

function CheckboxFacet({
  facet,
  options,
  value,
  onChange,
}: {
  facet: FacetDef
  options: FacetOption[]
  value: string[]
  onChange: (value: string[]) => void
}) {
  if (options.length === 0) return null
  return (
    <Select
      multiple
      value={value}
      onValueChange={(v) => onChange(Array.isArray(v) ? v : [])}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Filter by ${facet.label}${value.length ? `, ${value.length} selected` : ""}`}
      >
        {facet.label}
        {value.length > 0 && (
          <span className="tabular-nums text-muted-foreground">
            · {value.length}
          </span>
        )}
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="min-w-44"
      >
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className="flex-1">{o.label}</span>
            <span
              className={cn(
                "text-[13px] leading-4 tabular-nums text-muted-foreground",
                o.count === 0 && "opacity-60",
              )}
            >
              {o.count}
              <span className="sr-only"> results</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RangeFacet({
  facet,
  bounds,
  value,
  onChange,
}: {
  facet: FacetDef
  bounds: { min: number; max: number }
  value: FilterState[string] | undefined
  onChange: (value: FilterState[string]) => void
}) {
  const locale = useGenUILocale()
  const labelId = React.useId()
  const [lo, hi] = effectiveRange(value, bounds)
  const integer = Number.isInteger(bounds.min) && Number.isInteger(bounds.max)
  const step = rangeStep(bounds.min, bounds.max, integer)
  return (
    <div className="flex w-full flex-col gap-0.5 sm:w-56">
      {/* Label above, slider with its range to the right (Halaska UI layout). */}
      <span id={labelId} className={cn(genuiType.label, "leading-4")}>
        {facet.label}
      </span>
      <div className="flex items-center gap-3">
        <SliderPrimitive.Root
          className="min-w-0 flex-1"
          aria-labelledby={labelId}
          value={[lo, hi]}
          min={bounds.min}
          max={bounds.max}
          step={step}
          thumbAlignment="edge"
          onValueChange={(v) => {
            if (Array.isArray(v) && v.length === 2) {
              onChange(toRangeFilter([v[0], v[1]], bounds, step / 2))
            }
          }}
        >
          <SliderPrimitive.Control className="relative flex h-6 w-full touch-none items-center select-none data-disabled:opacity-50">
            <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
              <SliderPrimitive.Indicator className="h-full bg-choice" />
            </SliderPrimitive.Track>
            {[0, 1].map((i) => (
              <SliderPrimitive.Thumb
                key={i}
                index={i}
                getAriaLabel={() =>
                  `${i === 0 ? "Minimum" : "Maximum"} ${facet.label.toLowerCase()}`
                }
                getAriaValueText={(_, n) => formatFacetNumber(n, facet, locale)}
                // 16px thumb with a 32px tap area.
                className="relative block h-6 w-3 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
              />
            ))}
          </SliderPrimitive.Control>
        </SliderPrimitive.Root>
        <span
          className={cn(
            genuiType.value,
            "h-6 shrink-0 leading-6 whitespace-nowrap",
          )}
        >
          <span className="sr-only">
            {formatFacetNumber(lo, facet, locale)} – {formatFacetNumber(hi, facet, locale)}
          </span>
          <span aria-hidden className="inline-flex items-baseline">
            <RollingDigits text={formatFacetNumber(lo, facet, locale)} />
            <span className="px-1">–</span>
            <RollingDigits text={formatFacetNumber(hi, facet, locale)} />
          </span>
        </span>
      </div>
    </div>
  )
}

function ToggleFacet({
  facet,
  count,
  checked,
  onChange,
}: {
  facet: FacetDef
  count: number
  checked: boolean
  onChange: (on: boolean) => void
}) {
  const id = React.useId()
  return (
    <div className="flex items-center gap-2">
      <Switch
        nativeButton
        id={id}
        aria-labelledby={`${id}-label`}
        checked={checked}
        onCheckedChange={(on) => onChange(Boolean(on))}
        className="after:absolute after:-inset-1"
      />
      <label id={`${id}-label`} htmlFor={id} className="text-[13px]">
        {facet.label}{" "}
        <span className="text-[13px] leading-4 tabular-nums text-muted-foreground">
          <span aria-hidden>{count}</span>
          <span className="sr-only">
            ({plural(count, "result", "results")})
          </span>
        </span>
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** The results scroll inside the card so a long page never grows it. */
function ResultsRegion({ children }: { children: React.ReactNode }) {
  return (
    <ScrollFade
      label="Results"
      className="max-h-[20rem]"
      viewportClassName="overflow-y-auto"
    >
      {children}
    </ScrollFade>
  )
}

export function SearchResults({
  query,
  title,
  total,
  results = [],
  facets = [],
  sort = [],
  view: viewProp = "list",
  hasMore = false,
  selectable = "none",
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: SearchResultsProps) {
  const locale = useGenUILocale()
  const [filters, setFilters] = React.useState<FilterState>({})
  const [sortId, setSortId] = React.useState<string | null>(null)
  const [viewEdit, setViewEdit] = React.useState<"list" | "grid" | null>(null)
  const [selected, setSelected] = React.useState<string[]>([])
  const [decision, setDecision] = React.useState<"selected" | null>(null)
  // Requests waiting for new props: they end when the props change.
  const [pending, setPending] = React.useState<{
    snapshot: string
    note: string
    loading: boolean
  } | null>(null)

  // The search box follows `query` until the user edits it.
  const [draft, setDraft] = React.useState<string | null>(null)
  const [draftFor, setDraftFor] = React.useState(query)
  if (draftFor !== query) {
    setDraftFor(query)
    setDraft(null)
  }

  const baseId = React.useId()
  const titleId = `${baseId}-title`

  // A selection from history wins, even if it arrives after mount.
  const restored = result?.action === "select" ? result.ids : null
  const decided = decision ?? (restored ? "selected" : null)

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: SearchResultsStatus =
    decided && (statusProp === undefined || statusProp === "ready")
      ? decided
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  // Live only: a result from history never sends anything.
  const canSend = status === "ready" && result === undefined
  const mode: SelectMode = selectable ?? "none"

  const ready = results.filter(
    (r): r is ReadyResult =>
      typeof r?.id === "string" && typeof r.title === "string",
  )
  const facetDefs = facets.filter(
    (f): f is FacetDef =>
      typeof f?.id === "string" &&
      typeof f.label === "string" &&
      FACET_TYPES.has(f.type ?? ""),
  )
  const sorts = sort.filter(
    (s): s is ReadySort =>
      typeof s?.id === "string" &&
      typeof s.label === "string" &&
      typeof s.key === "string" &&
      (s.direction === "asc" || s.direction === "desc"),
  )
  const activeSort = sorts.find((s) => s.id === sortId) ?? sorts[0]
  const view = viewEdit ?? viewProp

  const filtered = filterResults(ready, facetDefs, filters)
  const visible = sortResults(filtered, activeSort, locale)
  const filtersOn = activeFilterCount(facetDefs, filters) > 0
  const chips = filterChips(facetDefs, filters, locale)

  // Anything that means new props arrived ends a pending request.
  const snapshot = [
    statusProp,
    query,
    ready.length,
    ready[0]?.id,
    ready.at(-1)?.id,
    hasMore,
    total,
  ].join("\u0000")
  const waiting = pending?.snapshot === snapshot ? pending : null
  const loadingMore = Boolean(waiting?.loading)

  const heading = title ?? (query ? `Results for “${query}”` : undefined)
  const searchValue = draft ?? query ?? ""
  const edited = draft !== null && draft.trim() !== (query ?? "").trim()

  const setFilter = (id: string, value: FilterState[string] | undefined) =>
    setFilters((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[id]
      else next[id] = value
      return next
    })
  const clearFilters = () => setFilters({})

  const submitSearch = () => {
    const q = searchValue.trim()
    if (!canSend || !q) return
    setPending({ snapshot, note: `New search sent: “${q}”`, loading: false })
    onResult?.({
      action: "search",
      query: q,
      filters: toSearchFilters(facetDefs, filters),
    })
  }

  const loadMore = () => {
    if (!canSend || loadingMore) return
    setPending({ snapshot, note: "", loading: true })
    onResult?.({
      action: "load-more",
      query: query ?? "",
      filters: toSearchFilters(facetDefs, filters),
      offset: ready.length,
    })
  }

  const open = (item: ReadyResult) => {
    if (!canSend) return
    setPending({
      snapshot,
      note: `Asked to open “${item.title}”`,
      loading: false,
    })
    onResult?.({ action: "open", id: item.id })
  }

  const dismiss = () => {
    if (!canSend) return
    setPending({
      snapshot,
      note: "Told the agent none of these fit",
      loading: false,
    })
    onResult?.({ action: "dismiss" })
  }

  const toggleSelected = (id: string, on: boolean) =>
    setSelected((prev) =>
      mode === "single"
        ? on
          ? [id]
          : []
        : on
          ? prev.includes(id)
            ? prev
            : [...prev, id]
          : prev.filter((x) => x !== id),
    )

  const submit = () => {
    if (!canSend || selected.length === 0) return
    // Result order first, then anything no longer in the results.
    const inList = ready.filter((r) => selected.includes(r.id)).map((r) => r.id)
    const ids = [...inList, ...selected.filter((id) => !inList.includes(id))]
    setDecision("selected")
    onResult?.({ action: "select", ids })
  }

  // Selected: a read-only record for the chat history.
  if (status === "selected") {
    const chosen = (restored ?? selected).map(
      (id): ReadyResult => ready.find((r) => r.id === id) ?? { id, title: id },
    )
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="search-results"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader className="pb-3">
            <SurfaceTitle id={titleId}>{heading}</SurfaceTitle>
          </SurfaceHeader>
          {chosen.length > 0 && (
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-1 border-t border-border px-3 py-3"
            >
              {chosen.map((r) => (
                <li key={r.id} className="flex items-start gap-2.5">
                  <CheckIcon
                    aria-hidden
                    className="mt-1 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <ResultTitle item={r} />
                  </div>
                </li>
              ))}
            </motion.ul>
          )}
          <SurfaceFooter aria-live="polite">
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4" />
              {submitLabel
                ? `${submitLabel}: ${plural(chosen.length, "result", "results")}`
                : `Selected ${plural(chosen.length, "result", "results")}`}
            </p>
          </SurfaceFooter>
        </Surface>
      </MotionConfig>
    )
  }

  const gridImages = ready.some((r) => safeImageSrc(r.image?.src))
  const radioName = `${baseId}-pick`
  const selectedHidden = selected.filter(
    (id) => !visible.some((r) => r.id === id),
  ).length
  const note = waiting?.note || resultNote(result, ready)
  const selectionText =
    mode === "none" || selected.length === 0
      ? null
      : `${selected.length} selected${
          selectedHidden ? ` · ${selectedHidden} hidden by filters` : ""
        }`
  const footerText = [selectionText, note].filter(Boolean).join(" · ")
  const showFooter = mode !== "none" || streaming || Boolean(note)

  const renderSelect = (r: ReadyResult) =>
    mode !== "none" && (
      <SelectControl
        mode={mode}
        name={radioName}
        title={r.title}
        checked={selected.includes(r.id)}
        disabled={!canSend}
        onChange={(on) => toggleSelected(r.id, on)}
      />
    )
  const openHandler = (r: ReadyResult) =>
    !safeUrl(r.url) && canSend ? () => open(r) : undefined

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="search-results"
        data-status={status}
        aria-busy={streaming || loadingMore}
        aria-labelledby={titleId}
        className={className}
      >
        <SurfaceHeader className="gap-2 pb-3">
          <SurfaceTitle id={titleId}>{heading}</SurfaceTitle>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submitSearch()
            }}
          >
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label="Search query"
                value={searchValue}
                disabled={result !== undefined}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && draft !== null) {
                    e.preventDefault()
                    setDraft(null)
                  }
                }}
                className="pl-8"
              />
            </div>
            {edited && (
              <WhyDisabled
                when={!canSend || !searchValue.trim()}
                reason="Type a query first"
              >
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSend || !searchValue.trim()}
                >
                  Search
                </Button>
              </WhyDisabled>
            )}
          </form>
          {/* Only the total adds something; the list shows what's loaded. */}
          {typeof total === "number" && total > ready.length && (
            <p className={cn(genuiType.meta, "tabular-nums")}>
              {countText(ready.length, total, locale)}
            </p>
          )}
          {/* Announces the match count as filters change. */}
          <p aria-live="polite" className="sr-only">
            {filtersOn ? matchText(filtered.length, locale) : ""}
          </p>
        </SurfaceHeader>

        {ready.length > 0 && (
          <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 border-t border-border px-3 py-3">
            <legend className="sr-only">Filter and sort</legend>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
              {facetDefs.map((f) => {
                if (f.type === "checkbox") {
                  const v = filters[f.id]
                  return (
                    <CheckboxFacet
                      key={f.id}
                      facet={f}
                      options={facetOptions(ready, f, facetDefs, filters, locale)}
                      value={Array.isArray(v) ? v : []}
                      onChange={(next) =>
                        setFilter(f.id, next.length ? next : undefined)
                      }
                    />
                  )
                }
                if (f.type === "range") {
                  const bounds = rangeBounds(ready, f.id)
                  if (!bounds) return null
                  return (
                    <RangeFacet
                      key={f.id}
                      facet={f}
                      bounds={bounds}
                      value={filters[f.id]}
                      onChange={(next) => setFilter(f.id, next)}
                    />
                  )
                }
                return (
                  <ToggleFacet
                    key={f.id}
                    facet={f}
                    count={toggleCount(ready, f, facetDefs, filters)}
                    checked={filters[f.id] === true}
                    onChange={(on) => setFilter(f.id, on || undefined)}
                  />
                )
              })}
              <div className="ml-auto flex items-center gap-2">
                {sorts.length > 1 && activeSort && (
                  <Select
                    value={activeSort.id}
                    onValueChange={(v) => typeof v === "string" && setSortId(v)}
                    items={sorts.map((s) => ({ value: s.id, label: s.label }))}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={`Sort: ${activeSort.label}`}
                    >
                      <span className="text-muted-foreground">Sort:</span>
                      {activeSort.label}
                    </SelectTrigger>
                    <SelectContent align="end" alignItemWithTrigger={false}>
                      {sorts.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Segmented
                  label="View"
                  value={view}
                  onChange={setViewEdit}
                  fit
                  options={[
                    { value: "list", label: <ListIcon aria-hidden />, ariaLabel: "List view", tip: "List view" },
                    { value: "grid", label: <LayoutGridIcon aria-hidden />, ariaLabel: "Grid view", tip: "Grid view" },
                  ]}
                />
              </div>
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {chips.map((chip) => (
                  <Button
                    key={chip.key}
                    size="xs"
                    variant="secondary"
                    aria-label={`Remove filter ${chip.label}`}
                    className="h-8 gap-1.5 px-3.5 text-[13px]"
                    onClick={() => setFilters((prev) => removeChip(prev, chip))}
                  >
                    {chip.label}
                    <XIcon aria-hidden />
                  </Button>
                ))}
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={clearFilters}
                  className="h-8 px-3.5 text-[13px]"
                >
                  Clear all
                </Button>
              </div>
            )}
          </fieldset>
        )}

        <AutoHeight>
          {ready.length > 0 && visible.length === 0 ? (
            <div className="flex flex-col items-start gap-2 border-t border-border px-3 py-6">
              <p className={cn(genuiType.body, "text-muted-foreground")}>
                No matches
              </p>
              <Button
                size="sm"
                variant={mode === "none" ? "default" : "secondary"}
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            </div>
          ) : ready.length === 0 && !streaming ? (
            <p
              className={cn(
                genuiType.body,
                "border-t border-border px-3 py-6 text-muted-foreground",
              )}
            >
              No results
            </p>
          ) : view === "grid" ? (
            <ResultsRegion>
              <ul className="grid gap-2 border-t border-border px-3 py-3 sm:grid-cols-2">
                {visible.map((r) => {
                  const checked = selected.includes(r.id)
                  return (
                    <motion.li
                      key={r.id}
                      data-slot="search-result"
                      data-selected={checked || undefined}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className={cn(
                        "flex min-w-0 flex-col gap-3 rounded-[10px] border border-border bg-transparent p-3 transition-colors",
                        checked &&
                          "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                      )}
                    >
                      {gridImages && (
                        <ResultImage
                          image={r.image}
                          className="aspect-[4/3] w-full rounded-lg"
                        />
                      )}
                      <div className="flex items-start gap-2.5">
                        {renderSelect(r)}
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-col">
                            <ResultTitle item={r} onOpen={openHandler(r)} />
                            {r.subtitle && (
                              <p className={genuiType.meta}>{r.subtitle}</p>
                            )}
                          </div>
                          {r.snippet && <Snippet text={r.snippet} />}
                          <Meta meta={r.meta} grid />
                        </div>
                      </div>
                    </motion.li>
                  )
                })}
                {streaming &&
                  PLACEHOLDERS.slice(0, ready.length ? 1 : 2).map((k) => (
                    <li
                      key={k}
                      aria-hidden
                      className="flex flex-col gap-2 rounded-[10px] border border-border bg-transparent p-3"
                    >
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                    </li>
                  ))}
              </ul>
            </ResultsRegion>
          ) : (
            <ResultsRegion>
              <ul className="flex flex-col gap-1 border-t border-border p-2">
                {visible.map((r) => {
                  const checked = selected.includes(r.id)
                  const img = safeImageSrc(r.image?.src)
                  return (
                    <motion.li
                      key={r.id}
                      data-slot="search-result"
                      data-selected={checked || undefined}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className={cn(
                        "flex gap-3 rounded-[10px] px-3 py-3 transition-colors",
                        checked && "bg-accent",
                      )}
                    >
                      {renderSelect(r)}
                      {img && (
                        <ResultImage
                          image={r.image}
                          className="size-16 shrink-0 rounded-lg"
                        />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-col">
                          <ResultTitle item={r} onOpen={openHandler(r)} />
                          {r.subtitle && (
                            <p className={genuiType.meta}>{r.subtitle}</p>
                          )}
                        </div>
                        {r.snippet && <Snippet text={r.snippet} />}
                        <Meta meta={r.meta} />
                      </div>
                    </motion.li>
                  )
                })}
                {streaming &&
                  PLACEHOLDERS.slice(0, ready.length ? 1 : 3).map((k) => (
                    <li
                      key={k}
                      aria-hidden
                      className="flex flex-col gap-2 px-3 py-3"
                    >
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                    </li>
                  ))}
              </ul>
            </ResultsRegion>
          )}

          {hasMore && ready.length > 0 && (
            <div className="flex justify-center border-t border-border px-3 py-3">
              <WhyDisabled when={!canSend || loadingMore} reason="Loading…">
                <Button
                  size="sm"
                  variant={mode === "none" ? "default" : "secondary"}
                  disabled={!canSend || loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? (
                    <ShimmeringText
                      text="Loading…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : (
                    "Load more"
                  )}
                </Button>
              </WhyDisabled>
            </div>
          )}
        </AutoHeight>

        {showFooter && (
          <SurfaceFooter className="justify-between gap-3">
            <p aria-live="polite" className={genuiType.meta}>
              {streaming ? (
                <ShimmeringText
                  text="Loading results…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : (
                footerText
              )}
            </p>
            {mode !== "none" && (
              <div className="ml-auto flex gap-2">
                <WhyDisabled when={!canSend} reason="Not available right now">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canSend}
                    onClick={dismiss}
                  >
                    None of these
                  </Button>
                </WhyDisabled>
                <WhyDisabled
                  when={!canSend || selected.length === 0}
                  reason="Select at least one result"
                >
                  <Button
                    size="sm"
                    disabled={!canSend || selected.length === 0}
                    onClick={submit}
                  >
                    {submitLabel ?? "Select"}
                  </Button>
                </WhyDisabled>
              </div>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
