"use client"

import * as React from "react"
import { CheckIcon, SearchIcon, XIcon } from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"
import { Input } from "@/components/ui/input"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { CheckMark, RadioMark } from "@/components/genui/genui-motion"

import {
  type EntityPickerInput,
  type EntityPickerResult,
  type PickerEntity,
  matchesEntity,
} from "./entity-picker.schema"

export type EntityPickerStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "selected"
  | "cancelled"

type ReadyEntity = PickerEntity & { index: number }

export type EntityPickerProps = Partial<Omit<EntityPickerInput, "entities">> & {
  /** Entities may be partial while the tool call is still streaming. */
  entities?: Partial<PickerEntity>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: EntityPickerStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: EntityPickerResult) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Renders the
   * chosen records and never calls onResult.
   */
  result?: EntityPickerResult
  className?: string
}

/** Rows shown before the list scrolls inside the card. */
const MAX_VISIBLE_ROWS = 8

/** Selection marks (Halaska UI): a radio dot, or a filled box with a drawn check. */
function Indicator({ checked, multi }: { checked: boolean; multi: boolean }) {
  if (!multi) return <RadioMark checked={checked} className="size-5" />
  return (
    <span
      aria-hidden
      data-checked={checked || undefined}
      className="flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-border bg-transparent text-background transition-colors duration-200 data-checked:bg-choice dark:data-checked:border-transparent dark:data-checked:bg-choice"
    >
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            key="indicator"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={genuiMotion.snappy}
            className="flex"
          >
            <CheckMark className="size-3" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

function EntityText({ entity }: { entity: Partial<PickerEntity> }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(genuiType.body, "font-medium break-words")}>
          {entity.label}
        </span>
        {entity.description && (
          <span className={cn(genuiType.meta, "break-words")}>
            {entity.description}
          </span>
        )}
      </span>
      {entity.meta && (
        <span className={cn(genuiType.body, "shrink-0 tabular-nums")}>
          {entity.meta}
        </span>
      )}
    </>
  )
}

function groupBy(entities: ReadyEntity[]) {
  const map = new Map<string, ReadyEntity[]>()
  for (const e of entities) {
    const key = e.group ?? ""
    map.set(key, [...(map.get(key) ?? []), e])
  }
  return [...map.entries()]
}

export function EntityPicker({
  title,
  description,
  entities = [],
  multiple = false,
  min,
  max,
  searchable,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: EntityPickerProps) {
  const [selected, setSelected] = React.useState<string[]>(() =>
    result?.action === "select" ? result.ids : [],
  )
  const [decision, setDecision] = React.useState<
    "selected" | "cancelled" | null
  >(() =>
    result ? (result.action === "select" ? "selected" : "cancelled") : null,
  )
  const [query, setQuery] = React.useState("")
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const listId = `${baseId}-list`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: EntityPickerStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready" && status !== "streaming"
  const done = status === "selected" || status === "cancelled"

  const ready = entities
    .map((e, index) => ({ ...e, index }))
    .filter(
      (e): e is ReadyEntity =>
        typeof e.id === "string" && typeof e.label === "string",
    )
  const showSearch = searchable ?? ready.length > 6
  const visible = showSearch
    ? ready.filter((e) => matchesEntity(e, query))
    : ready
  const groups = groupBy(visible)
  // Keyboard order follows the rendered (grouped) order.
  const ordered = groups.flatMap(([, items]) => items)
  const active =
    ordered.find((e) => e.id === activeId) ??
    (ordered[0] as ReadyEntity | undefined)

  const minPicks = min ?? 1
  const maxPicks = multiple ? max : 1
  const count = selected.length
  const atMax = maxPicks !== undefined && count >= maxPicks
  const canSubmit =
    !streaming &&
    !locked &&
    count >= Math.max(minPicks, 1) &&
    (maxPicks === undefined || count <= maxPicks)

  const optionId = (e: ReadyEntity) => `${baseId}-option-${e.index}`
  const isSelected = (id: string) => selected.includes(id)
  const isDisabled = (id: string) => multiple && atMax && !isSelected(id)

  // Keep the active option in view while moving with the keyboard.
  const activeIndex = active?.index
  React.useEffect(() => {
    if (activeIndex === undefined) return
    if (document.activeElement !== listRef.current) return
    document
      .getElementById(`${baseId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, baseId])

  const toggle = (id: string) => {
    if (locked) return
    setActiveId(id)
    setSelected((prev) => {
      if (!multiple) return [id]
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (maxPicks !== undefined && prev.length >= maxPicks) return prev
      return [...prev, id]
    })
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (!ordered.length || e.metaKey || e.ctrlKey || e.altKey) return
    const i = active ? ordered.indexOf(active) : 0
    const moveTo = (next: number) => {
      e.preventDefault()
      const clamped = Math.max(0, Math.min(ordered.length - 1, next))
      setActiveId(ordered[clamped].id)
    }
    switch (e.key) {
      case "ArrowDown":
        return moveTo(i + 1)
      case "ArrowUp":
        if (i === 0 && showSearch) {
          e.preventDefault()
          searchRef.current?.focus()
          return
        }
        return moveTo(i - 1)
      case "Home":
        return moveTo(0)
      case "End":
        return moveTo(ordered.length - 1)
      case " ":
      case "Enter":
        e.preventDefault()
        if (active && !isDisabled(active.id)) toggle(active.id)
        return
    }
  }

  const submit = () => {
    if (!canSubmit) return
    const inList = ready.filter((e) => isSelected(e.id)).map((e) => e.id)
    const ids = [...inList, ...selected.filter((id) => !inList.includes(id))]
    setDecision("selected")
    onResult?.({ action: "select", ids })
  }

  const cancel = () => {
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  // Selected or cancelled: a compact record for the chat history.
  if (done) {
    const chosen = selected.map(
      (id) => ready.find((e) => e.id === id) ?? { id, label: id },
    )
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="entity-picker"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader
            className={cn(
              "flex-row items-center justify-between gap-3",
              status === "selected" && chosen.length > 0 ? "pb-3" : "pb-3",
            )}
          >
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            <p aria-live="polite" className="shrink-0 pt-0.5">
              {status === "selected" ? (
                <Badge variant="success">
                  <CheckIcon aria-hidden />
                  Selected
                  <span className="sr-only">
                    {" "}
                    {chosen.length === 1 ? "1 item" : `${chosen.length} items`}
                  </span>
                </Badge>
              ) : (
                <Badge variant="outline">
                  <XIcon aria-hidden />
                  Cancelled
                  <span className="sr-only">. Nothing was selected.</span>
                </Badge>
              )}
            </p>
          </SurfaceHeader>
          {status === "selected" && chosen.length > 0 && (
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-3 border-t border-border px-3 py-3"
            >
              {chosen.map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <EntityText entity={e} />
                </li>
              ))}
            </motion.ul>
          )}
        </Surface>
      </MotionConfig>
    )
  }

  const scrolls = ready.length > MAX_VISIBLE_ROWS
  // Group headings are marked data-sticky-header, so the top fade starts under them.
  const fades = scrolls

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="entity-picker"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && (
            <SurfaceDescription>{description}</SurfaceDescription>
          )}
        </SurfaceHeader>

        {showSearch && (
          <div className="relative border-t border-border px-3 py-3">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-8.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              aria-label={title ? `Search: ${title}` : "Search"}
              aria-controls={listId}
              placeholder="Search"
              value={query}
              disabled={locked}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && ordered.length) {
                  e.preventDefault()
                  setActiveId(ordered[0].id)
                  listRef.current?.focus()
                } else if (e.key === "Escape" && query !== "") {
                  // Clear the search first; a second Escape leaves it to the host.
                  e.preventDefault()
                  setQuery("")
                  setActiveId(null)
                }
              }}
              className="pl-10"
            />
            {/* Announces the result count as the user types. */}
            <p aria-live="polite" className="sr-only">
              {query.trim()
                ? `${visible.length} ${visible.length === 1 ? "result" : "results"}`
                : ""}
            </p>
          </div>
        )}

        <AutoHeight>
          <ScrollFade
            className={cn("border-t border-border", fades && "max-h-[26rem]")}
          >
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={ordered.length ? 0 : -1}
            aria-labelledby={titleId}
            aria-multiselectable={multiple || undefined}
            aria-activedescendant={active ? optionId(active) : undefined}
            aria-disabled={locked || undefined}
            onKeyDown={onListKeyDown}
            className="group/list px-2 py-2 outline-none"
          >
            {groups.map(([group, items]) => {
              const headingId = `${baseId}-group-${items[0].index}`
              const options = items.map((e) => {
                const checked = isSelected(e.id)
                const disabled = isDisabled(e.id)
                return (
                  <motion.div
                    key={e.id}
                    id={optionId(e)}
                    role="option"
                    aria-selected={checked}
                    aria-disabled={disabled || locked || undefined}
                    data-active={active?.id === e.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    onClick={() => !disabled && toggle(e.id)}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition-colors",
                      checked && "bg-accent",
                      disabled || locked
                        ? "cursor-not-allowed opacity-50"
                        : checked
                          ? "hover:bg-accent dark:hover:bg-accent"
                          : "hover:bg-muted dark:hover:bg-white/5",
                      "group-focus-visible/list:data-[active=true]:ring-2 group-focus-visible/list:data-[active=true]:ring-ring/50 group-focus-visible/list:data-[active=true]:ring-inset",
                    )}
                  >
                    <Indicator checked={checked} multi={multiple} />
                    <EntityText entity={e} />
                  </motion.div>
                )
              })
              if (!group)
                return <React.Fragment key="_">{options}</React.Fragment>
              return (
                // biome-ignore lint/a11y/useSemanticElements: ARIA listbox group; fieldset isn't allowed inside a listbox
                <div
                  key={group}
                  role="group"
                  aria-labelledby={headingId}
                  className="pt-2 first:pt-0"
                >
                  <div
                    id={headingId}
                    role="presentation"
                    data-sticky-header
                    className={cn(
                      genuiType.label,
                      "sticky top-0 z-10 bg-(--surface-bg) px-3 py-1.5",
                    )}
                  >
                    {group}
                  </div>
                  {options}
                </div>
              )
            })}

            {showSearch && query.trim() && visible.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
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
            <div aria-hidden className="flex flex-col">
              {Array.from({ length: ready.length ? 1 : 3 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                <div key={i} className="flex gap-3 px-3 py-3">
                  <Skeleton className="size-5 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          )}
        </AutoHeight>

        <SurfaceFooter className="justify-between gap-3">
          <p aria-live="polite" className={cn(genuiType.meta, "tabular-nums")}>
            {streaming ? (
              <ShimmeringText
                text="Loading options…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : status === "submitting" ? (
              "Saving…"
            ) : multiple ? (
              count < minPicks && minPicks > 1 ? (
                `Pick at least ${minPicks}`
              ) : maxPicks !== undefined ? (
                `${count} of ${maxPicks} selected`
              ) : (
                `${count} selected`
              )
            ) : count ? (
              // The row already shows the choice; announce it only.
              <span className="sr-only">
                Selected:{" "}
                {ready.find((e) => e.id === selected[0])?.label ?? selected[0]}
              </span>
            ) : null}
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
              reason="Select at least one option"
            >
              <Button size="sm" onClick={submit} disabled={!canSubmit}>
                {status === "submitting"
                  ? "Saving…"
                  : (submitLabel ?? "Select")}
              </Button>
            </WhyDisabled>
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
